use crate::db::Db;
use chrono::{DateTime, Local};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

const POLL_SECONDS: u64 = 20;

/// A reminder that is due to fire. Also the payload for the
/// `reminder-fired` event the frontend listens for.
#[derive(Serialize, Clone)]
struct DueReminder {
    id: i64,
    title: String,
}

/// Spawn a background thread that periodically checks for tasks whose
/// `remind_at` has passed and fires a native desktop notification once.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Err(e) = tick(&app) {
            eprintln!("[scheduler] error: {e}");
        }
        std::thread::sleep(std::time::Duration::from_secs(POLL_SECONDS));
    });
}

fn tick(app: &AppHandle) -> Result<(), String> {
    let due = collect_due(app)?;
    for r in due {
        // Native OS notification — fires even when the window is hidden in
        // the tray, since this runs on a background thread.
        let _ = app
            .notification()
            .builder()
            .title(&r.title)
            .body("⏰ Reminder · todofy")
            .show();
        // Let an open window surface an in-app reminder toast too.
        let _ = app.emit("reminder-fired", r.clone());
    }
    Ok(())
}

/// Find active tasks whose reminder time has passed and that have not
/// been notified yet, then mark them notified in the same pass.
fn collect_due(app: &AppHandle) -> Result<Vec<DueReminder>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let now = Local::now();

    let mut stmt = conn
        .prepare(
            "SELECT id, title, remind_at FROM tasks
             WHERE status = 'active' AND notified = 0 AND remind_at IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<(i64, String, String)>>>()
        .map_err(|e| e.to_string())?;

    let mut due = Vec::new();
    for (id, title, remind_at) in rows {
        let fires = DateTime::parse_from_rfc3339(&remind_at)
            .map(|dt| dt.with_timezone(&Local) <= now)
            .unwrap_or(false);
        if fires {
            conn.execute("UPDATE tasks SET notified = 1 WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
            due.push(DueReminder { id, title });
        }
    }
    Ok(due)
}
