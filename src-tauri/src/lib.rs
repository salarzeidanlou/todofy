mod commands;
mod db;
mod models;
mod quickwin;
mod recur;
mod scheduler;
mod settings;
mod timer;
mod tray;

use db::Db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Flag added to the launch-on-login command so the app can tell a login
/// launch apart from the user opening it by hand.
const AUTOSTART_FLAG: &str = "--autostart";

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
        // Launch-on-login. The registered command carries AUTOSTART_FLAG so the
        // setup hook below can decide between opening the window and staying in
        // the tray based on the user's `startup_mode` setting.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
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

            // The main window starts hidden (visible:false in tauri.conf.json)
            // so a login launch can go straight to the tray without a flash.
            // Reveal it now unless this is an autostart launch configured to
            // start minimized to the tray.
            let launched_at_startup = std::env::args().any(|a| a == AUTOSTART_FLAG);
            let start_in_tray = {
                let db = app.state::<Db>();
                let conn = db.conn();
                settings::read(&conn, "startup_mode").as_deref() == Some("tray")
            };
            if let Some(win) = app.get_webview_window("main") {
                if !(launched_at_startup && start_in_tray) {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            // Register the global quick-add hotkey. If the desktop
            // environment has already claimed Ctrl+Alt+A, log and carry on.
            if let Err(e) = app.global_shortcut().register(quickwin::quick_shortcut()) {
                eprintln!("todofy: could not register Ctrl+Alt+A global shortcut: {e}");
            }

            // Start the reminder scheduler.
            scheduler::spawn(app.handle().clone());

            // System-tray icon with focus controls + live timer status.
            tray::init(app)?;
            tray::spawn_updater(app.handle().clone());
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
            settings::get_setting,
            settings::set_setting,
            settings::get_autostart,
            settings::set_autostart,
            timer::start_timer,
            timer::stop_timer,
            timer::active_timer,
            timer::focus_history,
            timer::get_pomodoro,
            timer::pomodoro_start,
            timer::pomodoro_pause,
            timer::pomodoro_reset,
            timer::pomodoro_next,
            timer::set_pomodoro_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
