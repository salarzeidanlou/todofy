//! Desktop notifications.
//!
//! We prefer the XDG desktop portal (`org.freedesktop.portal.Notification`)
//! over the classic `org.freedesktop.Notifications` interface that
//! `tauri-plugin-notification` uses, because the classic name can be claimed by
//! a stray process on some sessions that accepts notifications but never shows a
//! banner. If the portal call fails we fall back to the plugin.
//!
//! When the user picks the `custom` notification style we instead draw our own
//! corner popup window (see [`crate::popup`]).

use crate::db::Db;
use crate::popup::PopupKind;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Show a desktop notification with `title` and `body`, routed per the user's
/// global style setting. `task_id` lets the custom popup open the right task on
/// click. Best-effort.
///
/// Used by notifications that belong to no particular task — a finished
/// Pomodoro phase, an available update. A reminder goes through
/// [`deliver_reminder`] instead, since its style comes from its priority.
pub fn send(app: &AppHandle, title: &str, body: &str, task_id: Option<String>) {
    let style = global_style(app);
    let _ = deliver(app, &style, PopupKind::Reminder, title, body, None, task_id);
}

/// A task reminder, routed per the style its priority profile resolved to and
/// wearing that priority's color.
pub fn deliver_reminder(
    app: &AppHandle,
    style: &str,
    title: &str,
    body: &str,
    accent: &str,
    task_id: String,
) {
    let accent = (!accent.is_empty()).then(|| accent.to_owned());
    let _ = deliver(
        app,
        style,
        PopupKind::Reminder,
        title,
        body,
        accent,
        Some(task_id),
    );
}

pub fn global_style(app: &AppHandle) -> String {
    let db = app.state::<Db>();
    let conn = db.conn();
    crate::settings::notification_style(&conn)
}

/// Deliver via `style` and report which path did it: `"popup"` (custom
/// window), `"portal"`, or `"fallback"`. `Err` means the system paths failed.
/// Used by the Settings test button so the user sees how it was routed.
pub fn deliver(
    app: &AppHandle,
    style: &str,
    kind: PopupKind,
    title: &str,
    body: &str,
    accent: Option<String>,
    task_id: Option<String>,
) -> Result<&'static str, String> {
    if style != "native" {
        crate::popup::show_kind(app, kind, title, body, accent, task_id);
        return Ok("popup");
    }

    match portal_send(title, body) {
        Ok(()) => Ok("portal"),
        Err(portal_err) => app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map(|()| "fallback")
            .map_err(|plugin_err| format!("portal: {portal_err}; plugin: {plugin_err}")),
    }
}

/// Send a one-off test notification. Returns the delivery path on success.
#[tauri::command]
pub fn send_test_notification(app: AppHandle) -> Result<String, String> {
    let style = global_style(&app);
    deliver(
        &app,
        &style,
        PopupKind::Reminder,
        "todofy test notification",
        "If you can see this, desktop notifications are working.",
        None,
        None,
    )
    .map(str::to_string)
}

/// Deliver a notification via `org.freedesktop.portal.Notification.AddNotification`.
fn portal_send(title: &str, body: &str) -> zbus::Result<()> {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use zbus::blocking::Connection;
    use zbus::zvariant::Value;

    // A distinct id per notification so successive reminders stack instead of
    // replacing one another (the portal treats a repeated id as an update).
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let id = format!("todofy-{}", COUNTER.fetch_add(1, Ordering::Relaxed));

    let mut notification: HashMap<&str, Value> = HashMap::new();
    notification.insert("title", Value::from(title.to_owned()));
    notification.insert("body", Value::from(body.to_owned()));
    notification.insert("priority", Value::from("normal"));

    let conn = Connection::session()?;
    conn.call_method(
        Some("org.freedesktop.portal.Desktop"),
        "/org/freedesktop/portal/desktop",
        Some("org.freedesktop.portal.Notification"),
        "AddNotification",
        &(id.as_str(), notification),
    )?;
    Ok(())
}
