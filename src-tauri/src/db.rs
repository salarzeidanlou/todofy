use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

/// A fresh v4 UUID as a lowercase hyphenated string — the on-device id for a
/// syncable row (task, label, focus session). Matches Postgres `uuid` text
/// form so the same value round-trips to the cloud database unchanged.
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

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
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
            id         TEXT PRIMARY KEY,   -- UUID, generated on-device
            name       TEXT NOT NULL,
            color      TEXT NOT NULL DEFAULT '#6c7cff',
            updated_at TEXT NOT NULL,      -- RFC3339, bumped on every write
            deleted_at TEXT                -- soft-delete tombstone; NULL while live
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id           TEXT PRIMARY KEY,   -- UUID, generated on-device
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
            repeat       TEXT,               -- daily|weekdays|weekly|monthly|yearly
            subtasks     TEXT,               -- JSON array of {id,text,done}
            updated_at   TEXT NOT NULL,      -- RFC3339, bumped on every write
            deleted_at   TEXT                -- soft-delete tombstone; NULL while live
        );

        CREATE TABLE IF NOT EXISTS task_labels (
            task_id    TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
            label_id   TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            updated_at TEXT NOT NULL,   -- RFC3339, bumped on every write
            deleted_at TEXT,            -- soft-delete tombstone; NULL while live
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
            id         TEXT PRIMARY KEY,   -- UUID, generated on-device
            task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            start_at   TEXT NOT NULL,   -- RFC3339
            end_at     TEXT,            -- NULL while running
            seconds    INTEGER,         -- duration, set on stop
            notified   INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,   -- RFC3339, bumped on every write
            deleted_at TEXT             -- soft-delete tombstone; NULL while live
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
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(pinned)",
        [],
    )?;

    // Recurring tasks: completing one rolls its due date / reminder forward to
    // the next occurrence instead of marking it done (see `recur.rs`).
    if !column_exists(conn, "tasks", "repeat") {
        conn.execute("ALTER TABLE tasks ADD COLUMN repeat TEXT", [])?;
    }

    // Subtasks / checklist: a JSON array of {id,text,done} on each task, for
    // breaking a task into smaller steps.
    if !column_exists(conn, "tasks", "subtasks") {
        conn.execute("ALTER TABLE tasks ADD COLUMN subtasks TEXT", [])?;
    }

    // Integer -> UUID primary keys, so records created offline on separate
    // devices merge into a shared cloud database without id collisions. Runs
    // once on databases still using the old AUTOINCREMENT integer ids; a no-op
    // afterwards and on fresh installs (which are created with TEXT ids above).
    // Must come after the column-adding blocks so it can carry every column.
    migrate_ids_to_uuid(conn)?;

    // Sync bookkeeping: `updated_at` for last-write-wins ordering and
    // `deleted_at` tombstones so deletions propagate instead of vanishing.
    // Runs after the UUID conversion so it only ever touches TEXT-keyed tables.
    add_sync_columns(conn)?;

    Ok(())
}

/// Baseline `updated_at` for pre-sync rows: one tick past the epoch, so it's the
/// oldest possible yet still clears the epoch-seeded sync watermark.
const PRE_SYNC_BASELINE: &str = "'1970-01-01T00:00:01+00:00'";

/// Add `updated_at` / `deleted_at` to a syncable table, backfilling
/// `updated_at` from an existing timestamp column so pre-sync rows get a sane
/// baseline. Idempotent via the column guards.
fn add_sync_columns(conn: &Connection) -> rusqlite::Result<()> {
    for (table, backfill) in [
        ("tasks", "created_at"),
        ("labels", PRE_SYNC_BASELINE),
        ("time_sessions", "start_at"),
        ("task_labels", PRE_SYNC_BASELINE),
    ] {
        if !column_exists(conn, table, "updated_at") {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"),
                [],
            )?;
            conn.execute(
                &format!("UPDATE {table} SET updated_at = {backfill} WHERE updated_at = ''"),
                [],
            )?;
        }
        if !column_exists(conn, table, "deleted_at") {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN deleted_at TEXT"),
                [],
            )?;
        }
    }
    Ok(())
}

/// True while `tasks.id` is still declared `INTEGER` — i.e. this database was
/// created before the UUID switch and still needs converting.
fn ids_are_integer(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT type FROM pragma_table_info('tasks') WHERE name = 'id'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|t| t.eq_ignore_ascii_case("integer"))
    .unwrap_or(false)
}

/// One integer-keyed task row, read into memory before the tables are rewritten.
struct TaskRow {
    id: String, // freshly assigned UUID
    title: String,
    notes: Option<String>,
    due_date: Option<String>,
    remind_at: Option<String>,
    status: String,
    priority: i64,
    created_at: String,
    completed_at: Option<String>,
    order_index: f64,
    notified: i64,
    pinned: i64,
    repeat: Option<String>,
    subtasks: Option<String>,
}

/// One integer-keyed focus session, read into memory before the rewrite.
struct SessionRow {
    id: String, // freshly assigned UUID
    task_id: String,
    start_at: String,
    end_at: Option<String>,
    seconds: Option<i64>,
    notified: i64,
}

/// Convert the syncable tables (`labels`, `tasks`, `task_labels`,
/// `time_sessions`) from integer AUTOINCREMENT ids to on-device UUIDs.
///
/// Everything is read into memory first so old integer ids can be remapped to
/// their new UUIDs consistently across foreign keys, then the tables are
/// dropped and recreated with TEXT keys and the remapped rows re-inserted. The
/// recreate DDL mirrors the `CREATE TABLE` statements in [`init`] — keep the
/// two in sync if the schema changes. `pomodoro` and `settings` are untouched
/// (singleton / device-local, never synced).
fn migrate_ids_to_uuid(conn: &Connection) -> rusqlite::Result<()> {
    if !ids_are_integer(conn) {
        return Ok(());
    }

    // 1. Read labels, assigning a UUID to each old id.
    let mut label_map: HashMap<i64, String> = HashMap::new();
    let labels: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare("SELECT id, name, color FROM labels")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(old, name, color)| {
                let nid = new_uuid();
                label_map.insert(old, nid.clone());
                (nid, name, color)
            })
            .collect()
    };

    // 2. Read tasks, assigning a UUID to each old id.
    let mut task_map: HashMap<i64, String> = HashMap::new();
    let tasks: Vec<TaskRow> = {
        let mut stmt = conn.prepare(
            "SELECT id, title, notes, due_date, remind_at, status, priority,
                    created_at, completed_at, order_index, notified, pinned,
                    repeat, subtasks
             FROM tasks",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let old: i64 = r.get(0)?;
                Ok((
                    old,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, Option<String>>(8)?,
                    r.get::<_, f64>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, i64>(11)?,
                    r.get::<_, Option<String>>(12)?,
                    r.get::<_, Option<String>>(13)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|t| {
                let nid = new_uuid();
                task_map.insert(t.0, nid.clone());
                TaskRow {
                    id: nid,
                    title: t.1,
                    notes: t.2,
                    due_date: t.3,
                    remind_at: t.4,
                    status: t.5,
                    priority: t.6,
                    created_at: t.7,
                    completed_at: t.8,
                    order_index: t.9,
                    notified: t.10,
                    pinned: t.11,
                    repeat: t.12,
                    subtasks: t.13,
                }
            })
            .collect()
    };

    // 3. Read the join rows and sessions, remapping their foreign keys. Rows
    //    whose parent is missing (shouldn't happen with FKs on) are dropped.
    let task_labels: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT task_id, label_id FROM task_labels")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .filter_map(|(t, l)| Some((task_map.get(&t)?.clone(), label_map.get(&l)?.clone())))
            .collect()
    };
    let sessions: Vec<SessionRow> = {
        let mut stmt = conn
            .prepare("SELECT id, task_id, start_at, end_at, seconds, notified FROM time_sessions")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .filter_map(|(task, start_at, end_at, seconds, notified)| {
                Some(SessionRow {
                    id: new_uuid(),
                    task_id: task_map.get(&task)?.clone(),
                    start_at,
                    end_at,
                    seconds,
                    notified,
                })
            })
            .collect()
    };

    // 4. Rewrite. Disable FK enforcement so dropping/recreating the tables in
    //    dependency order doesn't cascade-delete children mid-swap.
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        DROP TABLE task_labels;
        DROP TABLE time_sessions;
        DROP TABLE tasks;
        DROP TABLE labels;

        CREATE TABLE labels (
            id    TEXT PRIMARY KEY,
            name  TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6c7cff'
        );
        CREATE TABLE tasks (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            notes        TEXT,
            due_date     TEXT,
            remind_at    TEXT,
            status       TEXT NOT NULL DEFAULT 'active',
            priority     INTEGER NOT NULL DEFAULT 4,
            created_at   TEXT NOT NULL,
            completed_at TEXT,
            order_index  REAL NOT NULL DEFAULT 0,
            notified     INTEGER NOT NULL DEFAULT 0,
            pinned       INTEGER NOT NULL DEFAULT 0,
            repeat       TEXT,
            subtasks     TEXT
        );
        CREATE TABLE task_labels (
            task_id  TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
            label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, label_id)
        );
        CREATE TABLE time_sessions (
            id       TEXT PRIMARY KEY,
            task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            start_at TEXT NOT NULL,
            end_at   TEXT,
            seconds  INTEGER,
            notified INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_sessions_task ON time_sessions(task_id);
        CREATE INDEX idx_tasks_status  ON tasks(status);
        CREATE INDEX idx_tasks_due     ON tasks(due_date);
        CREATE INDEX idx_tasks_remind  ON tasks(remind_at);
        CREATE INDEX idx_tasks_pinned  ON tasks(pinned);
        ",
    )?;

    for (id, name, color) in &labels {
        conn.execute(
            "INSERT INTO labels (id, name, color) VALUES (?1, ?2, ?3)",
            params![id, name, color],
        )?;
    }
    for t in &tasks {
        conn.execute(
            "INSERT INTO tasks (id, title, notes, due_date, remind_at, status,
                                priority, created_at, completed_at, order_index,
                                notified, pinned, repeat, subtasks)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                t.id,
                t.title,
                t.notes,
                t.due_date,
                t.remind_at,
                t.status,
                t.priority,
                t.created_at,
                t.completed_at,
                t.order_index,
                t.notified,
                t.pinned,
                t.repeat,
                t.subtasks,
            ],
        )?;
    }
    for (task_id, label_id) in &task_labels {
        conn.execute(
            "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
            params![task_id, label_id],
        )?;
    }
    for s in &sessions {
        conn.execute(
            "INSERT INTO time_sessions (id, task_id, start_at, end_at, seconds, notified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![s.id, s.task_id, s.start_at, s.end_at, s.seconds, s.notified],
        )?;
    }

    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a database on the pre-UUID schema (integer AUTOINCREMENT ids) with
    /// a few interlinked rows, exactly as an older install would have on disk.
    fn seed_legacy(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE labels (
                id    INTEGER PRIMARY KEY AUTOINCREMENT,
                name  TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6c7cff'
            );
            CREATE TABLE tasks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT NOT NULL,
                notes        TEXT,
                due_date     TEXT,
                remind_at    TEXT,
                status       TEXT NOT NULL DEFAULT 'active',
                priority     INTEGER NOT NULL DEFAULT 4,
                created_at   TEXT NOT NULL,
                completed_at TEXT,
                order_index  REAL NOT NULL DEFAULT 0,
                notified     INTEGER NOT NULL DEFAULT 0,
                pinned       INTEGER NOT NULL DEFAULT 0,
                repeat       TEXT,
                subtasks     TEXT
            );
            CREATE TABLE task_labels (
                task_id  INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
                label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, label_id)
            );
            CREATE TABLE time_sessions (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                start_at TEXT NOT NULL,
                end_at   TEXT,
                seconds  INTEGER,
                notified INTEGER NOT NULL DEFAULT 0
            );

            INSERT INTO labels (id, name, color) VALUES
                (1, 'home', '#111111'), (2, 'work', '#222222');
            INSERT INTO tasks (id, title, created_at, order_index) VALUES
                (10, 'buy milk', '2026-01-01T00:00:00+00:00', 1.0),
                (11, 'ship it',  '2026-01-02T00:00:00+00:00', 2.0);
            INSERT INTO task_labels (task_id, label_id) VALUES
                (10, 1), (11, 1), (11, 2);
            INSERT INTO time_sessions (id, task_id, start_at, end_at, seconds) VALUES
                (100, 11, '2026-01-02T09:00:00+00:00', '2026-01-02T09:30:00+00:00', 1800);
            ",
        )
        .unwrap();
    }

    #[test]
    fn migrates_integer_ids_to_uuids() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);

        // init() runs the CREATE TABLE IF NOT EXISTS (no-ops on the existing
        // tables) then migrate(), which performs the UUID conversion.
        init(&conn).unwrap();

        // tasks.id is now TEXT.
        let id_type: String = conn
            .query_row(
                "SELECT type FROM pragma_table_info('tasks') WHERE name = 'id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(id_type, "TEXT");

        // Row counts preserved.
        let tasks: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        let labels: i64 = conn
            .query_row("SELECT COUNT(*) FROM labels", [], |r| r.get(0))
            .unwrap();
        let links: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_labels", [], |r| r.get(0))
            .unwrap();
        let sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM time_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!((tasks, labels, links, sessions), (2, 2, 3, 1));

        // Every id is now a 36-char UUID string, not a small integer.
        let task_id: String = conn
            .query_row("SELECT id FROM tasks WHERE title = 'ship it'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(task_id.len(), 36);

        // Foreign keys were remapped consistently: 'ship it' still has exactly
        // its two labels, joined by the new UUIDs.
        let ship_labels: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_labels tl
                 JOIN tasks t ON t.id = tl.task_id
                 WHERE t.title = 'ship it'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ship_labels, 2);

        // The focus session still points at 'ship it' via the remapped key.
        let session_task: String = conn
            .query_row(
                "SELECT t.title FROM time_sessions s JOIN tasks t ON t.id = s.task_id",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(session_task, "ship it");

        // Running init() again is a no-op (ids already TEXT) and preserves ids.
        init(&conn).unwrap();
        let same: String = conn
            .query_row("SELECT id FROM tasks WHERE title = 'ship it'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(same, task_id);
    }

    #[test]
    fn adds_sync_columns_and_backfills() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();

        // updated_at is backfilled from created_at, deleted_at starts NULL.
        let (updated, deleted): (String, Option<String>) = conn
            .query_row(
                "SELECT updated_at, deleted_at FROM tasks WHERE title = 'buy milk'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(updated, "2026-01-01T00:00:00+00:00");
        assert_eq!(deleted, None);

        for table in ["labels", "time_sessions"] {
            let n: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE updated_at = ''"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 0, "{table} has un-backfilled updated_at");
        }
    }

    #[test]
    fn delete_is_a_tombstone() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t1', 'x', 'c', 'c')",
            [],
        )
        .unwrap();

        conn.execute(
            "UPDATE tasks SET deleted_at = 'now', updated_at = 'now' WHERE id = 't1'",
            [],
        )
        .unwrap();

        let live: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!((live, total), (0, 1));
    }
}
