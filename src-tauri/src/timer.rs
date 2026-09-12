//! Two independent focus timers, both backed by SQLite so they keep counting
//! while the window is hidden in the tray and survive a restart.
//!
//! * Per-task stopwatch — `time_sessions` rows; the one with a NULL `end_at`
//!   is open, and runs while `resumed_at` is set. Elapsed time is
//!   `accumulated + (now - resumed_at)`, the same shape as the Pomodoro below.
//!   A session left running past `MAX_SESSION_SECS` (e.g. forgotten overnight)
//!   is auto-stopped and capped rather than left to grow forever.
//! * Standalone Pomodoro — the single `pomodoro` row; elapsed time in the
//!   current phase is `accumulated + (now - start_at)` while running, capped
//!   the same way if left running past `MAX_SESSION_SECS`.

use crate::db::{new_uuid, Db};
use crate::models::{ActiveTimer, Pomodoro, SessionLog};
use chrono::{DateTime, Local};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Emitter, Manager, State};

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

/// Whole seconds elapsed since an RFC3339 instant (never negative).
fn secs_since(iso: &str) -> i64 {
    DateTime::parse_from_rfc3339(iso)
        .map(|dt| (Local::now().timestamp() - dt.timestamp()).max(0))
        .unwrap_or(0)
}

/// Safety cap: nothing tracks (or counts overtime) longer than this without
/// user interaction. Guards against a forgotten timer running for days after
/// the app was closed and reopened — that stale `start_at` is read straight
/// from SQLite, so a bare restart never clears it on its own.
const MAX_SESSION_SECS: i64 = 12 * 3600;

// ---------------------------------------------------------------- stopwatch

/// Banked total plus the segment running since `resumed_at`, if any.
fn session_elapsed(accumulated: i64, resumed_at: Option<&str>) -> i64 {
    accumulated + resumed_at.map(secs_since).unwrap_or(0)
}

fn open_sessions(conn: &Connection) -> rusqlite::Result<Vec<(String, i64, Option<String>)>> {
    let mut stmt =
        conn.prepare("SELECT id, accumulated, resumed_at FROM time_sessions WHERE end_at IS NULL")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect();
    rows
}

/// Auto-stop any session that has tracked longer than `MAX_SESSION_SECS`,
/// capping its duration there. Measured in tracked time, not wall clock, so
/// time spent paused doesn't count against the cap.
fn close_stale_sessions(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_iso();
    for (id, accumulated, resumed_at) in open_sessions(conn)? {
        if session_elapsed(accumulated, resumed_at.as_deref()) > MAX_SESSION_SECS {
            conn.execute(
                "UPDATE time_sessions SET end_at = ?1, seconds = ?2, resumed_at = NULL,
                        accumulated = ?2, updated_at = ?1 WHERE id = ?3",
                params![now, MAX_SESSION_SECS, id],
            )?;
        }
    }
    Ok(())
}

fn read_active(conn: &Connection) -> rusqlite::Result<Option<ActiveTimer>> {
    close_stale_sessions(conn)?;
    conn.query_row(
        "SELECT s.task_id, t.title, s.start_at, s.resumed_at, s.accumulated,
                t.estimate_minutes
         FROM time_sessions s JOIN tasks t ON t.id = s.task_id
         WHERE s.end_at IS NULL AND s.deleted_at IS NULL AND t.deleted_at IS NULL
         ORDER BY s.start_at DESC LIMIT 1",
        [],
        |r| {
            Ok(ActiveTimer {
                task_id: r.get(0)?,
                title: r.get(1)?,
                start_at: r.get(2)?,
                resumed_at: r.get(3)?,
                accumulated: r.get(4)?,
                estimate_minutes: r.get(5)?,
            })
        },
    )
    .optional()
}

/// Stop every open session, recording each one's duration. Paused sessions
/// close too, keeping the time they had banked.
fn close_open_sessions(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_iso();
    for (id, accumulated, resumed_at) in open_sessions(conn)? {
        let secs = session_elapsed(accumulated, resumed_at.as_deref());
        conn.execute(
            "UPDATE time_sessions SET end_at = ?1, seconds = ?2, resumed_at = NULL,
                    accumulated = ?2, updated_at = ?1 WHERE id = ?3",
            params![now, secs, id],
        )?;
    }
    Ok(())
}

/// Bank the running segment. A no-op when already paused, so pausing twice
/// can't count the same seconds twice.
fn pause_open_session(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_iso();
    for (id, accumulated, resumed_at) in open_sessions(conn)? {
        let Some(resumed) = resumed_at else { continue };
        conn.execute(
            "UPDATE time_sessions SET accumulated = ?1, resumed_at = NULL, updated_at = ?2
             WHERE id = ?3",
            params![accumulated + secs_since(&resumed), now, id],
        )?;
    }
    Ok(())
}

/// In Pomodoro mode the two timers start, pause, resume and stop together so
/// they can't drift apart.
fn pomodoro_is_bound(conn: &Connection) -> bool {
    crate::settings::task_timer_mode(conn) == "pomodoro"
}

fn start_tracking(conn: &Connection, task_id: &str) -> rusqlite::Result<()> {
    close_open_sessions(conn)?;
    // Starting the work answers its reminder (see `acknowledge_reminder_inner`).
    crate::commands::acknowledge_reminder_inner(conn, task_id)?;
    conn.execute(
        "INSERT INTO time_sessions (id, task_id, start_at, resumed_at, updated_at)
         VALUES (?1, ?2, ?3, ?3, ?3)",
        params![new_uuid(), task_id, now_iso()],
    )?;
    if pomodoro_is_bound(conn) {
        // Restart the phase, keeping the set's progress.
        conn.execute(
            "UPDATE pomodoro SET phase = 'focus', accumulated = 0, notified = 0,
                    running = 1, start_at = ?1 WHERE id = 1",
            params![now_iso()],
        )?;
    }
    Ok(())
}

fn pause_tracking(conn: &Connection) -> rusqlite::Result<()> {
    pause_open_session(conn)?;
    if pomodoro_is_bound(conn) {
        pause_pomodoro_segment(conn)?;
    }
    Ok(())
}

fn resume_tracking(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE time_sessions SET resumed_at = ?1, updated_at = ?1
         WHERE end_at IS NULL AND resumed_at IS NULL",
        params![now_iso()],
    )?;
    if pomodoro_is_bound(conn) {
        resume_pomodoro_segment(conn)?;
    }
    Ok(())
}

/// A bound Pomodoro is paused rather than reset, so a part-finished phase
/// survives stopping the task.
fn stop_tracking(conn: &Connection) -> rusqlite::Result<()> {
    close_open_sessions(conn)?;
    if pomodoro_is_bound(conn) {
        pause_pomodoro_segment(conn)?;
    }
    Ok(())
}

/// Start tracking a task. Any other open session is stopped first, so at most
/// one stopwatch exists at a time.
///
/// Below, the DB connection is always dropped (block-scoped) before
/// `tray::refresh`, which locks it again — held across that call, it deadlocks.
#[tauri::command]
pub fn start_timer(app: AppHandle, db: State<Db>, id: String) -> Result<Option<ActiveTimer>, String> {
    let active = {
        let conn = db.conn();
        start_tracking(&conn, &id).map_err(|e| e.to_string())?;
        read_active(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(active)
}

#[tauri::command]
pub fn pause_timer(app: AppHandle, db: State<Db>) -> Result<Option<ActiveTimer>, String> {
    let active = {
        let conn = db.conn();
        pause_tracking(&conn).map_err(|e| e.to_string())?;
        read_active(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(active)
}

#[tauri::command]
pub fn resume_timer(app: AppHandle, db: State<Db>) -> Result<Option<ActiveTimer>, String> {
    let active = {
        let conn = db.conn();
        resume_tracking(&conn).map_err(|e| e.to_string())?;
        read_active(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(active)
}

#[tauri::command]
pub fn stop_timer(app: AppHandle, db: State<Db>) -> Result<(), String> {
    {
        let conn = db.conn();
        stop_tracking(&conn).map_err(|e| e.to_string())?;
    }
    crate::tray::refresh(&app);
    Ok(())
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
             WHERE s.end_at IS NOT NULL AND s.deleted_at IS NULL AND t.deleted_at IS NULL
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

/// Auto-pause a Pomodoro segment that's been running (including overtime)
/// longer than `MAX_SESSION_SECS`, folding the capped duration into
/// `accumulated` just like a normal pause.
fn close_stale_pomodoro(conn: &Connection) -> rusqlite::Result<()> {
    let row: Option<(i64, String)> = conn
        .query_row(
            "SELECT accumulated, start_at FROM pomodoro WHERE id = 1 AND running = 1 AND start_at IS NOT NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((accumulated, start_at)) = row {
        let elapsed = accumulated + secs_since(&start_at);
        if elapsed > MAX_SESSION_SECS {
            conn.execute(
                "UPDATE pomodoro SET running = 0, start_at = NULL, accumulated = ?1 WHERE id = 1",
                params![MAX_SESSION_SECS],
            )?;
        }
    }
    Ok(())
}

fn read_pomodoro(conn: &Connection) -> rusqlite::Result<Pomodoro> {
    close_stale_pomodoro(conn)?;
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
fn resume_pomodoro_segment(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pomodoro SET running = 1, start_at = ?1 WHERE id = 1 AND running = 0",
        params![now_iso()],
    )?;
    Ok(())
}

/// Pause, folding the running segment into `accumulated`.
fn pause_pomodoro_segment(conn: &Connection) -> rusqlite::Result<()> {
    let p = read_pomodoro(conn)?;
    if p.running {
        let add = p.start_at.as_deref().map(secs_since).unwrap_or(0);
        conn.execute(
            "UPDATE pomodoro SET running = 0, start_at = NULL, accumulated = accumulated + ?1 WHERE id = 1",
            params![add],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn pomodoro_start(app: AppHandle, db: State<Db>) -> Result<Pomodoro, String> {
    let p = {
        let conn = db.conn();
        resume_pomodoro_segment(&conn).map_err(|e| e.to_string())?;
        read_pomodoro(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(p)
}

#[tauri::command]
pub fn pomodoro_pause(app: AppHandle, db: State<Db>) -> Result<Pomodoro, String> {
    let p = {
        let conn = db.conn();
        pause_pomodoro_segment(&conn).map_err(|e| e.to_string())?;
        read_pomodoro(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(p)
}

/// Reset the current phase's clock (keeps the phase and set progress).
#[tauri::command]
pub fn pomodoro_reset(app: AppHandle, db: State<Db>) -> Result<Pomodoro, String> {
    let p = {
        let conn = db.conn();
        conn.execute(
            "UPDATE pomodoro SET running = 0, start_at = NULL, accumulated = 0, notified = 0 WHERE id = 1",
            [],
        )
        .map_err(|e| e.to_string())?;
        read_pomodoro(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(p)
}

/// Advance to the next phase (focus -> short/long break -> focus) and start it.
#[tauri::command]
pub fn pomodoro_next(app: AppHandle, db: State<Db>) -> Result<Pomodoro, String> {
    let next = {
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
        read_pomodoro(&conn).map_err(|e| e.to_string())?
    };
    crate::tray::refresh(&app);
    Ok(next)
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
pub fn poll(app: &AppHandle, notifications_enabled: bool) {
    let db = app.state::<Db>();
    let mut pomodoro_changed = false;

    // Pending reminders, gathered while the DB lock is held and delivered
    // only after it's released — `notify::send` can make a blocking D-Bus
    // call, and holding the mutex across that would freeze every other
    // command (they all need `db.conn()`) if the portal is slow to reply.
    let mut pomodoro_notice: Option<(&'static str, &'static str)> = None;
    let mut stopwatch_notices: Vec<(i64, String, String)> = Vec::new();

    {
        let conn = db.conn();

        // Enforce the runaway-timer safety cap even if nobody's looking at the UI.
        let _ = close_stale_sessions(&conn);
        let _ = close_stale_pomodoro(&conn);

        // Pomodoro phase reached its target — nudge once, keep running (overtime).
        if let Ok(p) = read_pomodoro(&conn) {
            if p.running {
                let elapsed = p.accumulated + p.start_at.as_deref().map(secs_since).unwrap_or(0);
                let notified: i64 = conn
                    .query_row("SELECT notified FROM pomodoro WHERE id = 1", [], |r| {
                        r.get(0)
                    })
                    .unwrap_or(0);
                if elapsed >= p.target && notified == 0 {
                    pomodoro_notice = Some(if p.phase == "focus" {
                        ("Focus session done", "Time for a break · todofy")
                    } else {
                        ("Break's over", "Back to focus · todofy")
                    });
                    let _ = conn.execute("UPDATE pomodoro SET notified = 1 WHERE id = 1", []);
                    pomodoro_changed = true;
                }
            }
        }

        // Long-running stopwatch: nudge once per elapsed hour, keep it running.
        // Paused sessions are excluded: their clock isn't moving.
        if let Ok(mut stmt) = conn.prepare(
            "SELECT s.id, t.title, s.accumulated, s.resumed_at, s.notified
             FROM time_sessions s JOIN tasks t ON t.id = s.task_id
             WHERE s.end_at IS NULL AND s.resumed_at IS NOT NULL
               AND s.deleted_at IS NULL AND t.deleted_at IS NULL",
        ) {
            let rows: Vec<(String, String, i64, Option<String>, i64)> = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .and_then(|it| it.collect())
                .unwrap_or_default();
            for (id, title, accumulated, resumed_at, notified) in rows {
                let hours = session_elapsed(accumulated, resumed_at.as_deref()) / 3600;
                if hours > notified {
                    let _ = conn.execute(
                        "UPDATE time_sessions SET notified = ?1 WHERE id = ?2",
                        params![hours, id],
                    );
                    stopwatch_notices.push((hours, title, id));
                }
            }
        };
    } // conn dropped here — lock released before any notification is sent

    if notifications_enabled {
        if let Some((title, body)) = pomodoro_notice {
            crate::notify::send(app, title, body, None);
        }
        for (hours, title, _id) in &stopwatch_notices {
            crate::notify::send(
                app,
                "Still tracking time",
                &format!("“{title}” — {hours}h and counting · todofy"),
                None,
            );
        }
    }

    if pomodoro_changed {
        let _ = app.emit("pomodoro-updated", ());
    }
}

// ------------------------------------------------------------- tray controls

fn clock_mmss(secs: i64) -> String {
    let s = secs.max(0);
    format!("{}:{:02}", s / 60, s % 60)
}

/// Seconds run past the task's estimate, or None while still inside it.
fn over_estimate(elapsed: i64, estimate_minutes: Option<i64>) -> Option<i64> {
    estimate_minutes
        .filter(|m| *m > 0)
        .map(|m| elapsed - m * 60)
        .filter(|excess| *excess > 0)
}

/// Signed clock: overtime renders as "+m:ss".
fn clock_signed(secs: i64) -> String {
    if secs < 0 {
        format!("+{}", clock_mmss(-secs))
    } else {
        clock_mmss(secs)
    }
}

/// Is either timer counting? Cheap, and safe off the main thread. A paused
/// stopwatch says no: there is nothing for the tray to redraw.
pub fn any_running(app: &AppHandle) -> bool {
    let db = app.state::<Db>();
    let conn = db.conn();
    let task = read_active(&conn)
        .ok()
        .flatten()
        .map(|a| a.resumed_at.is_some())
        .unwrap_or(false);
    let pomo = read_pomodoro(&conn).map(|p| p.running).unwrap_or(false);
    task || pomo
}

/// `title` is the compact clock beside the icon, `tooltip` the status line.
/// A `task_label` of None means no open session, which greys out the controls.
pub struct TrayDisplay {
    pub title: String,
    pub tooltip: String,
    pub pomodoro_label: String,
    pub task_label: Option<String>,
}

pub fn tray_display(app: &AppHandle) -> TrayDisplay {
    let db = app.state::<Db>();
    let conn = db.conn();
    let active = read_active(&conn).ok().flatten();
    let pomo = read_pomodoro(&conn).ok();

    let pomo_running = pomo.as_ref().map(|p| p.running).unwrap_or(false);
    let pomo_label = if pomo_running {
        "Pause focus"
    } else {
        "Start focus"
    }
    .to_string();
    let task_label = active.as_ref().map(|a| {
        if a.resumed_at.is_some() {
            "Pause task timer".to_string()
        } else {
            "Resume task timer".to_string()
        }
    });

    let mut title = String::new();
    let mut parts: Vec<String> = Vec::new();

    if let Some(a) = &active {
        let e = session_elapsed(a.accumulated, a.resumed_at.as_deref());
        // The tray has no colour to turn red with, so an overrun is shown
        // in the numbers instead.
        let over = over_estimate(e, a.estimate_minutes);
        title = match over {
            Some(excess) => format!("{} +{}", clock_mmss(e), clock_mmss(excess)),
            None => clock_mmss(e),
        };
        let state = if a.resumed_at.is_some() {
            "Tracking"
        } else {
            "Paused"
        };
        parts.push(format!("{}: {} ({})", state, a.title, clock_mmss(e)));
        if let Some(excess) = over {
            parts.push(format!("{} over estimate", clock_mmss(excess)));
        }
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

    let tooltip = if parts.is_empty() {
        "todofy — no timer running".to_string()
    } else {
        parts.join(" · ")
    };
    TrayDisplay {
        title,
        tooltip,
        pomodoro_label: pomo_label,
        task_label,
    }
}

/// Toggle the Pomodoro from the tray (start/resume if paused, else pause).
pub fn tray_toggle_pomodoro(app: &AppHandle) {
    {
        let db = app.state::<Db>();
        let conn = db.conn();
        if let Ok(p) = read_pomodoro(&conn) {
            let _ = if p.running {
                pause_pomodoro_segment(&conn)
            } else {
                resume_pomodoro_segment(&conn)
            };
        }
    }
    let _ = app.emit("timers-changed", ());
    crate::tray::refresh(app);
}

pub fn tray_toggle_task(app: &AppHandle) {
    {
        let db = app.state::<Db>();
        let conn = db.conn();
        let paused = read_active(&conn)
            .ok()
            .flatten()
            .map(|a| a.resumed_at.is_none())
            .unwrap_or(false);
        let _ = if paused {
            resume_tracking(&conn)
        } else {
            pause_tracking(&conn)
        };
    }
    let _ = app.emit("timers-changed", ());
    crate::tray::refresh(app);
}

pub fn tray_stop_task(app: &AppHandle) {
    {
        let db = app.state::<Db>();
        let conn = db.conn();
        let _ = stop_tracking(&conn);
    }
    let _ = app.emit("timers-changed", ());
    crate::tray::refresh(app);
}

#[cfg(test)]
mod stopwatch_tests {
    use super::*;
    use crate::db;
    use chrono::Duration;

    /// One task with a session running since `mins_ago` minutes ago.
    fn seed(mins_ago: i64) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let started = (Local::now() - Duration::minutes(mins_ago)).to_rfc3339();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at)
             VALUES ('t1', 'write it up', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO time_sessions (id, task_id, start_at, resumed_at, updated_at)
             VALUES ('s1', 't1', ?1, ?1, ?1)",
            params![started],
        )
        .unwrap();
        conn
    }

    fn session(conn: &Connection) -> (Option<String>, i64, Option<i64>, Option<String>) {
        conn.query_row(
            "SELECT resumed_at, accumulated, seconds, end_at FROM time_sessions WHERE id = 's1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap()
    }

    #[test]
    fn pausing_banks_the_running_segment_and_stops_the_clock() {
        let conn = seed(10);
        pause_open_session(&conn).unwrap();

        let (resumed_at, accumulated, seconds, end_at) = session(&conn);
        assert!(resumed_at.is_none(), "a paused session has no live segment");
        assert_eq!(accumulated, 600);
        assert_eq!(seconds, None, "pausing must not close the session");
        assert_eq!(end_at, None);

        // The readout must be frozen too, not just the stored total.
        let timer = read_active(&conn).unwrap().unwrap();
        assert_eq!(
            session_elapsed(timer.accumulated, timer.resumed_at.as_deref()),
            600
        );
    }

    /// A double click, or the tray and window both firing.
    #[test]
    fn pausing_twice_does_not_double_count() {
        let conn = seed(10);
        pause_open_session(&conn).unwrap();
        pause_open_session(&conn).unwrap();
        assert_eq!(session(&conn).1, 600);
    }

    #[test]
    fn stopping_a_paused_session_keeps_its_banked_time() {
        let conn = seed(10);
        pause_open_session(&conn).unwrap();
        close_open_sessions(&conn).unwrap();

        let (resumed_at, _, seconds, end_at) = session(&conn);
        assert_eq!(seconds, Some(600), "the paused total is what gets recorded");
        assert!(end_at.is_some());
        assert!(resumed_at.is_none());
    }

    /// Time spent paused is not work time.
    #[test]
    fn paused_time_is_excluded_from_the_recorded_duration() {
        let conn = seed(30);
        // 10 minutes banked, paused for the other 20.
        conn.execute(
            "UPDATE time_sessions SET accumulated = 600, resumed_at = NULL WHERE id = 's1'",
            [],
        )
        .unwrap();
        close_open_sessions(&conn).unwrap();
        assert_eq!(session(&conn).2, Some(600));
    }

    #[test]
    fn resuming_starts_a_fresh_segment_without_losing_the_bank() {
        let conn = seed(10);
        pause_open_session(&conn).unwrap();
        conn.execute(
            "UPDATE time_sessions SET resumed_at = ?1 WHERE end_at IS NULL AND resumed_at IS NULL",
            params![now_iso()],
        )
        .unwrap();

        let timer = read_active(&conn).unwrap().unwrap();
        assert_eq!(timer.accumulated, 600);
        assert!(timer.resumed_at.is_some());
        assert_eq!(
            session_elapsed(timer.accumulated, timer.resumed_at.as_deref()),
            600,
            "the new segment starts at zero"
        );
    }

    /// Otherwise a long lunch break would close a session with minutes on it.
    #[test]
    fn the_stale_guard_ignores_time_spent_paused() {
        let conn = seed(24 * 60);
        conn.execute(
            "UPDATE time_sessions SET accumulated = 300, resumed_at = NULL WHERE id = 's1'",
            [],
        )
        .unwrap();
        close_stale_sessions(&conn).unwrap();
        assert_eq!(session(&conn).3, None, "a paused session cannot run away");

        // Still capped when actually running.
        let conn = seed(24 * 60);
        close_stale_sessions(&conn).unwrap();
        assert_eq!(session(&conn).2, Some(MAX_SESSION_SECS));
    }

    #[test]
    fn overrun_is_only_reported_once_the_estimate_is_passed() {
        assert_eq!(over_estimate(1800, Some(30)), None, "exactly on estimate");
        assert_eq!(over_estimate(1799, Some(30)), None);
        assert_eq!(over_estimate(1860, Some(30)), Some(60));
        assert_eq!(over_estimate(99_999, None), None, "no estimate to pass");
        assert_eq!(over_estimate(99_999, Some(0)), None, "0 isn't an estimate");
    }

    /// Both clocks move together, or they drift apart.
    #[test]
    fn pomodoro_mode_binds_the_countdown_to_the_task() {
        let conn = seed(0);
        crate::settings::write(&conn, "task_timer_mode", "pomodoro").unwrap();

        start_tracking(&conn, "t1").unwrap();
        assert!(read_pomodoro(&conn).unwrap().running, "starts together");

        pause_tracking(&conn).unwrap();
        assert!(!read_pomodoro(&conn).unwrap().running, "pauses together");

        resume_tracking(&conn).unwrap();
        assert!(read_pomodoro(&conn).unwrap().running, "resumes together");

        stop_tracking(&conn).unwrap();
        let p = read_pomodoro(&conn).unwrap();
        assert!(!p.running, "stopping the task holds the countdown");
        assert_eq!(p.phase, "focus");
    }

    /// Tracking a task must not hijack a break already running.
    #[test]
    fn tracker_mode_never_touches_the_pomodoro() {
        let conn = seed(0);
        conn.execute(
            "UPDATE pomodoro SET phase = 'short', running = 1, start_at = ?1 WHERE id = 1",
            params![now_iso()],
        )
        .unwrap();

        start_tracking(&conn, "t1").unwrap();
        pause_tracking(&conn).unwrap();
        stop_tracking(&conn).unwrap();

        let p = read_pomodoro(&conn).unwrap();
        assert!(p.running, "the break keeps running");
        assert_eq!(p.phase, "short");
    }

    /// Upgrading mid-session must not silently stop the clock.
    #[test]
    fn migrating_an_open_session_leaves_it_running() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at)
             VALUES ('t1', 'legacy', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        // The pre-pause table shape, with a session already running.
        conn.execute_batch(
            "
            DROP TABLE time_sessions;
            CREATE TABLE time_sessions (
                id         TEXT PRIMARY KEY,
                task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                start_at   TEXT NOT NULL,
                end_at     TEXT,
                seconds    INTEGER,
                notified   INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            ",
        )
        .unwrap();
        let started = (Local::now() - Duration::minutes(10)).to_rfc3339();
        conn.execute(
            "INSERT INTO time_sessions (id, task_id, start_at, updated_at)
             VALUES ('s1', 't1', ?1, ?1)",
            params![started],
        )
        .unwrap();

        db::init(&conn).unwrap();

        let timer = read_active(&conn).unwrap().unwrap();
        assert!(timer.resumed_at.is_some(), "an open session is running");
        assert_eq!(
            session_elapsed(timer.accumulated, timer.resumed_at.as_deref()),
            600,
            "it keeps the time it had already run"
        );
    }
}
