use crate::db::Db;
use crate::models::{Label, NewTask, Task, TaskPatch};
use crate::recur;
use chrono::Local;
use rusqlite::{params, Connection};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

fn label_ids_for(conn: &Connection, task_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT label_id FROM task_labels WHERE task_id = ?1")?;
    let ids = stmt
        .query_map([task_id], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

fn load_task(conn: &Connection, id: i64) -> rusqlite::Result<Task> {
    let mut task = conn.query_row(
        "SELECT id, title, notes, due_date, remind_at, status, priority,
                created_at, completed_at, order_index, pinned, repeat,
                (SELECT COALESCE(SUM(seconds), 0) FROM time_sessions
                 WHERE task_id = tasks.id AND end_at IS NOT NULL)
         FROM tasks WHERE id = ?1",
        [id],
        |r| {
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
            })
        },
    )?;
    task.label_ids = label_ids_for(conn, id)?;
    Ok(task)
}

fn set_labels(conn: &Connection, task_id: i64, label_ids: &[i64]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM task_labels WHERE task_id = ?1", [task_id])?;
    for lid in label_ids {
        conn.execute(
            "INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
            params![task_id, lid],
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
             ORDER BY (status = 'done'), order_index ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    ids.into_iter()
        .map(|id| load_task(&conn, id).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn create_task(db: State<Db>, task: NewTask) -> CmdResult<Task> {
    let conn = db.conn();
    let created = now_iso();
    conn.execute(
        "INSERT INTO tasks (title, notes, due_date, remind_at, priority, created_at, order_index, repeat)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task.title.trim(),
            task.notes,
            task.due_date,
            task.remind_at,
            task.priority.unwrap_or(4),
            created,
            Local::now().timestamp_millis() as f64,
            task.repeat,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    if let Some(ids) = &task.label_ids {
        set_labels(&conn, id, ids).map_err(|e| e.to_string())?;
    }
    load_task(&conn, id).map_err(|e| e.to_string())
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
        set_labels(&conn, patch.id, ids).map_err(|e| e.to_string())?;
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
    load_task(&conn, patch.id).map_err(|e| e.to_string())
}

/// Set a task's manual order position. The frontend computes `order_index`
/// as the midpoint between the drop target's neighbors (a fractional index),
/// so reordering never has to renumber the whole list.
#[tauri::command]
pub fn reorder_task(db: State<Db>, id: i64, order_index: f64) -> CmdResult<Task> {
    let conn = db.conn();
    conn.execute(
        "UPDATE tasks SET order_index = ?1 WHERE id = ?2",
        params![order_index, id],
    )
    .map_err(|e| e.to_string())?;
    load_task(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_task(db: State<Db>, id: i64, done: bool) -> CmdResult<Task> {
    let conn = db.conn();
    // Completing a repeating task rolls it forward to the next occurrence and
    // keeps it active, instead of marking it done.
    if done {
        let (repeat, due, remind) = conn
            .query_row(
                "SELECT repeat, due_date, remind_at FROM tasks WHERE id = ?1",
                [id],
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
                return load_task(&conn, id).map_err(|e| e.to_string());
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
            [id],
        )
    }
    .map_err(|e| e.to_string())?;
    load_task(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(db: State<Db>, id: i64) -> CmdResult<()> {
    let conn = db.conn();
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_labels(db: State<Db>) -> CmdResult<Vec<Label>> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT id, name, color FROM labels ORDER BY name COLLATE NOCASE")
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
    conn.execute(
        "INSERT INTO labels (name, color) VALUES (?1, ?2)",
        params![name.trim(), color],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(Label {
        id,
        name: name.trim().to_string(),
        color,
    })
}

#[tauri::command]
pub fn update_label(db: State<Db>, id: i64, name: String, color: String) -> CmdResult<Label> {
    let conn = db.conn();
    conn.execute(
        "UPDATE labels SET name = ?1, color = ?2 WHERE id = ?3",
        params![name.trim(), color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(Label {
        id,
        name: name.trim().to_string(),
        color,
    })
}

#[tauri::command]
pub fn delete_label(db: State<Db>, id: i64) -> CmdResult<()> {
    let conn = db.conn();
    conn.execute("DELETE FROM labels WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
