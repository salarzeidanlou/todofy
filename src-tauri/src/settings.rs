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
