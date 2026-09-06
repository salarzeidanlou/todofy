mod calendar;
mod commands;
mod db;
mod google_calendar;
mod models;
mod notify;
mod popup;
mod quickwin;
mod recur;
mod scheduler;
mod secret;
mod settings;
mod sync;
mod timer;
mod tray;

use db::Db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const DEEP_LINK_SCHEME: &str = "todofy://";
const DEEP_LINK_EVENT: &str = "deep-link";

/// Flag added to the launch-on-login command so the app can tell a login
/// launch apart from the user opening it by hand.
const AUTOSTART_FLAG: &str = "--autostart";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the FIRST plugin: if todofy is already running, a second
        // launch focuses the existing window instead of starting a new one.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            // On Linux/Windows a deep link into the running app arrives as a
            // CLI arg to this second launch; forward it to the frontend.
            if let Some(url) = args.iter().find(|a| a.starts_with(DEEP_LINK_SCHEME)) {
                let _ = app.emit(DEEP_LINK_EVENT, url.clone());
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
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
            let conn = Connection::open(dir.join("todofy.db")).expect("failed to open database");
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

            // Forward deep links delivered at runtime to the frontend.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().into_iter().next() {
                    let _ = handle.emit(DEEP_LINK_EVENT, url.to_string());
                }
            });
            // No installer wires the scheme in dev/Linux, so register at runtime.
            #[cfg(any(target_os = "linux", debug_assertions))]
            {
                let _ = app.deep_link().register_all();
            }

            // Start the reminder scheduler.
            scheduler::spawn(app.handle().clone());

            // Nudge the frontend to push tasks to Google Calendar when they drift.
            calendar::spawn(app.handle().clone());

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
            commands::list_journal,
            commands::create_journal,
            commands::update_journal,
            commands::delete_journal,
            commands::list_events,
            commands::create_event,
            commands::update_event,
            commands::delete_event,
            notify::send_test_notification,
            popup::notify_popup_dismiss,
            popup::notify_popup_open,
            popup::notify_popup_pending,
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
            sync::sync_changes_since,
            sync::sync_apply,
            sync::sync_get_watermark,
            sync::sync_set_watermark,
            sync::sync_reset,
            sync::wipe_local_data,
            sync::sync_purge_tombstones,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            google_calendar::google_oauth_flow,
            calendar::calendar_pending,
            calendar::calendar_link_set,
            calendar::calendar_link_remove,
            calendar::calendar_clear_links,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
