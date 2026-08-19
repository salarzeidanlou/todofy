//! Custom in-app notification popup.
//!
//! Instead of handing reminders to the OS, we draw them ourselves in a small
//! borderless, always-on-top, non-focusing window pinned to a screen corner
//! (the `notification` window in `tauri.conf.json`). This works uniformly
//! regardless of the desktop's notification daemon.

use crate::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

/// Label of the popup window, defined in tauri.conf.json.
pub const POPUP_LABEL: &str = "notification";

/// Gap (logical px) between the popup and the screen edges.
const MARGIN: i32 = 16;

/// Payload sent to the popup webview so it can render the card.
#[derive(Serialize, Clone)]
struct PopupPayload {
    /// Unique per show, so the webview resets its auto-dismiss timer.
    nonce: u64,
    title: String,
    body: String,
    /// Task to open when the user clicks the card, if any.
    task_id: Option<i64>,
}

/// Position the popup in the configured corner, push the content to its webview,
/// and show it without stealing focus.
pub fn show(app: &AppHandle, title: &str, body: &str, task_id: Option<i64>) {
    let Some(win) = app.get_webview_window(POPUP_LABEL) else {
        return;
    };

    let corner = {
        let db = app.state::<Db>();
        let conn = db.conn();
        crate::settings::notification_position(&conn)
    };

    if let Some(pos) = corner_position(app, &win, &corner) {
        let _ = win.set_position(pos);
    }

    use std::sync::atomic::{AtomicU64, Ordering};
    static NONCE: AtomicU64 = AtomicU64::new(1);
    let payload = PopupPayload {
        nonce: NONCE.fetch_add(1, Ordering::Relaxed),
        title: title.to_owned(),
        body: body.to_owned(),
        task_id,
    };
    let _ = win.emit_to(POPUP_LABEL, "notify-show", payload);
    let _ = win.show();
    let _ = win.set_always_on_top(true);
}

/// Top-left corner (physical px) for the popup on the current monitor.
fn corner_position(
    app: &AppHandle,
    win: &tauri::WebviewWindow,
    corner: &str,
) -> Option<PhysicalPosition<i32>> {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())?;

    let scale = monitor.scale_factor();
    let margin = (MARGIN as f64 * scale) as i32;

    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let win_size = win.outer_size().ok()?;

    let left = mon_pos.x + margin;
    let right = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - margin;
    let top = mon_pos.y + margin;
    let bottom = mon_pos.y + mon_size.height as i32 - win_size.height as i32 - margin;

    let (x, y) = match corner {
        "top-left" => (left, top),
        "top-right" => (right, top),
        "bottom-left" => (left, bottom),
        _ => (right, bottom), // bottom-right default
    };
    Some(PhysicalPosition::new(x, y))
}

/// Hide the popup (called by the webview when it auto-dismisses or is closed).
#[tauri::command]
pub fn notify_popup_dismiss(app: AppHandle) {
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        let _ = win.hide();
    }
}

/// Bring the main window forward (optionally selecting a task) and hide the
/// popup — the action behind clicking the notification card.
#[tauri::command]
pub fn notify_popup_open(app: AppHandle, task_id: Option<i64>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        if let Some(id) = task_id {
            let _ = main.emit("reminder-open", id);
        }
    }
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        let _ = win.hide();
    }
}
