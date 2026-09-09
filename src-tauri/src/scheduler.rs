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
    id: String,
    title: String,
    round: i64,
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
            crate::notify::send(app, &r.title, "⏰ Reminder · todofy", Some(r.id.clone()));
            // Played by the main webview: unlike the popup window, it has
            // almost certainly had the user gesture audio playback requires.
            let _ = app.emit_to("main", "reminder-sound", r.round);
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

/// Active tasks whose reminder should show now, either for the first time or
/// as a repeat, marked as nudged in the same pass.
fn collect_due(app: &AppHandle) -> Result<Vec<DueReminder>, String> {
    let db = app.state::<Db>();
    let conn = db.conn();
    let now = Local::now();
    let repeat_after = crate::settings::reminder_repeat_minutes(&conn);

    // A task can fire from an explicit reminder time (`remind_at`) or, failing
    // that, from a due date alone — treated as DEFAULT_REMINDER_HOUR on that day.
    // Repeats are limited to reminders the user hasn't answered yet.
    let mut stmt = conn
        .prepare(
            "SELECT id, title, remind_at, due_date, notified, last_notified_at FROM tasks
             WHERE status = 'active' AND deleted_at IS NULL
               AND (remind_at IS NOT NULL OR due_date IS NOT NULL)
               AND (notified = 0 OR reminder_ack_at IS NULL)",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut due = Vec::new();
    for (id, title, remind_at, due_date, notified, last_notified_at) in rows {
        let Some(fires_at) = reminder_instant(remind_at.as_deref(), due_date.as_deref()) else {
            continue;
        };
        if fires_at > now {
            continue;
        }
        if notified != 0 && !repeat_is_due(repeat_after, last_notified_at.as_deref(), now) {
            continue;
        }
        let round = notified + 1;
        conn.execute(
            "UPDATE tasks SET notified = ?1, last_notified_at = ?2 WHERE id = ?3",
            rusqlite::params![round, now.to_rfc3339(), id],
        )
        .map_err(|e| e.to_string())?;
        due.push(DueReminder { id, title, round });
    }
    Ok(due)
}

/// Is a shown reminder ready to show again? A missing or unparseable
/// timestamp counts as ready, so one can't get stuck un-repeatable.
fn repeat_is_due(
    repeat_after: Option<i64>,
    last_notified_at: Option<&str>,
    now: DateTime<Local>,
) -> bool {
    let Some(minutes) = repeat_after else {
        return false;
    };
    match last_notified_at.and_then(|at| DateTime::parse_from_rfc3339(at).ok()) {
        Some(last) => now.signed_duration_since(last).num_minutes() >= minutes,
        None => true,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn a_reminder_only_repeats_when_repeats_are_switched_on() {
        let now = Local::now();
        let long_ago = (now - Duration::hours(3)).to_rfc3339();
        assert!(
            !repeat_is_due(None, Some(&long_ago), now),
            "off means once, however long ago it fired"
        );
        assert!(repeat_is_due(Some(5), Some(&long_ago), now));
    }

    #[test]
    fn the_interval_has_to_fully_elapse() {
        let now = Local::now();
        let four_min = (now - Duration::minutes(4)).to_rfc3339();
        let five_min = (now - Duration::minutes(5)).to_rfc3339();
        assert!(!repeat_is_due(Some(5), Some(&four_min), now));
        assert!(repeat_is_due(Some(5), Some(&five_min), now));
    }

    /// A corrupt timestamp must not strand a reminder.
    #[test]
    fn an_unreadable_last_notified_time_repeats_rather_than_sticking() {
        let now = Local::now();
        assert!(repeat_is_due(Some(5), None, now));
        assert!(repeat_is_due(Some(5), Some("not a timestamp"), now));
    }

    /// A backwards clock jump must not fire a repeat every poll.
    #[test]
    fn a_future_timestamp_does_not_fire() {
        let now = Local::now();
        let ahead = (now + Duration::minutes(10)).to_rfc3339();
        assert!(!repeat_is_due(Some(5), Some(&ahead), now));
    }
}
