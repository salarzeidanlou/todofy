use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// Label of the quick-add window (defined in tauri.conf.json).
pub const QUICK_LABEL: &str = "quickadd";

/// The global hotkey that summons quick-add: Ctrl+Alt+A.
pub fn quick_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA)
}

/// Toggle the quick-add window: if it's already up and focused, dismiss it;
/// otherwise re-center it (handles multi-monitor), show it, and tell the
/// webview to clear and focus its input.
pub fn toggle(app: &AppHandle) {
    let Some(win) = app.get_webview_window(QUICK_LABEL) else {
        return;
    };
    let up = win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false);
    if up {
        let _ = win.hide();
    } else {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("quick-show", ());
    }
}
