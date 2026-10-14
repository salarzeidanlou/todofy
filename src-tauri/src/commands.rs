use crate::db::{new_uuid, Db};
use crate::models::{
    Event, EventPatch, JournalEntry, JournalPatch, Label, NewEvent, NewJournalEntry, NewTask, Task,
    TaskPatch,
};
use crate::recur;
use chrono::{DateTime, Local};
use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = Result<T, String>;

fn now_iso() -> String {
    Local::now().to_rfc3339()
}
fn validate_event_range(
    all_day: bool,
    start_at: Option<&str>,
    end_at: Option<&str>,
) -> CmdResult<()> {
    if all_day {
        return Ok(());
    }
    let (Some(start_at), Some(end_at)) = (start_at, end_at) else {
        return Ok(());
    };
    let start = DateTime::parse_from_rfc3339(start_at)
        .map_err(|_| "Timed event start must be a valid ISO datetime".to_string())?;
    let end = DateTime::parse_from_rfc3339(end_at)
        .map_err(|_| "Timed event end must be a valid ISO datetime".to_string())?;
    if end <= start {
        return Err("Event end time must be later than its start time".to_string());
    }
    Ok(())
}

fn label_ids_for(conn: &Connection, task_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT tl.label_id FROM task_labels tl
         JOIN labels l ON l.id = tl.label_id
         WHERE tl.task_id = ?1 AND tl.deleted_at IS NULL AND l.deleted_at IS NULL",
    )?;
    let ids = stmt
        .query_map([task_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(ids)
}

fn touch_and_load(conn: &Connection, id: &str) -> rusqlite::Result<Task> {
    conn.execute(
        "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), id],
    )?;
    load_task(conn, id)
}

fn load_task(conn: &Connection, id: &str) -> rusqlite::Result<Task> {
    let mut task = conn.query_row(
        "SELECT id, title, notes, due_date, remind_at, status, priority,
                created_at, completed_at, order_index, pinned, repeat,
                (SELECT COALESCE(SUM(seconds), 0) FROM time_sessions
                 WHERE task_id = tasks.id AND end_at IS NOT NULL
                   AND deleted_at IS NULL),
                subtasks, estimate_minutes, stage, board_index
         FROM tasks WHERE id = ?1",
        [id],
        |r| {
            let subtasks_json: Option<String> = r.get(13)?;
            Ok(Task {
                id: r.get(0)?,
                title: r.get(1)?,
                notes: r.get(2)?,
                due_date: r.get(3)?,
                remind_at: r.get(4)?,
                status: r.get(5)?,
                priority: r.get(6)?,
                created_at: r.get(7)?,
                completed_at: r.get(8)?,
                order_index: r.get(9)?,
                pinned: r.get(10)?,
                repeat: r.get(11)?,
                estimate_minutes: r.get(14)?,
                stage: r.get(15)?,
                board_index: r.get(16)?,
                tracked_seconds: r.get(12)?,
                label_ids: Vec::new(),
                // Tolerate a NULL or malformed column as an empty checklist.
                subtasks: subtasks_json
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default(),
            })
        },
    )?;
    task.label_ids = label_ids_for(conn, id)?;
    Ok(task)
}

/// Renumber a fractional index once fewer than this many representable doubles
/// remain between two neighbours — about ten more halvings of headroom.
const MIN_GAP_ULPS: f64 = 1024.0;

/// Whether two adjacent index values have run out of room to insert between.
///
/// Measured in ULPs rather than as a fixed distance because these columns are
/// seeded from a millisecond timestamp (~1e12), where one ULP is already ~4e-4
/// — an absolute threshold would be either useless there or trigger constantly
/// on a list that has been renumbered down to 0, 1, 2…
fn too_close(before: f64, after: f64) -> bool {
    let ulp = before.abs().max(after.abs()).max(1.0) * f64::EPSILON;
    after - before < ulp * MIN_GAP_ULPS
}

/// Rewrite `column` to 0, 1, 2… across `rows` (already in their display order),
/// but only when some neighbouring pair has run out of room to subdivide.
///
/// Each drop halves the gap between the same two neighbours, so after roughly
/// fifty of them the midpoint is no longer representable and the two rows
/// collide — the sort then falls through to `created_at` and the card appears
/// to snap back. Renumbering restores the headroom without changing the order
/// anyone can see. `updated_at` is bumped on every row it touches so the new
/// positions reach the user's other devices; this runs rarely enough that the
/// extra sync traffic does not matter.
fn renumber_if_crowded(
    conn: &Connection,
    column: &str,
    rows: &[(String, f64)],
    now: &str,
) -> rusqlite::Result<bool> {
    if !rows.windows(2).any(|pair| too_close(pair[0].1, pair[1].1)) {
        return Ok(false);
    }
    for (position, (id, _)) in rows.iter().enumerate() {
        conn.execute(
            &format!("UPDATE tasks SET {column} = ?1, updated_at = ?2 WHERE id = ?3"),
            params![position as f64, now, id],
        )?;
    }
    Ok(true)
}

/// Every live task in the order the list view shows them (see `list_tasks`).
fn list_order(conn: &Connection) -> rusqlite::Result<Vec<(String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT id, order_index FROM tasks
         WHERE deleted_at IS NULL
         ORDER BY (status = 'done'), order_index ASC, created_at ASC",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Every live task carrying `stage`, in board order. Grouped by the stored slug
/// rather than the column it renders in: each slug is its own independent run
/// of `board_index` values, which is what a renumber has to keep consistent.
fn board_order(conn: &Connection, stage: Option<&str>) -> rusqlite::Result<Vec<(String, f64)>> {
    let columns = crate::board::list(conn)?;
    let target = crate::board::resolve_stage(stage, &columns);
    let mut stmt = conn.prepare(
        "SELECT id, stage, board_index FROM tasks WHERE deleted_at IS NULL AND status != 'done'
         ORDER BY board_index, created_at, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, f64>(2)?,
        ))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (id, stored, index) = row?;
        if crate::board::resolve_stage(stored.as_deref(), &columns) == target {
            result.push((id, index));
        }
    }
    Ok(result)
}

fn set_labels(conn: &Connection, task_id: &str, label_ids: &[String]) -> rusqlite::Result<()> {
    let now = now_iso();
    // Tombstone every current association, then re-assert the desired ones. The
    // removed ones stay tombstoned (so the removal syncs); the kept ones are
    // revived in the same pass with a fresh timestamp.
    conn.execute(
        "UPDATE task_labels SET deleted_at = ?1, updated_at = ?1
         WHERE task_id = ?2 AND deleted_at IS NULL",
        params![now, task_id],
    )?;
    for lid in label_ids {
        conn.execute(
            "INSERT INTO task_labels (task_id, label_id, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL)
             ON CONFLICT(task_id, label_id)
             DO UPDATE SET deleted_at = NULL, updated_at = ?3",
            params![task_id, lid, now],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_tasks(db: State<Db>) -> CmdResult<Vec<Task>> {
    let conn = db.conn();
    // Manual order (order_index) is the primary sort so drag-to-reorder
    // sticks; priority is a visual tag, not a sort key. Done tasks sink.
    let mut stmt = conn
        .prepare(
            "SELECT id FROM tasks
             WHERE deleted_at IS NULL
             ORDER BY (status = 'done'), order_index ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    ids.into_iter()
        .map(|id| load_task(&conn, &id).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn create_task(db: State<Db>, task: NewTask) -> CmdResult<Task> {
    let conn = db.conn();
    let created = now_iso();
    let id = new_uuid();
    conn.execute(
        "INSERT INTO tasks (id, title, notes, due_date, remind_at, priority, created_at, order_index, repeat, estimate_minutes, updated_at, board_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?8)",
        params![
            id,
            task.title.trim(),
            task.notes,
            task.due_date,
            task.remind_at,
            task.priority.unwrap_or(4),
            created,
            // Doubles as the board position, so a new task lands at the end of
            // both the list and the first column.
            Local::now().timestamp_millis() as f64,
            task.repeat,
            task.estimate_minutes.filter(|m| *m > 0),
            created,
        ],
    )
    .map_err(|e| e.to_string())?;
    if let Some(ids) = &task.label_ids {
        set_labels(&conn, &id, ids).map_err(|e| e.to_string())?;
    }
    load_task(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(db: State<Db>, patch: TaskPatch) -> CmdResult<Task> {
    let conn = db.conn();
    if let Some(title) = &patch.title {
        conn.execute(
            "UPDATE tasks SET title = ?1 WHERE id = ?2",
            params![title.trim(), patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(notes) = &patch.notes {
        conn.execute(
            "UPDATE tasks SET notes = ?1 WHERE id = ?2",
            params![notes, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(due) = &patch.due_date {
        conn.execute(
            "UPDATE tasks SET due_date = ?1 WHERE id = ?2",
            params![due, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(remind) = &patch.remind_at {
        // Re-arms the notification, including its repeat count and the
        // answer that had stopped it.
        conn.execute(
            "UPDATE tasks SET remind_at = ?1, notified = 0, last_notified_at = NULL,
                    reminder_ack_at = NULL WHERE id = ?2",
            params![remind, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(priority) = patch.priority {
        conn.execute(
            "UPDATE tasks SET priority = ?1 WHERE id = ?2",
            params![priority, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ids) = &patch.label_ids {
        set_labels(&conn, &patch.id, ids).map_err(|e| e.to_string())?;
    }
    if let Some(pinned) = patch.pinned {
        conn.execute(
            "UPDATE tasks SET pinned = ?1 WHERE id = ?2",
            params![pinned, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(repeat) = &patch.repeat {
        // `Some(None)` clears the recurrence; `Some(Some(rule))` sets it.
        conn.execute(
            "UPDATE tasks SET repeat = ?1 WHERE id = ?2",
            params![repeat, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(estimate) = patch.estimate_minutes {
        // `Some(None)` clears the estimate; a non-positive value is treated the
        // same way, so the UI can clear it without a separate call.
        conn.execute(
            "UPDATE tasks SET estimate_minutes = ?1 WHERE id = ?2",
            params![estimate.filter(|m| *m > 0), patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(subtasks) = &patch.subtasks {
        // Replace the whole checklist. An empty list is stored as `[]`.
        let json = serde_json::to_string(subtasks).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tasks SET subtasks = ?1 WHERE id = ?2",
            params![json, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    touch_and_load(&conn, &patch.id).map_err(|e| e.to_string())
}

/// Stop a reminder repeating. Called when a notification is opened, dismissed
/// by hand or snoozed, and when a timer is started on the task.
///
/// Deliberately not called when a popup times out unseen — counting that as an
/// answer would defeat the feature.
pub fn acknowledge_reminder_inner(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET reminder_ack_at = ?1 WHERE id = ?2 AND reminder_ack_at IS NULL",
        params![now_iso(), id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn acknowledge_reminder(db: State<Db>, id: String) -> CmdResult<()> {
    acknowledge_reminder_inner(&db.conn(), &id).map_err(|e| e.to_string())
}

/// Push a task's reminder `minutes` into the future, moving its due date to
/// match so it lands in the view its new time belongs to.
///
/// This lives in the backend rather than the main window's store because the
/// notification popup is a separate webview with no access to it — snoozing
/// straight from the notification is the whole point. Writing `remind_at`
/// resets `notified`, so the reminder fires again when it comes due.
#[tauri::command]
pub fn snooze_task(app: AppHandle, db: State<Db>, id: String, minutes: i64) -> CmdResult<Task> {
    let when = Local::now() + chrono::Duration::minutes(minutes.max(1));
    let task = {
        let conn = db.conn();
        conn.execute(
            "UPDATE tasks SET remind_at = ?1, due_date = ?2, notified = 0,
                    last_notified_at = NULL, reminder_ack_at = NULL WHERE id = ?3",
            params![when.to_rfc3339(), when.format("%Y-%m-%d").to_string(), id],
        )
        .map_err(|e| e.to_string())?;
        touch_and_load(&conn, &id).map_err(|e| e.to_string())?
    };
    // The main window holds tasks in memory; tell it to re-read them.
    let _ = app.emit("tasks-changed", ());
    Ok(task)
}

/// Set a task's manual order position. The frontend computes `order_index` as
/// the midpoint between the drop target's neighbours (a fractional index), so a
/// reorder normally writes one row.
///
/// Returns every row it moved: usually just this task, but the whole list when
/// the midpoints had grown too fine and the order had to be renumbered.
#[tauri::command]
pub fn reorder_task(db: State<Db>, id: String, order_index: f64) -> CmdResult<Vec<Task>> {
    let mut conn = db.conn();
    reorder_task_inner(&mut conn, &id, order_index).map_err(|e| e.to_string())
}

fn reorder_task_inner(
    conn: &mut Connection,
    id: &str,
    order_index: f64,
) -> rusqlite::Result<Vec<Task>> {
    let now = now_iso();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tasks SET order_index = ?1, updated_at = ?2 WHERE id = ?3",
        params![order_index, now, id],
    )?;
    let rows = list_order(&tx)?;
    let moved = renumber_if_crowded(&tx, "order_index", &rows, &now)?;
    let tasks = load_moved(&tx, id, &rows, moved)?;
    tx.commit()?;
    Ok(tasks)
}

/// Drop a task into a board column, mirroring `reorder_task` on the board's
/// own axis. `stage` is the column slug, None for the first column. Returns the
/// rows it moved, for the same reason `reorder_task` does.
///
/// Done is derived from `status`, so the frontend routes those drops through
/// `toggle_task` instead and recurring tasks still roll forward.
#[tauri::command]
pub fn move_task_to_stage(
    db: State<Db>,
    id: String,
    stage: Option<String>,
    board_index: f64,
) -> CmdResult<Vec<Task>> {
    let mut conn = db.conn();
    move_task_to_stage_inner(&mut conn, &id, stage.as_deref(), board_index)
        .map_err(|e| e.to_string())
}

fn move_task_to_stage_inner(
    conn: &mut Connection,
    id: &str,
    stage: Option<&str>,
    board_index: f64,
) -> rusqlite::Result<Vec<Task>> {
    if !board_index.is_finite() {
        return Err(rusqlite::Error::InvalidParameterName(
            "Invalid board position".into(),
        ));
    }
    let columns = crate::board::list(conn)?;
    let target = stage.unwrap_or(crate::board::TODO);
    if !columns
        .iter()
        .any(|c| c.id == target && c.id != crate::board::DONE && c.deleted_at.is_none())
    {
        return Err(rusqlite::Error::InvalidParameterName(
            "This column no longer exists".into(),
        ));
    }
    let now = now_iso();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tasks SET stage = ?1, board_index = ?2, updated_at = ?3, status = 'active', completed_at = NULL WHERE id = ?4 AND deleted_at IS NULL",
        params![stage, board_index, now, id],
    )?;
    // Read the column back after the write, so the task is already in the group
    // whose spacing is being checked.
    let rows = board_order(&tx, stage)?;
    let moved = renumber_if_crowded(&tx, "board_index", &rows, &now)?;
    let tasks = load_moved(&tx, id, &rows, moved)?;
    tx.commit()?;
    Ok(tasks)
}

/// The tasks a reorder changed: the whole group after a renumber, otherwise
/// just the one that was dropped.
fn load_moved(
    conn: &Connection,
    id: &str,
    rows: &[(String, f64)],
    renumbered: bool,
) -> rusqlite::Result<Vec<Task>> {
    if !renumbered {
        return Ok(vec![load_task(conn, id)?]);
    }
    rows.iter()
        .map(|(row_id, _)| load_task(conn, row_id))
        .collect()
}

#[tauri::command]
pub fn toggle_task(db: State<Db>, id: String, done: bool) -> CmdResult<Task> {
    let conn = db.conn();
    // Completing a repeating task rolls it forward to the next occurrence and
    // keeps it active, instead of marking it done.
    if done {
        let (repeat, due, remind) = conn
            .query_row(
                "SELECT repeat, due_date, remind_at FROM tasks WHERE id = ?1",
                [&id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;

        if let Some(rule) = repeat.as_deref().filter(|s| !s.is_empty()) {
            if let Some(next_due) = due.as_deref().and_then(|d| recur::advance_due(d, rule)) {
                let next_remind = remind
                    .as_deref()
                    .and_then(|r| recur::advance_remind(r, rule));
                conn.execute(
                    "UPDATE tasks SET due_date = ?1, remind_at = ?2, notified = 0,
                            last_notified_at = NULL, reminder_ack_at = NULL WHERE id = ?3",
                    params![next_due, next_remind, id],
                )
                .map_err(|e| e.to_string())?;
                return touch_and_load(&conn, &id).map_err(|e| e.to_string());
            }
        }
    }
    if done {
        conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = ?1 WHERE id = ?2",
            params![now_iso(), id],
        )
    } else {
        conn.execute(
            "UPDATE tasks SET status = 'active', completed_at = NULL WHERE id = ?1",
            [&id],
        )
    }
    .map_err(|e| e.to_string())?;
    touch_and_load(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(db: State<Db>, id: String) -> CmdResult<()> {
    let mut conn = db.conn();
    let now = now_iso();
    delete_task_inner(&mut conn, &id, &now).map_err(|e| e.to_string())
}

fn delete_task_inner(conn: &mut Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    // Tombstone dependants in the same transaction as their task. Leaving a
    // live child behind makes the next cloud push violate its foreign key when
    // the deleted parent is represented only by a sync tombstone.
    tx.execute(
        "UPDATE task_labels SET deleted_at = ?1, updated_at = ?1
         WHERE task_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE time_sessions SET deleted_at = ?1, updated_at = ?1
         WHERE task_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    tx.commit()
}

#[tauri::command]
pub fn list_labels(db: State<Db>) -> CmdResult<Vec<Label>> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color FROM labels
             WHERE deleted_at IS NULL
             ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let labels = stmt
        .query_map([], |r| {
            Ok(Label {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<Label>>>()
        .map_err(|e| e.to_string())?;
    Ok(labels)
}

#[tauri::command]
pub fn create_label(db: State<Db>, name: String, color: String) -> CmdResult<Label> {
    let conn = db.conn();
    let id = new_uuid();
    conn.execute(
        "INSERT INTO labels (id, name, color, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name.trim(), color, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(Label {
        id,
        name: name.trim().to_string(),
        color,
    })
}

#[tauri::command]
pub fn update_label(db: State<Db>, id: String, name: String, color: String) -> CmdResult<Label> {
    let conn = db.conn();
    conn.execute(
        "UPDATE labels SET name = ?1, color = ?2, updated_at = ?3 WHERE id = ?4",
        params![name.trim(), color, now_iso(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(Label {
        id,
        name: name.trim().to_string(),
        color,
    })
}

#[tauri::command]
pub fn delete_label(db: State<Db>, id: String) -> CmdResult<()> {
    let mut conn = db.conn();
    let now = now_iso();
    delete_label_inner(&mut conn, &id, &now).map_err(|e| e.to_string())
}

fn delete_label_inner(conn: &mut Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE task_labels SET deleted_at = ?1, updated_at = ?1
         WHERE label_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE labels SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    tx.commit()
}

fn load_journal(conn: &Connection, id: &str) -> rusqlite::Result<JournalEntry> {
    conn.query_row(
        "SELECT id, title, body, mood, entry_date, created_at, updated_at
         FROM journal_entries WHERE id = ?1",
        [id],
        |r| {
            Ok(JournalEntry {
                id: r.get(0)?,
                title: r.get(1)?,
                body: r.get(2)?,
                mood: r.get(3)?,
                entry_date: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        },
    )
}

#[tauri::command]
pub fn list_journal(db: State<Db>) -> CmdResult<Vec<JournalEntry>> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id FROM journal_entries
             WHERE deleted_at IS NULL
             ORDER BY entry_date DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    ids.into_iter()
        .map(|id| load_journal(&conn, &id).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn create_journal(db: State<Db>, entry: NewJournalEntry) -> CmdResult<JournalEntry> {
    let conn = db.conn();
    let now = now_iso();
    let id = new_uuid();
    conn.execute(
        "INSERT INTO journal_entries (id, title, body, mood, entry_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            entry.title,
            entry.body.unwrap_or_default(),
            entry.mood,
            entry.entry_date,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    load_journal(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_journal(db: State<Db>, patch: JournalPatch) -> CmdResult<JournalEntry> {
    let conn = db.conn();
    if let Some(title) = &patch.title {
        conn.execute(
            "UPDATE journal_entries SET title = ?1 WHERE id = ?2",
            params![title, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(body) = &patch.body {
        conn.execute(
            "UPDATE journal_entries SET body = ?1 WHERE id = ?2",
            params![body, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(mood) = &patch.mood {
        conn.execute(
            "UPDATE journal_entries SET mood = ?1 WHERE id = ?2",
            params![mood, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(date) = &patch.entry_date {
        conn.execute(
            "UPDATE journal_entries SET entry_date = ?1 WHERE id = ?2",
            params![date, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE journal_entries SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), patch.id],
    )
    .map_err(|e| e.to_string())?;
    load_journal(&conn, &patch.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_journal(db: State<Db>, id: String) -> CmdResult<()> {
    let conn = db.conn();
    let now = now_iso();
    conn.execute(
        "UPDATE journal_entries SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_event(conn: &Connection, id: &str) -> rusqlite::Result<Event> {
    conn.query_row(
        "SELECT id, title, description, start_at, end_at, all_day,
                created_at, updated_at
         FROM events WHERE id = ?1",
        [id],
        |r| {
            Ok(Event {
                id: r.get(0)?,
                title: r.get(1)?,
                description: r.get(2)?,
                start_at: r.get(3)?,
                end_at: r.get(4)?,
                all_day: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        },
    )
}

#[tauri::command]
pub fn list_events(db: State<Db>) -> CmdResult<Vec<Event>> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id FROM events
             WHERE deleted_at IS NULL
             ORDER BY start_at",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    ids.into_iter()
        .map(|id| load_event(&conn, &id).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn create_event(db: State<Db>, event: NewEvent) -> CmdResult<Event> {
    validate_event_range(
        event.all_day,
        event.start_at.as_deref(),
        event.end_at.as_deref(),
    )?;
    let conn = db.conn();
    let now = now_iso();
    let id = new_uuid();
    conn.execute(
        "INSERT INTO events
            (id, title, description, start_at, end_at, all_day, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            event.title,
            event.description,
            event.start_at,
            event.end_at,
            event.all_day,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    load_event(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_event(db: State<Db>, patch: EventPatch) -> CmdResult<Event> {
    let conn = db.conn();
    let current = load_event(&conn, &patch.id).map_err(|e| e.to_string())?;
    let all_day = patch.all_day.unwrap_or(current.all_day);
    let start_at = match patch.start_at.as_ref() {
        Some(value) => value.as_deref(),
        None => current.start_at.as_deref(),
    };
    let end_at = match patch.end_at.as_ref() {
        Some(value) => value.as_deref(),
        None => current.end_at.as_deref(),
    };
    validate_event_range(all_day, start_at, end_at)?;
    if let Some(title) = &patch.title {
        conn.execute(
            "UPDATE events SET title = ?1 WHERE id = ?2",
            params![title, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(description) = &patch.description {
        conn.execute(
            "UPDATE events SET description = ?1 WHERE id = ?2",
            params![description, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(start_at) = &patch.start_at {
        conn.execute(
            "UPDATE events SET start_at = ?1 WHERE id = ?2",
            params![start_at, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(end_at) = &patch.end_at {
        conn.execute(
            "UPDATE events SET end_at = ?1 WHERE id = ?2",
            params![end_at, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(all_day) = patch.all_day {
        conn.execute(
            "UPDATE events SET all_day = ?1 WHERE id = ?2",
            params![all_day, patch.id],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE events SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), patch.id],
    )
    .map_err(|e| e.to_string())?;
    load_event(&conn, &patch.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_event(db: State<Db>, id: String) -> CmdResult<()> {
    let conn = db.conn();
    let now = now_iso();
    conn.execute(
        "UPDATE events SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod command_tests {
    use super::{
        acknowledge_reminder_inner, delete_label_inner, delete_task_inner,
        move_task_to_stage_inner, reorder_task_inner, too_close, validate_event_range,
    };
    use crate::db;
    use rusqlite::Connection;

    /// Insert `n` active tasks, evenly spaced on both ordering axes.
    fn seed_tasks(conn: &Connection, ids: &[&str], stage: Option<&str>) {
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "INSERT INTO tasks (id, title, created_at, updated_at, order_index,
                                    board_index, stage)
                 VALUES (?1, ?1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?2, ?2, ?3)",
                rusqlite::params![id, i as f64, stage],
            )
            .unwrap();
        }
    }

    fn indexes(conn: &Connection, column: &str) -> Vec<(String, f64)> {
        conn.prepare(&format!(
            "SELECT id, {column} FROM tasks ORDER BY {column}, created_at"
        ))
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
    }

    #[test]
    fn default_column_renumbering_combines_null_todo_and_unknown_stages() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        seed_tasks(&conn, &["unplaced"], None);
        seed_tasks(&conn, &["explicit"], Some("todo"));
        seed_tasks(&conn, &["orphan"], Some("missing"));
        let moved = move_task_to_stage_inner(&mut conn, "unplaced", Some("todo"), 0.0).unwrap();
        assert_eq!(moved.len(), 3);
        let positions = indexes(&conn, "board_index");
        assert_eq!(
            positions.iter().map(|(_, n)| *n).collect::<Vec<_>>(),
            vec![0.0, 1.0, 2.0]
        );
    }

    #[test]
    fn moving_from_done_reopens_and_positions_the_task_atomically() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        seed_tasks(&conn, &["finished"], Some("blocked"));
        conn.execute(
            "UPDATE tasks SET status='done', completed_at='2026-01-01T00:00:00Z'",
            [],
        )
        .unwrap();
        let moved = move_task_to_stage_inner(&mut conn, "finished", Some("doing"), 5.0).unwrap();
        assert_eq!(moved[0].status, "active");
        assert_eq!(moved[0].completed_at, None);
        assert_eq!(moved[0].stage.as_deref(), Some("doing"));
        assert!(move_task_to_stage_inner(&mut conn, "finished", Some("done"), 0.0).is_err());
    }

    /// The threshold has to hold at the magnitude these columns are actually
    /// seeded from: `create_task` uses a millisecond timestamp (~1.7e12), where
    /// one ULP is already ~4e-4 and an absolute epsilon would never fire.
    #[test]
    fn crowding_is_detected_at_timestamp_magnitude() {
        assert!(!too_close(0.0, 1.0), "whole numbers have ample room");
        assert!(!too_close(1.7e12, 1.7e12 + 1.0), "so does a one-unit gap");
        assert!(too_close(1.0, 1.0), "equal values cannot be split");
        assert!(
            too_close(1.7e12, 1.7e12 + 1e-6),
            "a gap below one ULP-scale step at 1.7e12 is exhausted"
        );
        assert!(
            !too_close(0.5, 0.5 + 1e-6),
            "the same absolute gap is still fine near zero"
        );
    }

    /// Halving the same gap repeatedly is exactly what dropping a card in the
    /// same slot does; it must not end with two tasks sharing an index.
    #[test]
    fn repeated_drops_into_one_slot_renumber_instead_of_colliding() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        seed_tasks(&conn, &["a", "b", "c"], Some("doing"));

        // Wedge "c" between "a" and "b" over and over, always at the midpoint —
        // the frontend's `indexBetween` with the same two neighbours each time.
        for _ in 0..80 {
            let rows = indexes(&conn, "board_index");
            let before = rows[0].1;
            let after = rows[1].1;
            assert!(after > before, "indices collided: {rows:?}");
            move_task_to_stage_inner(&mut conn, "c", Some("doing"), (before + after) / 2.0)
                .unwrap();
        }

        let rows = indexes(&conn, "board_index");
        assert_eq!(
            rows.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["a", "c", "b"],
            "the visible order must survive every renumber"
        );
    }

    /// The caller applies the returned rows optimistically, so a renumber has to
    /// report the whole column rather than only the card that was dragged.
    #[test]
    fn a_renumber_reports_every_row_it_moved() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        seed_tasks(&conn, &["a", "b", "c"], Some("doing"));

        let moved = move_task_to_stage_inner(&mut conn, "c", Some("doing"), 0.5).unwrap();
        assert_eq!(moved.len(), 1, "a roomy drop writes one row");

        // Land "c" on top of "a": no room at all, so the column is rewritten.
        let moved = move_task_to_stage_inner(&mut conn, "c", Some("doing"), 0.0).unwrap();
        let mut ids: Vec<&str> = moved.iter().map(|t| t.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["a", "b", "c"]);
        assert_eq!(
            indexes(&conn, "board_index")
                .iter()
                .map(|(_, v)| *v)
                .collect::<Vec<_>>(),
            vec![0.0, 1.0, 2.0],
            "a renumber spaces the column back out to whole numbers"
        );
    }

    /// Columns are independent runs of `board_index`, so renumbering one must
    /// not touch another that still has room.
    #[test]
    fn renumbering_a_column_leaves_its_neighbours_alone() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        seed_tasks(&conn, &["a", "b"], Some("doing"));
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at, order_index,
                                board_index, stage)
             VALUES ('z', 'z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 9, 7.5, 'blocked')",
            [],
        )
        .unwrap();

        move_task_to_stage_inner(&mut conn, "b", Some("doing"), 0.0).unwrap();

        let blocked: f64 = conn
            .query_row("SELECT board_index FROM tasks WHERE id = 'z'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(blocked, 7.5, "the blocked column was rewritten too");
    }

    /// The list axis carries the same hazard and the same fix. The drop lands
    /// strictly between two neighbours but with nothing left to split — which
    /// is where `indexBetween` ends up after enough moves into one slot.
    #[test]
    fn reordering_the_list_renumbers_when_the_gap_runs_out() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        seed_tasks(&conn, &["a", "b", "c"], None);

        let moved = reorder_task_inner(&mut conn, "c", f64::MIN_POSITIVE).unwrap();
        assert_eq!(moved.len(), 3, "a renumber reports the whole list");
        assert_eq!(
            indexes(&conn, "order_index")
                .iter()
                .map(|(id, value)| (id.as_str(), *value))
                .collect::<Vec<_>>(),
            vec![("a", 0.0), ("c", 1.0), ("b", 2.0)],
            "the drop position survives, spaced back out to whole numbers"
        );
    }

    #[test]
    fn timed_event_end_must_follow_start() {
        let start = "2026-09-06T10:00:00Z";
        assert!(validate_event_range(false, Some(start), Some("2026-09-06T11:00:00Z")).is_ok());
        assert!(validate_event_range(false, Some(start), Some(start)).is_err());
        assert!(validate_event_range(false, Some(start), Some("2026-09-06T09:00:00Z")).is_err());
        assert!(validate_event_range(true, Some(start), Some(start)).is_ok());
    }

    /// A second answer must not move the timestamp.
    #[test]
    fn acknowledging_a_reminder_records_it_once() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at, notified)
             VALUES ('t1', 'call the bank', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2)",
            [],
        )
        .unwrap();

        let ack = |c: &Connection| -> Option<String> {
            c.query_row(
                "SELECT reminder_ack_at FROM tasks WHERE id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(ack(&conn), None, "not answered yet");

        acknowledge_reminder_inner(&conn, "t1").unwrap();
        let first = ack(&conn).expect("answering must be recorded");

        acknowledge_reminder_inner(&conn, "t1").unwrap();
        assert_eq!(ack(&conn), Some(first), "answering twice changes nothing");
    }

    /// Upgrading must not turn every reminder ever fired into an unanswered one.
    #[test]
    fn existing_reminders_are_treated_as_already_answered() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        // The pre-repeat table shape, with one task in each state.
        conn.execute_batch(
            "
            DROP TABLE tasks;
            CREATE TABLE tasks (
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL,
                notes        TEXT,
                due_date     TEXT,
                remind_at    TEXT,
                status       TEXT NOT NULL DEFAULT 'active',
                priority     INTEGER NOT NULL DEFAULT 4,
                created_at   TEXT NOT NULL,
                completed_at TEXT,
                order_index  REAL NOT NULL DEFAULT 0,
                notified     INTEGER NOT NULL DEFAULT 0,
                pinned       INTEGER NOT NULL DEFAULT 0,
                repeat       TEXT,
                subtasks     TEXT,
                updated_at   TEXT NOT NULL,
                deleted_at   TEXT
            );
            INSERT INTO tasks (id, title, created_at, updated_at, notified)
                 VALUES ('fired', 'old reminder', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1),
                        ('waiting', 'not yet', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0);
            ",
        )
        .unwrap();

        db::init(&conn).unwrap();

        let ack = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT reminder_ack_at FROM tasks WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(ack("fired").is_some(), "already-fired reminders stay quiet");
        assert_eq!(ack("waiting"), None, "a pending reminder can still fire");
    }

    #[test]
    fn deleting_parents_tombstones_sync_children_atomically() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO labels (id, name, color, updated_at)
                 VALUES ('l1', 'home', '#fff', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, title, created_at, updated_at)
                 VALUES ('t1', 'task', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                        ('t2', 'task', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO task_labels (task_id, label_id, updated_at)
                 VALUES ('t1', 'l1', '2026-01-01T00:00:00Z'),
                        ('t2', 'l1', '2026-01-01T00:00:00Z');
             INSERT INTO time_sessions (id, task_id, start_at, updated_at)
                 VALUES ('s1', 't1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .unwrap();

        let deleted_at = "2026-09-06T20:00:00Z";
        delete_task_inner(&mut conn, "t1", deleted_at).unwrap();
        delete_label_inner(&mut conn, "l1", deleted_at).unwrap();

        for (table, predicate) in [
            ("tasks", "id = 't1'"),
            ("labels", "id = 'l1'"),
            ("task_labels", "task_id IN ('t1', 't2')"),
            ("time_sessions", "id = 's1'"),
        ] {
            let sql = format!("SELECT COUNT(*) FROM {table} WHERE {predicate} AND deleted_at = ?1");
            let count: i64 = conn
                .query_row(&sql, [deleted_at], |row| row.get(0))
                .unwrap();
            let expected = if table == "task_labels" { 2 } else { 1 };
            assert_eq!(count, expected, "{table} was not tombstoned");
        }
    }
}
