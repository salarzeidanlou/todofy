use rusqlite::{params, Connection};
use std::sync::{Mutex, MutexGuard};

/// Managed Tauri state: a single SQLite connection behind a mutex.
/// The notification scheduler and the command handlers share this.
pub struct Db(pub Mutex<Connection>);

impl Db {
    /// Borrow the connection. If a previous holder panicked while holding the
    /// lock the mutex is poisoned; we recover the guard anyway rather than
    /// cascading the panic to every later database call. Each command touches
    /// the connection only briefly and leaves it in a consistent state, so the
    /// data is safe to keep using.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Create the schema if it does not yet exist, then bring older
/// databases up to date via `migrate`.
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS labels (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6c7cff'
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            notes        TEXT,
            due_date     TEXT,               -- ISO date  (YYYY-MM-DD)
            remind_at    TEXT,               -- ISO datetime (local)
            status       TEXT NOT NULL DEFAULT 'active',  -- active | done
            priority     INTEGER NOT NULL DEFAULT 4,      -- 1 (high) .. 4 (none)
            created_at   TEXT NOT NULL,
            completed_at TEXT,
            order_index  REAL NOT NULL DEFAULT 0,
            notified     INTEGER NOT NULL DEFAULT 0,
            pinned       INTEGER NOT NULL DEFAULT 0,
            repeat       TEXT                -- daily|weekdays|weekly|monthly|yearly
        );

        CREATE TABLE IF NOT EXISTS task_labels (
            task_id  INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
            label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, label_id)
        );

        -- Simple key/value app settings (e.g. startup_mode). Read by the
        -- backend at launch and by the Settings screen at runtime.
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Per-task focus stopwatch sessions. A row with a NULL end_at is the
        -- one currently running (at most one at a time). `seconds` is filled in
        -- on stop; `notified` counts the 'still tracking' nudges already sent.
        CREATE TABLE IF NOT EXISTS time_sessions (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            start_at TEXT NOT NULL,   -- RFC3339
            end_at   TEXT,            -- NULL while running
            seconds  INTEGER,         -- duration, set on stop
            notified INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_task ON time_sessions(task_id);

        -- Standalone Pomodoro timer state (single row, id = 1). Persisted so
        -- the timer survives restarts and keeps ticking while in the tray.
        CREATE TABLE IF NOT EXISTS pomodoro (
            id             INTEGER PRIMARY KEY CHECK (id = 1),
            phase          TEXT NOT NULL DEFAULT 'focus',  -- focus|short|long
            running        INTEGER NOT NULL DEFAULT 0,
            start_at       TEXT,                            -- when the running segment began
            accumulated    INTEGER NOT NULL DEFAULT 0,      -- secs elapsed before this segment
            completed_focus INTEGER NOT NULL DEFAULT 0,     -- focus phases done in the set
            notified       INTEGER NOT NULL DEFAULT 0,      -- phase-complete nudge sent?
            focus_min      INTEGER NOT NULL DEFAULT 25,
            short_min      INTEGER NOT NULL DEFAULT 5,
            long_min       INTEGER NOT NULL DEFAULT 15,
            long_every     INTEGER NOT NULL DEFAULT 4
        );
        INSERT OR IGNORE INTO pomodoro (id) VALUES (1);

        CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_remind   ON tasks(remind_at);
        ",
    )?;
    migrate(conn)?;
    Ok(())
}

/// True if `table` already has a column named `column`.
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |_| Ok(()),
    )
    .is_ok()
}

/// Additive schema changes for databases created before a given feature
/// shipped. `CREATE TABLE IF NOT EXISTS` above only covers fresh installs;
/// each block here brings an existing database up to date. Keep every
/// block idempotent (guarded by a column/index check) and append new
/// ones at the bottom as the schema grows — never edit an old block.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    // Task pinning (Pinboard view). Column may already exist on a fresh
    // install (it's in the CREATE TABLE above), so it's guarded on its
    // own; the index is unconditional since it's needed either way.
    if !column_exists(conn, "tasks", "pinned") {
        conn.execute("ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", [])?;
    }
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(pinned)", [])?;

    // Recurring tasks: completing one rolls its due date / reminder forward to
    // the next occurrence instead of marking it done (see `recur.rs`).
    if !column_exists(conn, "tasks", "repeat") {
        conn.execute("ALTER TABLE tasks ADD COLUMN repeat TEXT", [])?;
    }

    Ok(())
}
