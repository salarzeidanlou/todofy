//! Two independent focus timers, both backed by SQLite so they keep counting
//! while the window is hidden in the tray and survive a restart.
//!
//! * Per-task stopwatch — `time_sessions` rows; the one with a NULL `end_at`
//!   is running. Neither timer auto-stops: `poll` only fires reminder
//!   notifications and lets them keep running.
//! * Standalone Pomodoro — the single `pomodoro` row; elapsed time in the
//!   current phase is `accumulated + (now - start_at)` while running.

use crate::db::Db;
use crate::models::{ActiveTimer, Pomodoro, SessionLog};
use chrono::{DateTime, Local};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

/// Whole seconds elapsed since an RFC3339 instant (never negative).
fn secs_since(iso: &str) -> i64 {
    DateTime::parse_from_rfc3339(iso)
        .map(|dt| (Local::now().timestamp() - dt.timestamp()).max(0))
        .unwrap_or(0)
}

// ---------------------------------------------------------------- stopwatch

fn read_active(conn: &Connection) -> rusqlite::Result<Option<ActiveTimer>> {
    conn.query_row(
        "SELECT s.task_id, t.title, s.start_at
         FROM time_sessions s JOIN tasks t ON t.id = s.task_id
         WHERE s.end_at IS NULL
         ORDER BY s.id DESC LIMIT 1",
        [],
        |r| {
            Ok(ActiveTimer {
                task_id: r.get(0)?,
                title: r.get(1)?,
                start_at: r.get(2)?,
            })
        },
    )
    .optional()
}

/// Stop every running session, recording each one's duration.
fn close_open_sessions(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_iso();
    let mut stmt = conn.prepare("SELECT id, start_at FROM time_sessions WHERE end_at IS NULL")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (id, start) in rows {
        conn.execute(
            "UPDATE time_sessions SET end_at = ?1, seconds = ?2 WHERE id = ?3",
            params![now, secs_since(&start), id],
        )?;
    }
    Ok(())
}

/// Start tracking a task. Any other running session is stopped first, so at
/// most one stopwatch runs at a time.
#[tauri::command]
pub fn start_timer(db: State<Db>, id: i64) -> Result<Option<ActiveTimer>, String> {
    let conn = db.conn();
    close_open_sessions(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO time_sessions (task_id, start_at) VALUES (?1, ?2)",
        params![id, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    read_active(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_timer(db: State<Db>) -> Result<(), String> {
    close_open_sessions(&db.conn()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn active_timer(db: State<Db>) -> Result<Option<ActiveTimer>, String> {
    read_active(&db.conn()).map_err(|e| e.to_string())
}

/// Recent completed focus sessions, newest first, for the history view.
#[tauri::command]
pub fn focus_history(db: State<Db>, limit: i64) -> Result<Vec<SessionLog>, String> {
    let conn = db.conn();
    let lim = if limit <= 0 { 200 } else { limit };
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.task_id, t.title, s.start_at, s.end_at, s.seconds
             FROM time_sessions s JOIN tasks t ON t.id = s.task_id
             WHERE s.end_at IS NOT NULL
             ORDER BY s.start_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([lim], |r| {
            Ok(SessionLog {
                id: r.get(0)?,
                task_id: r.get(1)?,
                title: r.get(2)?,
                start_at: r.get(3)?,
                end_at: r.get(4)?,
                seconds: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ---------------------------------------------------------------- pomodoro

fn phase_target(phase: &str, focus: i64, short: i64, long: i64) -> i64 {
    let minutes = match phase {
        "short" => short,
        "long" => long,
        _ => focus,
    };
    minutes * 60
}

fn read_pomodoro(conn: &Connection) -> rusqlite::Result<Pomodoro> {
    conn.query_row(
        "SELECT phase, running, start_at, accumulated, completed_focus,
                focus_min, short_min, long_min, long_every
         FROM pomodoro WHERE id = 1",
        [],
        |r| {
            let phase: String = r.get(0)?;
            let focus: i64 = r.get(5)?;
            let short: i64 = r.get(6)?;
            let long: i64 = r.get(7)?;
            Ok(Pomodoro {
                target: phase_target(&phase, focus, short, long),
                phase,
                running: r.get::<_, i64>(1)? != 0,
                start_at: r.get(2)?,
                accumulated: r.get(3)?,
                completed_focus: r.get(4)?,
                focus_min: focus,
                short_min: short,
                long_min: long,
                long_every: r.get(8)?,
            })
        },
    )
}

#[tauri::command]
pub fn get_pomodoro(db: State<Db>) -> Result<Pomodoro, String> {
    read_pomodoro(&db.conn()).map_err(|e| e.to_string())
}

/// Start or resume the current phase.
#[tauri::command]
pub fn pomodoro_start(db: State<Db>) -> Result<Pomodoro, String> {
    let conn = db.conn();
    conn.execute(
        "UPDATE pomodoro SET running = 1, start_at = ?1 WHERE id = 1 AND running = 0",
        params![now_iso()],
    )
    .map_err(|e| e.to_string())?;
    read_pomodoro(&conn).map_err(|e| e.to_string())
}

/// Pause, folding the running segment into `accumulated`.
#[tauri::command]
pub fn pomodoro_pause(db: State<Db>) -> Result<Pomodoro, String> {
    let conn = db.conn();
    let p = read_pomodoro(&conn).map_err(|e| e.to_string())?;
    if p.running {
        let add = p.start_at.as_deref().map(secs_since).unwrap_or(0);
        conn.execute(
            "UPDATE pomodoro SET running = 0, start_at = NULL, accumulated = accumulated + ?1 WHERE id = 1",
            params![add],
        )
        .map_err(|e| e.to_string())?;
    }
    read_pomodoro(&conn).map_err(|e| e.to_string())
}

/// Reset the current phase's clock (keeps the phase and set progress).
#[tauri::command]
pub fn pomodoro_reset(db: State<Db>) -> Result<Pomodoro, String> {
    let conn = db.conn();
    conn.execute(
        "UPDATE pomodoro SET running = 0, start_at = NULL, accumulated = 0, notified = 0 WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    read_pomodoro(&conn).map_err(|e| e.to_string())
}

/// Advance to the next phase (focus -> short/long break -> focus) and start it.
#[tauri::command]
pub fn pomodoro_next(db: State<Db>) -> Result<Pomodoro, String> {
    let conn = db.conn();
    let p = read_pomodoro(&conn).map_err(|e| e.to_string())?;
    let (next_phase, completed) = if p.phase == "focus" {
        let c = p.completed_focus + 1;
        let long_every = p.long_every.max(1);
        (if c % long_every == 0 { "long" } else { "short" }, c)
    } else {
        ("focus", p.completed_focus)
    };
    conn.execute(
        "UPDATE pomodoro SET phase = ?1, completed_focus = ?2, accumulated = 0,
                notified = 0, running = 1, start_at = ?3 WHERE id = 1",
        params![next_phase, completed, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    read_pomodoro(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_pomodoro_config(
    db: State<Db>,
    focus_min: i64,
    short_min: i64,
    long_min: i64,
    long_every: i64,
) -> Result<Pomodoro, String> {
    let conn = db.conn();
    conn.execute(
        "UPDATE pomodoro SET focus_min = ?1, short_min = ?2, long_min = ?3, long_every = ?4 WHERE id = 1",
        params![
            focus_min.max(1),
            short_min.max(1),
            long_min.max(1),
            long_every.max(1)
        ],
    )
    .map_err(|e| e.to_string())?;
    read_pomodoro(&conn).map_err(|e| e.to_string())
}

// ----------------------------------------------------------------- polling

/// Called from the scheduler thread. Fires reminder notifications for a
/// finished Pomodoro phase and for long-running stopwatch sessions, without
/// stopping either timer.
pub fn poll(app: &AppHandle) {
    let db = app.state::<Db>();
    let conn = db.conn();
    let mut pomodoro_changed = false;

    // Pomodoro phase reached its target — nudge once, keep running (overtime).
    if let Ok(p) = read_pomodoro(&conn) {
        if p.running {
            let elapsed = p.accumulated + p.start_at.as_deref().map(secs_since).unwrap_or(0);
            let notified: i64 = conn
                .query_row("SELECT notified FROM pomodoro WHERE id = 1", [], |r| r.get(0))
                .unwrap_or(0);
            if elapsed >= p.target && notified == 0 {
                let (title, body) = if p.phase == "focus" {
                    ("Focus session done", "Time for a break · todofy")
                } else {
                    ("Break's over", "Back to focus · todofy")
                };
                let _ = app.notification().builder().title(title).body(body).show();
                let _ = conn.execute("UPDATE pomodoro SET notified = 1 WHERE id = 1", []);
                pomodoro_changed = true;
            }
        }
    }

    // Long-running stopwatch: nudge once per elapsed hour, keep it running.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT s.id, t.title, s.start_at, s.notified
         FROM time_sessions s JOIN tasks t ON t.id = s.task_id
         WHERE s.end_at IS NULL",
    ) {
        let rows: Vec<(i64, String, String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .and_then(|it| it.collect())
            .unwrap_or_default();
        for (id, title, start, notified) in rows {
            let hours = secs_since(&start) / 3600;
            if hours > notified {
                let _ = app
                    .notification()
                    .builder()
                    .title("Still tracking time")
                    .body(format!("“{title}” — {hours}h and counting · todofy"))
                    .show();
                let _ = conn.execute(
                    "UPDATE time_sessions SET notified = ?1 WHERE id = ?2",
                    params![hours, id],
                );
            }
        }
    }

    drop(conn);
    if pomodoro_changed {
        let _ = app.emit("pomodoro-updated", ());
    }
}

// ------------------------------------------------------------- tray controls

fn clock_mmss(secs: i64) -> String {
    let s = secs.max(0);
    format!("{}:{:02}", s / 60, s % 60)
}

/// Signed clock: overtime renders as "+m:ss".
fn clock_signed(secs: i64) -> String {
    if secs < 0 {
        format!("+{}", clock_mmss(-secs))
    } else {
        clock_mmss(secs)
    }
}

/// Is either timer currently running? (cheap, safe to call off the main thread)
pub fn any_running(app: &AppHandle) -> bool {
    let db = app.state::<Db>();
    let conn = db.conn();
    let task = read_active(&conn).ok().flatten().is_some();
    let pomo = read_pomodoro(&conn).map(|p| p.running).unwrap_or(false);
    task || pomo
}

/// What the tray should show right now: `(title, tooltip, pomodoro toggle
/// label, is a task timer running)`. Title is the compact clock shown next to
/// the icon; tooltip/status is the descriptive line.
pub fn tray_display(app: &AppHandle) -> (String, String, String, bool) {
    let db = app.state::<Db>();
    let conn = db.conn();
    let active = read_active(&conn).ok().flatten();
    let pomo = read_pomodoro(&conn).ok();

    let task_running = active.is_some();
    let pomo_running = pomo.as_ref().map(|p| p.running).unwrap_or(false);
    let pomo_label = if pomo_running { "Pause focus" } else { "Start focus" }.to_string();

    let mut title = String::new();
    let mut parts: Vec<String> = Vec::new();

    if let Some(a) = &active {
        let e = secs_since(&a.start_at);
        title = clock_mmss(e);
        parts.push(format!("Tracking: {} ({})", a.title, clock_mmss(e)));
    }
    if let Some(p) = &pomo {
        if p.running {
            let elapsed = p.accumulated + p.start_at.as_deref().map(secs_since).unwrap_or(0);
            let remaining = p.target - elapsed;
            if title.is_empty() {
                title = clock_signed(remaining);
            }
            let phase = match p.phase.as_str() {
                "short" => "Short break",
                "long" => "Long break",
                _ => "Focus",
            };
            parts.push(format!("{} {}", phase, clock_signed(remaining)));
        }
    }

    let tip = if parts.is_empty() {
        "todofy — no timer running".to_string()
    } else {
        parts.join(" · ")
    };
    (title, tip, pomo_label, task_running)
}

/// Toggle the Pomodoro from the tray (start/resume if paused, else pause).
pub fn tray_toggle_pomodoro(app: &AppHandle) {
    {
        let db = app.state::<Db>();
        let conn = db.conn();
        if let Ok(p) = read_pomodoro(&conn) {
            let _ = if p.running {
                let add = p.start_at.as_deref().map(secs_since).unwrap_or(0);
                conn.execute(
                    "UPDATE pomodoro SET running = 0, start_at = NULL, accumulated = accumulated + ?1 WHERE id = 1",
                    params![add],
                )
            } else {
                conn.execute(
                    "UPDATE pomodoro SET running = 1, start_at = ?1 WHERE id = 1",
                    params![now_iso()],
                )
            };
        }
    }
    let _ = app.emit("timers-changed", ());
    crate::tray::refresh(app);
}

/// Stop the running per-task stopwatch from the tray.
pub fn tray_stop_task(app: &AppHandle) {
    {
        let db = app.state::<Db>();
        let conn = db.conn();
        let _ = close_open_sessions(&conn);
    }
    let _ = app.emit("timers-changed", ());
    crate::tray::refresh(app);
}
