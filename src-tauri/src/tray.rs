use crate::timer;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Wry,
};

/// Menu items the timer updater keeps in sync, held in managed state so the
/// background thread can reach them.
pub struct TrayMenu {
    status: MenuItem<Wry>,
    pomodoro: MenuItem<Wry>,
    stop_task: MenuItem<Wry>,
}

/// Bring the main window to the foreground.
fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Install a system-tray icon. The menu carries a live timer status line plus
/// focus controls (start/pause Pomodoro, stop the task stopwatch) alongside
/// Show / Quit. Left-clicking the icon focuses the window.
pub fn init(app: &App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "No timer running", false, None::<&str>)?;
    let pomodoro = MenuItem::with_id(app, "pomodoro", "Start focus", true, None::<&str>)?;
    let stop_task = MenuItem::with_id(app, "stop_task", "Stop task timer", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show todofy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&status, &sep1, &pomodoro, &stop_task, &sep2, &show, &quit],
    )?;

    app.manage(TrayMenu {
        status: status.clone(),
        pomodoro: pomodoro.clone(),
        stop_task: stop_task.clone(),
    });

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("todofy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            "pomodoro" => timer::tray_toggle_pomodoro(app),
            "stop_task" => timer::tray_stop_task(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Push the given display state onto the tray icon and menu. Must run on the
/// main thread (GTK requirement on Linux).
pub fn apply(app: &AppHandle, display: (String, String, String, bool)) {
    let (title, tooltip, pomo_label, task_running) = display;
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.status.set_text(&tooltip);
        let _ = menu.pomodoro.set_text(&pomo_label);
        let _ = menu.stop_task.set_enabled(task_running);
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(&tooltip));
        // Shown next to the icon on macOS and appindicator-based Linux DEs.
        let _ = tray.set_title(Some(&title));
    }
}

/// Recompute and apply the tray state now (used right after a menu action).
pub fn refresh(app: &AppHandle) {
    apply(app, timer::tray_display(app));
}

/// Background thread that keeps the tray clock ticking every second while a
/// timer runs, and clears it once on the transition to idle. Computing the
/// strings off-thread keeps the main-thread hop to just the GTK calls.
pub fn spawn_updater(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_running = false;
        loop {
            let running = timer::any_running(&app);
            if running || was_running {
                let display = timer::tray_display(&app);
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || apply(&handle, display));
            }
            was_running = running;
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    });
}
