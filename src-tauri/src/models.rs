use serde::{Deserialize, Serialize};

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
}

/// Payload for updating a task. `id` required; provided fields are applied.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub id: i64,
    pub title: Option<String>,
    pub notes: Option<Option<String>>,
    pub due_date: Option<Option<String>>,
    pub remind_at: Option<Option<String>>,
    pub priority: Option<i64>,
    pub label_ids: Option<Vec<i64>>,
    pub pinned: Option<bool>,
}
