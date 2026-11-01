//! Support for the in-app updater.
//!
//! The update check and install themselves live in `tauri-plugin-updater` and
//! are driven from the frontend; what can't be answered there is whether this
//! particular install is one the updater is able to replace, and how to reach
//! the user when the window isn't on screen.

use crate::db::Db;
use crate::popup::PopupKind;
use tauri::{AppHandle, Manager};

/// Whether this build can install an update over itself.
///
/// On Linux the updater only knows how to swap out a running AppImage — a
/// `.deb` or `.rpm` install is owned by the system package manager, and
/// letting the updater loose on it would either fail or leave the package
/// database describing a version that is no longer on disk. Those installs are
/// pointed at the release page instead. Every other platform installs through
/// its own bundle, which the updater can always replace.
#[tauri::command]
pub fn can_self_update() -> bool {
    if cfg!(target_os = "linux") {
        // Set by the AppImage runtime to the path of the mounted image.
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

/// Tell the user a new version is waiting.
///
/// A background check can land while todofy is minimised to the tray, where
/// the marker in the top bar and the panel in Settings are both invisible —
/// so the news goes out the same way a reminder would, through the corner
/// popup or the desktop's own notifications depending on the user's chosen
/// style. Honours the desktop-notification switch: someone who turned
/// notifications off is not carved out an exception for this.
#[tauri::command]
pub fn notify_update(app: AppHandle, version: String, can_install: bool) {
    let enabled = {
        let db = app.state::<Db>();
        let conn = db.conn();
        crate::settings::desktop_notifications_enabled(&conn)
    };
    if !enabled {
        return;
    }

    let title = format!("todofy {version} is available");
    let body = if can_install {
        "Click to download and install it."
    } else {
        "Click to see how to update."
    };
    let style = crate::notify::global_style(&app);
    let _ = crate::notify::deliver(&app, &style, PopupKind::Update, &title, body, None, None);
}
