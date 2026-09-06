//! Local half of the one-way Google Calendar push. Like `sync.rs` does for
//! Supabase, this module never talks to Google — it diffs local SQLite and
//! hands the frontend the set of events to create, update, or delete; the
//! frontend (`src/lib/googleCalendar.ts`) makes the actual API calls. A poll
//! thread nudges the frontend when tasks drift from their events, so pushes
//! keep flowing even while the window is hidden in the tray.

use crate::db::Db;
use crate::settings;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const POLL_SECONDS: u64 = 15;
const PUSH_EVENT: &str = "calendar-push";

/// A task that needs its calendar event created or updated.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    task_id: String,
    title: String,
    notes: Option<String>,
    due_date: Option<String>,
    remind_at: Option<String>,
    status: String,
    updated_at: String,
    /// Existing event id if the task is already linked, so the frontend PATCHes
    /// the same event instead of creating a duplicate.
    event_id: Option<String>,
}

/// A linked event whose task no longer qualifies (deleted or un-dated) and so
/// must be removed from the calendar.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDelete {
    task_id: String,
    external_event_id: String,
    external_calendar_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    upserts: Vec<TaskEvent>,
    deletes: Vec<PendingDelete>,
}

// Push-scope settings. `keep_completed`: leave finished tasks on the calendar
// (with a "✓" title) instead of deleting their event on completion (default
// off). `timed_only`: only push tasks that have a set time, skipping date-only
// (all-day) tasks (default off).
const KEEP_COMPLETED_KEY: &str = "calendar_keep_completed";
const TIMED_ONLY_KEY: &str = "calendar_timed_only";

const UPSERT_SELECT: &str = "
    SELECT t.id, t.title, t.notes, t.due_date, t.remind_at, t.status, t.updated_at,
           cl.external_event_id
    FROM tasks t
    LEFT JOIN calendar_links cl ON cl.task_id = t.id";

const DELETE_SELECT: &str = "
    SELECT cl.task_id, cl.external_event_id, cl.external_calendar_id
    FROM calendar_links cl
    JOIN tasks t ON t.id = cl.task_id";

/// Build the (upsert, delete) SQL for the current push-scope settings. A task
/// gets an event while it "qualifies"; the delete query is that predicate's
/// exact complement over already-linked tasks, so a task that falls out of
/// scope (deleted, completed, un-dated, or no longer timed) loses its event.
/// The task row survives soft-delete through the tombstone window, so a
/// just-deleted task is still joinable in the delete pass.
fn queries(conn: &Connection) -> (String, String) {
    let keep_completed = settings::read(conn, KEEP_COMPLETED_KEY).as_deref() == Some("true");
    let timed_only = settings::read(conn, TIMED_ONLY_KEY).as_deref() == Some("true");

    let mut qualifies = String::from("t.deleted_at IS NULL AND t.due_date IS NOT NULL");
    if !keep_completed {
        qualifies.push_str(" AND t.status = 'active'");
    }
    if timed_only {
        qualifies.push_str(" AND t.remind_at IS NOT NULL");
    }

    let upsert = format!(
        "{UPSERT_SELECT} WHERE {qualifies}
         AND (cl.task_id IS NULL OR cl.pushed_updated_at <> t.updated_at)"
    );
    let delete = format!("{DELETE_SELECT} WHERE NOT ({qualifies})");
    (upsert, delete)
}

#[tauri::command]
pub fn calendar_pending(db: State<Db>) -> Result<Pending, String> {
    let conn = db.conn();
    let (upsert_sql, delete_sql) = queries(&conn);

    let mut upsert_stmt = conn.prepare(&upsert_sql).map_err(|e| e.to_string())?;
    let upserts = upsert_stmt
        .query_map([], |r| {
            Ok(TaskEvent {
                task_id: r.get(0)?,
                title: r.get(1)?,
                notes: r.get(2)?,
                due_date: r.get(3)?,
                remind_at: r.get(4)?,
                status: r.get(5)?,
                updated_at: r.get(6)?,
                event_id: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut delete_stmt = conn.prepare(&delete_sql).map_err(|e| e.to_string())?;
    let deletes = delete_stmt
        .query_map([], |r| {
            Ok(PendingDelete {
                task_id: r.get(0)?,
                external_event_id: r.get(1)?,
                external_calendar_id: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(Pending { upserts, deletes })
}

/// Record a successful create/update: remember the event id and the task's
/// `updated_at` at push time so it isn't re-pushed until it changes again.
#[tauri::command]
pub fn calendar_link_set(
    db: State<Db>,
    task_id: String,
    event_id: String,
    calendar_id: String,
    pushed_updated_at: String,
) -> Result<(), String> {
    db.conn()
        .execute(
            "INSERT INTO calendar_links
                (task_id, external_event_id, external_calendar_id, pushed_updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, NULL)
             ON CONFLICT(task_id) DO UPDATE SET
                external_event_id = excluded.external_event_id,
                external_calendar_id = excluded.external_calendar_id,
                pushed_updated_at = excluded.pushed_updated_at,
                deleted_at = NULL",
            params![task_id, event_id, calendar_id, pushed_updated_at],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Drop a link once its remote event has been deleted.
#[tauri::command]
pub fn calendar_link_remove(db: State<Db>, task_id: String) -> Result<(), String> {
    db.conn()
        .execute("DELETE FROM calendar_links WHERE task_id = ?1", [&task_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Forget every link. Used when disconnecting and deleting the remote calendar,
/// so a later reconnect starts clean instead of pointing at gone events.
#[tauri::command]
pub fn calendar_clear_links(db: State<Db>) -> Result<(), String> {
    db.conn()
        .execute("DELETE FROM calendar_links", [])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// True when at least one task needs an event created, updated, or removed.
fn has_pending(conn: &Connection) -> bool {
    let (upsert_sql, delete_sql) = queries(conn);
    let sql = format!("SELECT EXISTS({upsert_sql}) OR EXISTS({delete_sql})");
    conn.query_row(&sql, [], |r| r.get::<_, i64>(0))
        .map(|n| n != 0)
        .unwrap_or(false)
}

/// Background poll: while calendar sync is connected, nudge the frontend to
/// push whenever local tasks have drifted from their calendar events.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        {
            let db = app.state::<Db>();
            let conn = db.conn();
            let connected =
                settings::read(&conn, "calendar_google_connected").as_deref() == Some("true");
            if connected && has_pending(&conn) {
                let _ = app.emit(PUSH_EVENT, ());
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(POLL_SECONDS));
    });
}
