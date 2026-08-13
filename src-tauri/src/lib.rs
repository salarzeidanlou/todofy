mod commands;
mod db;
mod models;
mod quickwin;
mod scheduler;
mod tray;

use db::Db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the FIRST plugin: if todofy is already running, a second
        // launch focuses the existing window instead of starting a new one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Global hotkey (Ctrl+Alt+A) to summon the quick-add window from anywhere.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut == &quickwin::quick_shortcut()
                    {
                        quickwin::toggle(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Open (or create) the SQLite database in the app data dir.
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = Connection::open(dir.join("todofy.db"))
                .expect("failed to open database");
            db::init(&conn).expect("failed to initialize schema");
            app.manage(Db(Mutex::new(conn)));

            // Register the global quick-add hotkey. If the desktop
            // environment has already claimed Ctrl+Alt+A, log and carry on.
            if let Err(e) = app.global_shortcut().register(quickwin::quick_shortcut()) {
                eprintln!("todofy: could not register Ctrl+Alt+A global shortcut: {e}");
            }

            // Start the reminder scheduler.
            scheduler::spawn(app.handle().clone());

            // System-tray icon with Show / Quit.
            tray::init(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it to the tray instead of quitting.
            // Use the tray's "Quit" (or an explicit app.exit) to fully exit.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::create_task,
            commands::update_task,
            commands::reorder_task,
            commands::toggle_task,
            commands::delete_task,
            commands::list_labels,
            commands::create_label,
            commands::update_label,
            commands::delete_label,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
