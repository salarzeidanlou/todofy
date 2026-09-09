use crate::db::Db;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Read a setting value, or `None` if it was never set.
pub fn read(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
}

/// Upsert a setting value.
pub fn write(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Whether native OS notifications should fire for reminders and timers.
/// Defaults to enabled when the user has never touched the setting.
pub fn desktop_notifications_enabled(conn: &Connection) -> bool {
    read(conn, "desktop_notifications_enabled").as_deref() != Some("false")
}

/// How notifications are shown: `"custom"` = todofy's own corner popup window,
/// `"native"` = the OS notification. Defaults to custom.
pub fn notification_style(conn: &Connection) -> String {
    read(conn, "notification_style").unwrap_or_else(|| "custom".into())
}

/// Which screen corner the custom popup appears in: one of `top-right`,
/// `top-left`, `bottom-right`, `bottom-left`. Defaults to bottom-right.
pub fn notification_position(conn: &Connection) -> String {
    read(conn, "notification_position").unwrap_or_else(|| "bottom-right".into())
}

/// How often an unanswered reminder repeats, in minutes. `None` (the default)
/// fires once and stops.
pub fn reminder_repeat_minutes(conn: &Connection) -> Option<i64> {
    read(conn, "reminder_repeat_minutes")?
        .parse::<i64>()
        .ok()
        .filter(|m| *m > 0)
}

/// What a task's play button does: `"tracker"` = a plain stopwatch,
/// `"pomodoro"` = the stopwatch plus a focus countdown bound to that task.
pub fn task_timer_mode(conn: &Connection) -> String {
    read(conn, "task_timer_mode").unwrap_or_else(|| "tracker".into())
}

/// The desktop's locale as a BCP-47 tag (e.g. `de-DE`), or `None` if the
/// environment says nothing useful.
///
/// The webview cannot be trusted for this: under WebKitGTK `navigator.language`
/// commonly reports `en-US` regardless of the session's `LC_TIME`, which is why
/// clock and calendar formatting looked American on systems that are not.
/// POSIX precedence is `LC_ALL` > `LC_TIME` > `LANG`.
fn read_system_locale() -> Option<String> {
    ["LC_ALL", "LC_TIME", "LANG"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .and_then(|raw| normalize_locale(&raw))
}

/// Turn a POSIX locale string into a BCP-47 tag: `de_DE.UTF-8@euro` -> `de-DE`.
/// The C/POSIX locales carry no regional convention, so they read as "no
/// preference" and let the app fall back to its own defaults.
fn normalize_locale(raw: &str) -> Option<String> {
    let base = raw
        .split(['.', '@'])
        .next()
        .unwrap_or_default()
        .replace('_', "-");
    if base.is_empty() || base.eq_ignore_ascii_case("C") || base.eq_ignore_ascii_case("POSIX") {
        return None;
    }
    Some(base)
}

#[tauri::command]
pub fn system_locale() -> Option<String> {
    read_system_locale()
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    Ok(read(&db.conn(), &key))
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    write(&db.conn(), &key, &value).map_err(|e| e.to_string())
}

/// Whether todofy is registered to launch when the user logs in.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Enable or disable launch-on-login. The registered command carries the
/// `--autostart` flag (see `lib.rs`), which the app reads at startup to decide
/// whether to open its window or stay in the tray per the `startup_mode` setting.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_locale;

    #[test]
    fn strips_encoding_and_modifier() {
        assert_eq!(normalize_locale("de_DE.UTF-8"), Some("de-DE".into()));
        assert_eq!(normalize_locale("de_DE.UTF-8@euro"), Some("de-DE".into()));
        assert_eq!(normalize_locale("en_GB"), Some("en-GB".into()));
        assert_eq!(normalize_locale("fr"), Some("fr".into()));
    }

    #[test]
    fn treats_c_locales_as_no_preference() {
        assert_eq!(normalize_locale("C"), None);
        assert_eq!(normalize_locale("POSIX"), None);
        assert_eq!(normalize_locale("C.UTF-8"), None);
        assert_eq!(normalize_locale(""), None);
    }
}
