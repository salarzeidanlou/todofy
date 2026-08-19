use crate::db::Db;
use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const POLL_SECONDS: u64 = 20;

/// When a task has a due date but no explicit reminder time, fire the reminder
/// at this hour (local) on the due day, so date-only tasks still nudge.
const DEFAULT_REMINDER_HOUR: u32 = 9;

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
    let (notifications_enabled, custom_popup) = {
        let db = app.state::<Db>();
        let conn = db.conn();
        (
            crate::settings::desktop_notifications_enabled(&conn),
            crate::settings::notification_style(&conn) != "native",
        )
    };

    let due = collect_due(app)?;
    for r in due {
        if notifications_enabled {
            // Fires even when the window is hidden in the tray, since this runs
            // on a background thread. Routes to the custom popup or the OS per
            // the user's setting.
            crate::notify::send(app, &r.title, "⏰ Reminder · todofy", Some(r.id));
        }
        // The custom popup already is our in-app surface; only emit the toast
        // for the main window when we're using OS notifications, to avoid a
        // duplicate reminder showing up twice.
        if !(notifications_enabled && custom_popup) {
            let _ = app.emit("reminder-fired", r.clone());
        }
    }
    // Focus timers (Pomodoro + per-task stopwatch) also need background nudges.
    crate::timer::poll(app, notifications_enabled);
    Ok(())
}

/// Find active tasks whose reminder time has passed and that have not
/// been notified yet, then mark them notified in the same pass.
fn collect_due(app: &AppHandle) -> Result<Vec<DueReminder>, String> {
    let db = app.state::<Db>();
    let conn = db.conn();
    let now = Local::now();

    // A task can fire from an explicit reminder time (`remind_at`) or, failing
    // that, from a due date alone — treated as DEFAULT_REMINDER_HOUR on that day.
    let mut stmt = conn
        .prepare(
            "SELECT id, title, remind_at, due_date FROM tasks
             WHERE status = 'active' AND notified = 0
               AND (remind_at IS NOT NULL OR due_date IS NOT NULL)",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<(i64, String, Option<String>, Option<String>)>>>()
        .map_err(|e| e.to_string())?;

    let mut due = Vec::new();
    for (id, title, remind_at, due_date) in rows {
        let fires_at = reminder_instant(remind_at.as_deref(), due_date.as_deref());
        if fires_at.map(|t| t <= now).unwrap_or(false) {
            conn.execute("UPDATE tasks SET notified = 1 WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
            due.push(DueReminder { id, title });
        }
    }
    Ok(due)
}

/// Resolve when a task should notify: its explicit `remind_at` if set,
/// otherwise its `due_date` at the default reminder hour. `None` means the
/// task has no schedulable time (or the stored value could not be parsed).
fn reminder_instant(remind_at: Option<&str>, due_date: Option<&str>) -> Option<DateTime<Local>> {
    if let Some(ra) = remind_at {
        return DateTime::parse_from_rfc3339(ra)
            .ok()
            .map(|dt| dt.with_timezone(&Local));
    }
    let day = NaiveDate::parse_from_str(due_date?, "%Y-%m-%d").ok()?;
    let time = NaiveTime::from_hms_opt(DEFAULT_REMINDER_HOUR, 0, 0)?;
    Local.from_local_datetime(&day.and_time(time)).single()
}
