use crate::db::{new_uuid, Db};
use crate::models::{JournalEntry, JournalPatch, Label, NewJournalEntry, NewTask, Task, TaskPatch};
use crate::recur;
use chrono::Local;
use rusqlite::{params, Connection};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn now_iso() -> String {
    Local::now().to_rfc3339()
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
                subtasks
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
        "INSERT INTO tasks (id, title, notes, due_date, remind_at, priority, created_at, order_index, repeat, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            task.title.trim(),
            task.notes,
            task.due_date,
            task.remind_at,
            task.priority.unwrap_or(4),
            created,
            Local::now().timestamp_millis() as f64,
            task.repeat,
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
        // Changing the reminder re-arms the notification.
        conn.execute(
            "UPDATE tasks SET remind_at = ?1, notified = 0 WHERE id = ?2",
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

/// Set a task's manual order position. The frontend computes `order_index`
/// as the midpoint between the drop target's neighbors (a fractional index),
/// so reordering never has to renumber the whole list.
#[tauri::command]
pub fn reorder_task(db: State<Db>, id: String, order_index: f64) -> CmdResult<Task> {
    let conn = db.conn();
    conn.execute(
        "UPDATE tasks SET order_index = ?1 WHERE id = ?2",
        params![order_index, id],
    )
    .map_err(|e| e.to_string())?;
    touch_and_load(&conn, &id).map_err(|e| e.to_string())
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
                    "UPDATE tasks SET due_date = ?1, remind_at = ?2, notified = 0 WHERE id = ?3",
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
    let conn = db.conn();
    let now = now_iso();
    conn.execute(
        "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
    let conn = db.conn();
    let now = now_iso();
    conn.execute(
        "UPDATE labels SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
