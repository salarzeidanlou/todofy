//! Local half of account sync. The frontend owns the Supabase session and
//! drives each round: pull remote rows into [`sync_apply`], then push the
//! changes from [`sync_changes_since`]. Last-write-wins by `updated_at`,
//! compared as parsed instants (offsets differ between local and cloud). Field
//! names match the Postgres columns so rows forward to Supabase unremapped.

use crate::db::Db;
use crate::settings;
use chrono::DateTime;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tauri::State;

const WATERMARK_KEY: &str = "sync_last_synced_at";
const EPOCH: &str = "1970-01-01T00:00:00+00:00";

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncTask {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<String>,
    pub remind_at: Option<String>,
    pub status: String,
    pub priority: i64,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub order_index: f64,
    pub pinned: bool,
    pub repeat: Option<String>,
    pub subtasks: Value,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncLabel {
    pub id: String,
    pub name: String,
    pub color: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncTaskLabel {
    pub task_id: String,
    pub label_id: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncSession {
    pub id: String,
    pub task_id: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub seconds: Option<i64>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SyncBundle {
    pub tasks: Vec<SyncTask>,
    pub labels: Vec<SyncLabel>,
    pub task_labels: Vec<SyncTaskLabel>,
    pub sessions: Vec<SyncSession>,
}

/// True when `a` is strictly newer than `b`. If either fails to parse we treat
/// `a` as newer, so a questionable row propagates rather than being dropped.
fn newer(a: &str, b: &str) -> bool {
    match (DateTime::parse_from_rfc3339(a), DateTime::parse_from_rfc3339(b)) {
        (Ok(a), Ok(b)) => a > b,
        _ => true,
    }
}

fn subtasks_value(raw: Option<String>) -> Value {
    raw.and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| Value::Array(vec![]))
}

// ------------------------------------------------------------------- push side

/// Every local row changed since `since` (tombstones included), for the caller
/// to upsert into Supabase.
#[tauri::command]
pub fn sync_changes_since(db: State<Db>, since: String) -> Result<SyncBundle, String> {
    let conn = db.conn();
    collect_changes(&conn, &since).map_err(|e| e.to_string())
}

fn collect_changes(conn: &Connection, since: &str) -> rusqlite::Result<SyncBundle> {
    let mut tasks = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT id, title, notes, due_date, remind_at, status, priority, created_at,
                completed_at, order_index, pinned, repeat, subtasks, updated_at, deleted_at
         FROM tasks",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncTask {
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
            pinned: r.get::<_, i64>(10)? != 0,
            repeat: r.get(11)?,
            subtasks: subtasks_value(r.get(12)?),
            updated_at: r.get(13)?,
            deleted_at: r.get(14)?,
        })
    })?;
    for row in rows {
        let row = row?;
        if newer(&row.updated_at, since) {
            tasks.push(row);
        }
    }

    let mut labels = Vec::new();
    let mut stmt = conn.prepare("SELECT id, name, color, updated_at, deleted_at FROM labels")?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncLabel {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            updated_at: r.get(3)?,
            deleted_at: r.get(4)?,
        })
    })?;
    for row in rows {
        let row = row?;
        if newer(&row.updated_at, since) {
            labels.push(row);
        }
    }

    let mut task_labels = Vec::new();
    let mut stmt =
        conn.prepare("SELECT task_id, label_id, updated_at, deleted_at FROM task_labels")?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncTaskLabel {
            task_id: r.get(0)?,
            label_id: r.get(1)?,
            updated_at: r.get(2)?,
            deleted_at: r.get(3)?,
        })
    })?;
    for row in rows {
        let row = row?;
        if newer(&row.updated_at, since) {
            task_labels.push(row);
        }
    }

    let mut sessions = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT id, task_id, start_at, end_at, seconds, updated_at, deleted_at FROM time_sessions",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncSession {
            id: r.get(0)?,
            task_id: r.get(1)?,
            start_at: r.get(2)?,
            end_at: r.get(3)?,
            seconds: r.get(4)?,
            updated_at: r.get(5)?,
            deleted_at: r.get(6)?,
        })
    })?;
    for row in rows {
        let row = row?;
        if newer(&row.updated_at, since) {
            sessions.push(row);
        }
    }

    // Include any referenced parent missing from the bundle, so a changed
    // child never pushes ahead of a parent still below the watermark.
    let have_task: HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
    let have_label: HashSet<&str> = labels.iter().map(|l| l.id.as_str()).collect();
    let mut need_tasks: HashSet<String> = HashSet::new();
    let mut need_labels: HashSet<String> = HashSet::new();
    for tl in &task_labels {
        if !have_task.contains(tl.task_id.as_str()) {
            need_tasks.insert(tl.task_id.clone());
        }
        if !have_label.contains(tl.label_id.as_str()) {
            need_labels.insert(tl.label_id.clone());
        }
    }
    for s in &sessions {
        if !have_task.contains(s.task_id.as_str()) {
            need_tasks.insert(s.task_id.clone());
        }
    }
    drop((have_task, have_label));
    for id in need_labels {
        if let Some(row) = fetch_label(conn, &id)? {
            labels.push(row);
        }
    }
    for id in need_tasks {
        if let Some(row) = fetch_task(conn, &id)? {
            tasks.push(row);
        }
    }

    Ok(SyncBundle {
        tasks,
        labels,
        task_labels,
        sessions,
    })
}

fn fetch_label(conn: &Connection, id: &str) -> rusqlite::Result<Option<SyncLabel>> {
    conn.query_row(
        "SELECT id, name, color, updated_at, deleted_at FROM labels WHERE id = ?1",
        [id],
        |r| {
            Ok(SyncLabel {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                updated_at: r.get(3)?,
                deleted_at: r.get(4)?,
            })
        },
    )
    .optional()
}

fn fetch_task(conn: &Connection, id: &str) -> rusqlite::Result<Option<SyncTask>> {
    conn.query_row(
        "SELECT id, title, notes, due_date, remind_at, status, priority, created_at,
                completed_at, order_index, pinned, repeat, subtasks, updated_at, deleted_at
         FROM tasks WHERE id = ?1",
        [id],
        |r| {
            Ok(SyncTask {
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
                pinned: r.get::<_, i64>(10)? != 0,
                repeat: r.get(11)?,
                subtasks: subtasks_value(r.get(12)?),
                updated_at: r.get(13)?,
                deleted_at: r.get(14)?,
            })
        },
    )
    .optional()
}

// ------------------------------------------------------------------- pull side

/// Merge a bundle of remote rows into the local database, last-write-wins by
/// `updated_at`. Applied in FK-safe order so a freshly-pulled association never
/// references a parent that hasn't landed yet.
#[tauri::command]
pub fn sync_apply(db: State<Db>, remote: SyncBundle) -> Result<(), String> {
    let conn = db.conn();
    apply_bundle(&conn, &remote).map_err(|e| e.to_string())
}

fn local_updated_at(conn: &Connection, sql: &str, key: &[&dyn rusqlite::ToSql]) -> Option<String> {
    conn.query_row(sql, key, |r| r.get::<_, String>(0)).ok()
}

fn apply_bundle(conn: &Connection, remote: &SyncBundle) -> rusqlite::Result<()> {
    for l in &remote.labels {
        let local = local_updated_at(conn, "SELECT updated_at FROM labels WHERE id = ?1", &[&l.id]);
        if local.as_deref().map(|cur| newer(&l.updated_at, cur)).unwrap_or(true) {
            conn.execute(
                "INSERT INTO labels (id, name, color, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name, color = excluded.color,
                    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
                params![l.id, l.name, l.color, l.updated_at, l.deleted_at],
            )?;
        }
    }

    for t in &remote.tasks {
        let local = local_updated_at(conn, "SELECT updated_at FROM tasks WHERE id = ?1", &[&t.id]);
        if local.as_deref().map(|cur| newer(&t.updated_at, cur)).unwrap_or(true) {
            conn.execute(
                "INSERT INTO tasks (id, title, notes, due_date, remind_at, status, priority,
                                    created_at, completed_at, order_index, pinned, repeat,
                                    subtasks, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title, notes = excluded.notes, due_date = excluded.due_date,
                    remind_at = excluded.remind_at, status = excluded.status,
                    priority = excluded.priority, completed_at = excluded.completed_at,
                    order_index = excluded.order_index, pinned = excluded.pinned,
                    repeat = excluded.repeat, subtasks = excluded.subtasks,
                    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
                params![
                    t.id,
                    t.title,
                    t.notes,
                    t.due_date,
                    t.remind_at,
                    t.status,
                    t.priority,
                    t.created_at,
                    t.completed_at,
                    t.order_index,
                    t.pinned as i64,
                    t.repeat,
                    t.subtasks.to_string(),
                    t.updated_at,
                    t.deleted_at,
                ],
            )?;
        }
    }

    for tl in &remote.task_labels {
        let local = local_updated_at(
            conn,
            "SELECT updated_at FROM task_labels WHERE task_id = ?1 AND label_id = ?2",
            &[&tl.task_id, &tl.label_id],
        );
        if local.as_deref().map(|cur| newer(&tl.updated_at, cur)).unwrap_or(true) {
            conn.execute(
                "INSERT INTO task_labels (task_id, label_id, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(task_id, label_id) DO UPDATE SET
                    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
                params![tl.task_id, tl.label_id, tl.updated_at, tl.deleted_at],
            )?;
        }
    }

    for s in &remote.sessions {
        let local =
            local_updated_at(conn, "SELECT updated_at FROM time_sessions WHERE id = ?1", &[&s.id]);
        if local.as_deref().map(|cur| newer(&s.updated_at, cur)).unwrap_or(true) {
            conn.execute(
                "INSERT INTO time_sessions (id, task_id, start_at, end_at, seconds, notified,
                                            updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    task_id = excluded.task_id, start_at = excluded.start_at,
                    end_at = excluded.end_at, seconds = excluded.seconds,
                    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
                params![s.id, s.task_id, s.start_at, s.end_at, s.seconds, s.updated_at, s.deleted_at],
            )?;
        }
    }

    Ok(())
}

// ------------------------------------------------------------------- watermark

/// The high-water mark: local rows changed at or before this were last synced.
#[tauri::command]
pub fn sync_get_watermark(db: State<Db>) -> Result<String, String> {
    Ok(settings::read(&db.conn(), WATERMARK_KEY).unwrap_or_else(|| EPOCH.to_string()))
}

#[tauri::command]
pub fn sync_set_watermark(db: State<Db>, value: String) -> Result<(), String> {
    settings::write(&db.conn(), WATERMARK_KEY, &value).map_err(|e| e.to_string())
}

/// Forget the watermark so the next round re-pulls and re-pushes everything —
/// used when a different account signs in on this device.
#[tauri::command]
pub fn sync_reset(db: State<Db>) -> Result<(), String> {
    settings::write(&db.conn(), WATERMARK_KEY, EPOCH).map_err(|e| e.to_string())
}

/// Hard-delete tombstones whose `deleted_at` is older than `days`. By then the
/// deletion has long since propagated, so keeping the row only wastes space.
/// Compared as parsed instants against a cutoff, so mixed offsets are fine.
#[tauri::command]
pub fn sync_purge_tombstones(db: State<Db>, days: i64) -> Result<(), String> {
    purge_tombstones(&db.conn(), days).map_err(|e| e.to_string())
}

fn purge_tombstones(conn: &Connection, days: i64) -> rusqlite::Result<()> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days.max(0));
    // Children before parents; deleting a task also cascades any leftovers.
    for table in ["task_labels", "time_sessions", "tasks", "labels"] {
        let mut stmt = conn.prepare(&format!(
            "SELECT rowid, deleted_at FROM {table} WHERE deleted_at IS NOT NULL"
        ))?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (rowid, deleted_at) in rows {
            let expired = DateTime::parse_from_rfc3339(&deleted_at)
                .map(|d| d.with_timezone(&chrono::Utc) < cutoff)
                .unwrap_or(false);
            if expired {
                conn.execute(&format!("DELETE FROM {table} WHERE rowid = ?1"), [rowid])?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn
    }

    #[test]
    fn apply_inserts_then_lww_updates() {
        let conn = setup();
        let bundle = SyncBundle {
            labels: vec![SyncLabel {
                id: "l1".into(),
                name: "home".into(),
                color: "#fff".into(),
                updated_at: "2026-01-01T00:00:00+00:00".into(),
                deleted_at: None,
            }],
            tasks: vec![SyncTask {
                id: "t1".into(),
                title: "milk".into(),
                notes: None,
                due_date: None,
                remind_at: None,
                status: "active".into(),
                priority: 4,
                created_at: "2026-01-01T00:00:00+00:00".into(),
                completed_at: None,
                order_index: 1.0,
                pinned: false,
                repeat: None,
                subtasks: serde_json::json!([]),
                updated_at: "2026-01-01T00:00:00+00:00".into(),
                deleted_at: None,
            }],
            task_labels: vec![SyncTaskLabel {
                task_id: "t1".into(),
                label_id: "l1".into(),
                updated_at: "2026-01-01T00:00:00+00:00".into(),
                deleted_at: None,
            }],
            sessions: vec![],
        };
        apply_bundle(&conn, &bundle).unwrap();

        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "milk");

        // An older remote edit is ignored.
        let mut older = bundle;
        older.tasks[0].title = "STALE".into();
        older.tasks[0].updated_at = "2025-01-01T00:00:00+00:00".into();
        apply_bundle(&conn, &older).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "milk");

        // A newer remote edit wins, even across a different UTC offset.
        let newer_bundle = SyncBundle {
            tasks: vec![SyncTask {
                id: "t1".into(),
                title: "oat milk".into(),
                notes: None,
                due_date: None,
                remind_at: None,
                status: "active".into(),
                priority: 4,
                created_at: "2026-01-01T00:00:00+00:00".into(),
                completed_at: None,
                order_index: 1.0,
                pinned: true,
                repeat: None,
                subtasks: serde_json::json!([{"id":1,"text":"a","done":false}]),
                updated_at: "2026-06-01T05:00:00+05:00".into(),
                deleted_at: None,
            }],
            ..Default::default()
        };
        apply_bundle(&conn, &newer_bundle).unwrap();
        let (title, pinned): (String, i64) = conn
            .query_row("SELECT title, pinned FROM tasks WHERE id = 't1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(title, "oat milk");
        assert_eq!(pinned, 1);
    }

    #[test]
    fn changes_since_respects_watermark_and_tombstones() {
        let conn = setup();
        conn.execute(
            "INSERT INTO labels (id, name, color, updated_at, deleted_at)
             VALUES ('old', 'x', '#000', '2025-01-01T00:00:00+00:00', NULL),
                    ('new', 'y', '#111', '2026-05-01T00:00:00+00:00', '2026-05-02T00:00:00+00:00')",
            [],
        )
        .unwrap();

        let bundle = collect_changes(&conn, "2026-01-01T00:00:00+00:00").unwrap();
        assert_eq!(bundle.labels.len(), 1);
        assert_eq!(bundle.labels[0].id, "new");
        // The tombstone travels so the deletion can propagate.
        assert!(bundle.labels[0].deleted_at.is_some());
    }

    #[test]
    fn changed_association_drags_its_parents_along() {
        let conn = setup();
        // A label and task synced long ago (updated_at below the watermark).
        conn.execute(
            "INSERT INTO labels (id, name, color, updated_at) VALUES ('l1', 'home', '#111', ?1)",
            ["2020-01-01T00:00:00+00:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t1', 'x', ?1, ?1)",
            ["2020-01-01T00:00:00+00:00"],
        )
        .unwrap();
        // A fresh association above the watermark.
        conn.execute(
            "INSERT INTO task_labels (task_id, label_id, updated_at) VALUES ('t1', 'l1', ?1)",
            ["2026-06-01T00:00:00+00:00"],
        )
        .unwrap();

        let bundle = collect_changes(&conn, "2026-01-01T00:00:00+00:00").unwrap();
        // The association is newer than the watermark, so it must ship — and so
        // must its parents, even though they weren't touched, or the push would
        // trip the foreign key.
        assert_eq!(bundle.task_labels.len(), 1);
        assert_eq!(bundle.labels.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), ["l1"]);
        assert_eq!(bundle.tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t1"]);
    }

    #[test]
    fn purge_drops_only_old_tombstones() {
        let conn = setup();
        let recent = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO labels (id, name, color, updated_at, deleted_at) VALUES
                ('live', 'a', '#000', ?1, NULL),
                ('fresh_del', 'b', '#000', ?1, ?1),
                ('old_del', 'c', '#000', '2020-01-01T00:00:00+00:00', '2020-01-01T00:00:00+00:00')",
            [recent],
        )
        .unwrap();

        purge_tombstones(&conn, 30).unwrap();

        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM labels ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        // Live row and the recent tombstone stay; only the long-dead one goes.
        assert_eq!(ids, vec!["fresh_del", "live"]);
    }
}
