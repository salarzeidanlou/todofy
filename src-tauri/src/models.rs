use serde::{Deserialize, Deserializer, Serialize};

/// Deserialize a nullable, optional field so the three JSON states stay
/// distinct: field absent -> `None` (leave unchanged), `null` -> `Some(None)`
/// (clear the column), value -> `Some(Some(v))` (set it). Plain
/// `Option<Option<T>>` collapses `null` and absent to `None`, which would make
/// "clear" a silent no-op.
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::deserialize(de)?))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Label {
    pub id: i64,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<String>,
    pub remind_at: Option<String>,
    pub status: String,
    pub priority: i64,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub order_index: f64,
    pub pinned: bool,
    /// Recurrence rule: daily|weekdays|weekly|monthly|yearly, or None.
    pub repeat: Option<String>,
    /// Total focused seconds from completed stopwatch sessions.
    pub tracked_seconds: i64,
    /// Label ids attached to this task.
    pub label_ids: Vec<i64>,
}

/// Payload for creating a task. Everything but `title` is optional.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<String>,
    pub remind_at: Option<String>,
    pub priority: Option<i64>,
    pub label_ids: Option<Vec<i64>>,
    pub repeat: Option<String>,
}

/// Payload for updating a task. `id` required; provided fields are applied.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub id: i64,
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub remind_at: Option<Option<String>>,
    pub priority: Option<i64>,
    pub label_ids: Option<Vec<i64>>,
    pub pinned: Option<bool>,
    /// `Some(None)` clears the recurrence; `Some(Some(rule))` sets it.
    #[serde(default, deserialize_with = "double_option")]
    pub repeat: Option<Option<String>>,
}

/// The currently running per-task stopwatch, if any.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTimer {
    pub task_id: i64,
    pub title: String,
    pub start_at: String,
}

/// A completed focus session, for the history view.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionLog {
    pub id: i64,
    pub task_id: i64,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub seconds: i64,
}

/// Standalone Pomodoro timer state. Elapsed time in the current phase is
/// `accumulated + (now - start_at)` while running; the frontend derives the
/// live countdown from `target` so it ticks smoothly without polling.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pomodoro {
    pub phase: String,
    pub running: bool,
    pub start_at: Option<String>,
    pub accumulated: i64,
    pub completed_focus: i64,
    /// Seconds the current phase is meant to last.
    pub target: i64,
    pub focus_min: i64,
    pub short_min: i64,
    pub long_min: i64,
    pub long_every: i64,
}
