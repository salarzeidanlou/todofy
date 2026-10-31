//! Per-priority profiles.
//!
//! A priority's number is the data — it is what a task stores and what the
//! quick-add parser reads out of `p1`. There are always exactly four, they are
//! never created or deleted, and their IDs are the numbers themselves. So,
//! unlike board columns, these rows need no identity of their own and no
//! tombstones; only their contents ever change.
//!
//! Every reminder field is nullable, meaning "follow the global reminder
//! settings". A profile the user has never touched therefore changes nothing
//! about how reminders already behave, and the common case stays configured in
//! one place (Settings → Notifications) rather than four.

use crate::db::Db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

/// The same ancient revision the board's seeded columns carry, so a fresh
/// install can never win a last-write-wins race against profiles customized on
/// another device.
pub const SEED_TIME: &str = crate::board::SEED_TIME;

pub const VALUES: [i64; 4] = [1, 2, 3, 4];

/// Matching `--color-prio-1..4` in `styles/global.css` and `DEFAULT_PROFILES`
/// in `lib/priority.ts`.
const DEFAULTS: [(i64, &str, &str); 4] = [
    (1, "Priority 1", "#f2555a"),
    (2, "Priority 2", "#f2b155"),
    (3, "Priority 3", "#6c7cff"),
    (4, "Priority 4", "#6b7885"),
];

/// Sound identifiers the frontend's player understands (`lib/sound.ts`).
const SOUNDS: [&str; 5] = ["none", "chime", "ping", "bell", "custom"];

const STYLES: [&str; 2] = ["custom", "native"];

/// A reminder that repeats less often than this is indistinguishable from one
/// that doesn't, and the number is a nag interval rather than a schedule.
const MAX_REPEAT_MINUTES: i64 = 1440;

const MAX_NAME_CHARS: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriorityProfile {
    pub priority: i64,
    pub name: String,
    pub color: String,
    /// Each override is `None` when this priority defers to the global setting.
    pub sound: Option<String>,
    pub volume: Option<i64>,
    pub ramp: Option<bool>,
    pub notification_style: Option<String>,
    /// Minutes between repeats of an unanswered reminder; `Some(0)` means the
    /// reminder fires once, which is not the same as deferring to the global
    /// setting.
    pub repeat_minutes: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub sound: Option<String>,
    #[serde(default)]
    pub volume: Option<i64>,
    #[serde(default)]
    pub ramp: Option<bool>,
    #[serde(default)]
    pub notification_style: Option<String>,
    #[serde(default)]
    pub repeat_minutes: Option<i64>,
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS priority_profiles (
            priority           INTEGER PRIMARY KEY CHECK (priority BETWEEN 1 AND 4),
            name               TEXT NOT NULL,
            color              TEXT NOT NULL,
            sound              TEXT,
            volume             INTEGER CHECK (volume IS NULL OR volume BETWEEN 0 AND 100),
            ramp               INTEGER,
            notification_style TEXT CHECK (notification_style IS NULL
                                   OR notification_style IN ('custom', 'native')),
            repeat_minutes     INTEGER CHECK (repeat_minutes IS NULL
                                   OR repeat_minutes BETWEEN 0 AND 1440),
            updated_at         TEXT NOT NULL
        );",
    )?;
    for (priority, name, color) in DEFAULTS {
        conn.execute(
            "INSERT OR IGNORE INTO priority_profiles (priority, name, color, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![priority, name, color, SEED_TIME],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<PriorityProfile>> {
    let mut stmt = conn.prepare(
        "SELECT priority, name, color, sound, volume, ramp, notification_style,
                repeat_minutes, updated_at
         FROM priority_profiles ORDER BY priority",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PriorityProfile {
                priority: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                sound: r.get(3)?,
                volume: r.get(4)?,
                ramp: r.get::<_, Option<i64>>(5)?.map(|n| n != 0),
                notification_style: r.get(6)?,
                repeat_minutes: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })?
        .collect();
    rows
}

fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

pub fn validate(input: &ProfileInput) -> rusqlite::Result<()> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid("Priority name must contain 1–40 characters"));
    }
    if input.color.len() != 7
        || !input.color.starts_with('#')
        || !input.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid("Choose a valid six-digit hex color"));
    }
    if input
        .sound
        .as_deref()
        .is_some_and(|sound| !SOUNDS.contains(&sound))
    {
        return Err(invalid("Unknown reminder sound"));
    }
    if input.volume.is_some_and(|n| !(0..=100).contains(&n)) {
        return Err(invalid("Volume must be between 0 and 100"));
    }
    if input
        .notification_style
        .as_deref()
        .is_some_and(|style| !STYLES.contains(&style))
    {
        return Err(invalid("Unknown notification style"));
    }
    if input
        .repeat_minutes
        .is_some_and(|n| !(0..=MAX_REPEAT_MINUTES).contains(&n))
    {
        return Err(invalid("Repeat interval must be between 0 and 1440 minutes"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_priority_profiles(db: State<Db>) -> Result<Vec<PriorityProfile>, String> {
    list(&db.conn()).map_err(|e| e.to_string())
}

pub fn update(
    conn: &Connection,
    priority: i64,
    input: &ProfileInput,
) -> rusqlite::Result<Vec<PriorityProfile>> {
    if !VALUES.contains(&priority) {
        return Err(invalid("A priority is one of 1 to 4"));
    }
    validate(input)?;
    conn.execute(
        "UPDATE priority_profiles
            SET name = ?1, color = ?2, sound = ?3, volume = ?4, ramp = ?5,
                notification_style = ?6, repeat_minutes = ?7, updated_at = ?8
          WHERE priority = ?9",
        params![
            input.name.trim(),
            input.color.to_lowercase(),
            input.sound,
            input.volume,
            input.ramp,
            input.notification_style,
            input.repeat_minutes,
            chrono::Utc::now().to_rfc3339(),
            priority
        ],
    )?;
    list(conn)
}

#[tauri::command]
pub fn update_priority_profile(
    db: State<Db>,
    priority: i64,
    input: ProfileInput,
) -> Result<Vec<PriorityProfile>, String> {
    update(&db.conn(), priority, &input).map_err(|e| e.to_string())
}

/// Put a priority back to its built-in name and color with no overrides.
/// Stamped with the current time rather than `SEED_TIME`: a reset is a
/// deliberate edit, and has to be able to win against the customized row
/// sitting in the cloud.
pub fn reset(conn: &Connection, priority: i64) -> rusqlite::Result<Vec<PriorityProfile>> {
    let Some((_, name, color)) = DEFAULTS.iter().find(|(value, _, _)| *value == priority) else {
        return Err(invalid("A priority is one of 1 to 4"));
    };
    conn.execute(
        "UPDATE priority_profiles
            SET name = ?1, color = ?2, sound = NULL, volume = NULL, ramp = NULL,
                notification_style = NULL, repeat_minutes = NULL, updated_at = ?3
          WHERE priority = ?4",
        params![name, color, chrono::Utc::now().to_rfc3339(), priority],
    )?;
    list(conn)
}

#[tauri::command]
pub fn reset_priority_profile(
    db: State<Db>,
    priority: i64,
) -> Result<Vec<PriorityProfile>, String> {
    reset(&db.conn(), priority).map_err(|e| e.to_string())
}

/// Has the user named or recolored this priority? Mirrors `isCustomized` in
/// `lib/priority.ts`, which decides whether a task row shows it at all.
pub fn is_customized(profile: &PriorityProfile) -> bool {
    DEFAULTS
        .iter()
        .find(|(value, _, _)| *value == profile.priority)
        .is_none_or(|(_, name, color)| {
            profile.name != *name || !profile.color.eq_ignore_ascii_case(color)
        })
}

/// What a notification calls this priority. An untouched one says "Reminder"
/// rather than "Priority 1", which tells the reader nothing they wanted.
pub fn reminder_label(profile: Option<&PriorityProfile>) -> String {
    match profile {
        Some(p) if is_customized(p) => p.name.clone(),
        _ => "Reminder".to_owned(),
    }
}

/// The color a notification wears, or `None` to keep todofy's own accent for a
/// priority that isn't visually distinct anywhere else.
pub fn reminder_accent(profile: Option<&PriorityProfile>) -> String {
    match profile {
        Some(p) if is_customized(p) => p.color.clone(),
        _ => String::new(),
    }
}

/// How a given task's reminder should behave, with each profile override
/// already folded over the global setting. The sound is resolved in the
/// frontend, which is what actually plays it.
#[derive(Debug, PartialEq)]
pub struct Resolved {
    /// `"custom"` for todofy's own corner popup, `"native"` for the OS.
    pub style: String,
    /// Minutes between repeats, or `None` to fire once.
    pub repeat_minutes: Option<i64>,
}

/// Fold a priority's overrides over the global reminder settings. An unknown
/// priority, or a profile row that somehow went missing, resolves to the
/// globals — the same answer todofy gave before profiles existed.
pub fn resolve(conn: &Connection, priority: i64) -> Resolved {
    let global = Resolved {
        style: crate::settings::notification_style(conn),
        repeat_minutes: crate::settings::reminder_repeat_minutes(conn),
    };
    let row: Option<(Option<String>, Option<i64>)> = conn
        .query_row(
            "SELECT notification_style, repeat_minutes FROM priority_profiles WHERE priority = ?1",
            [priority],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((style, repeat_minutes)) = row else {
        return global;
    };
    Resolved {
        style: style.unwrap_or(global.style),
        // `Some(0)` is the user saying "this one fires once" — a real choice,
        // not an absent override, so it must not fall through to the global.
        repeat_minutes: match repeat_minutes {
            Some(0) => None,
            Some(minutes) => Some(minutes),
            None => global.repeat_minutes,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::init(&c).unwrap();
        c
    }

    fn input() -> ProfileInput {
        ProfileInput {
            name: "Urgent".into(),
            color: "#F2555A".into(),
            sound: Some("bell".into()),
            volume: Some(90),
            ramp: Some(true),
            notification_style: Some("native".into()),
            repeat_minutes: Some(2),
        }
    }

    fn profile(c: &Connection, priority: i64) -> PriorityProfile {
        list(c)
            .unwrap()
            .into_iter()
            .find(|p| p.priority == priority)
            .expect("every priority has a row")
    }

    #[test]
    fn seeds_four_priorities_and_leaves_edits_alone_on_reopen() {
        let c = setup();
        assert_eq!(list(&c).unwrap().len(), 4);
        update(&c, 1, &input()).unwrap();

        // `init` runs on every launch; it must not undo a customization.
        crate::db::init(&c).unwrap();
        let first = profile(&c, 1);
        assert_eq!(first.name, "Urgent");
        assert_eq!(first.color, "#f2555a", "stored folded to lower case");
        assert_eq!(list(&c).unwrap().len(), 4, "and adds no fifth priority");
    }

    #[test]
    fn an_untouched_profile_carries_the_seed_revision() {
        // Which is what stops a fresh install overwriting a customized row in
        // the cloud; see `apply_remote` and the server-side guard.
        let c = setup();
        assert_eq!(profile(&c, 2).updated_at, SEED_TIME);
        update(&c, 2, &input()).unwrap();
        assert_ne!(profile(&c, 2).updated_at, SEED_TIME);
    }

    #[test]
    fn reset_restores_the_defaults_and_can_still_win_a_sync() {
        let c = setup();
        update(&c, 3, &input()).unwrap();
        reset(&c, 3).unwrap();
        let third = profile(&c, 3);
        assert_eq!(third.name, "Priority 3");
        assert_eq!(third.color, "#6c7cff");
        assert_eq!(third.sound, None);
        assert_eq!(third.notification_style, None);
        assert_eq!(third.repeat_minutes, None);
        assert_ne!(
            third.updated_at, SEED_TIME,
            "a reset is an edit, not a return to never-touched"
        );
    }

    #[test]
    fn validation_rejects_what_the_ui_cannot_render_or_play() {
        let c = setup();
        let bad = |change: fn(&mut ProfileInput)| {
            let mut value = input();
            change(&mut value);
            assert!(update(&c, 1, &value).is_err());
        };
        bad(|v| v.name = "   ".into());
        bad(|v| v.name = "x".repeat(41));
        bad(|v| v.color = "red".into());
        bad(|v| v.color = "#12345".into());
        bad(|v| v.sound = Some("airhorn".into()));
        bad(|v| v.volume = Some(101));
        bad(|v| v.notification_style = Some("toast".into()));
        bad(|v| v.repeat_minutes = Some(-1));
        bad(|v| v.repeat_minutes = Some(MAX_REPEAT_MINUTES + 1));
        assert!(update(&c, 5, &input()).is_err(), "and there is no P5");
        assert!(reset(&c, 0).is_err());
    }

    #[test]
    fn overrides_round_trip_including_the_ones_that_mean_off() {
        let c = setup();
        update(
            &c,
            4,
            &ProfileInput {
                sound: Some("none".into()),
                volume: Some(0),
                ramp: Some(false),
                repeat_minutes: Some(0),
                ..input()
            },
        )
        .unwrap();
        let fourth = profile(&c, 4);
        assert_eq!(fourth.sound.as_deref(), Some("none"));
        assert_eq!(fourth.volume, Some(0));
        assert_eq!(fourth.ramp, Some(false));
        assert_eq!(fourth.repeat_minutes, Some(0));
    }

    /// The editor sends every field each time, so clearing an override has to
    /// travel as a null rather than as "unchanged".
    #[test]
    fn clearing_an_override_returns_the_profile_to_inheriting() {
        let c = setup();
        update(&c, 1, &input()).unwrap();
        update(
            &c,
            1,
            &ProfileInput {
                name: "Urgent".into(),
                color: "#f2555a".into(),
                sound: None,
                volume: None,
                ramp: None,
                notification_style: None,
                repeat_minutes: None,
            },
        )
        .unwrap();
        let first = profile(&c, 1);
        assert_eq!(first.name, "Urgent", "the name is not an override");
        assert_eq!(first.sound, None);
        assert_eq!(first.volume, None);
        assert_eq!(first.ramp, None);
        assert_eq!(first.notification_style, None);
        assert_eq!(first.repeat_minutes, None);
    }

    /// "⏰ Priority 1 · todofy" tells the reader nothing they didn't know, so
    /// an untouched priority keeps the old wording and todofy's own accent.
    #[test]
    fn a_notification_only_wears_a_priority_the_user_made_their_own() {
        let c = setup();
        assert_eq!(reminder_label(Some(&profile(&c, 1))), "Reminder");
        assert_eq!(reminder_accent(Some(&profile(&c, 1))), "");
        assert_eq!(reminder_label(None), "Reminder");

        update(&c, 1, &input()).unwrap();
        assert_eq!(reminder_label(Some(&profile(&c, 1))), "Urgent");
        assert_eq!(reminder_accent(Some(&profile(&c, 1))), "#f2555a");

        // A recolor alone is enough to count, the same as on a task row.
        update(
            &c,
            2,
            &ProfileInput {
                name: "Priority 2".into(),
                color: "#38bdf8".into(),
                ..input()
            },
        )
        .unwrap();
        assert!(is_customized(&profile(&c, 2)));
    }

    #[test]
    fn an_untouched_priority_resolves_to_the_global_settings() {
        let c = setup();
        crate::settings::write(&c, "notification_style", "native").unwrap();
        crate::settings::write(&c, "reminder_repeat_minutes", "10").unwrap();
        assert_eq!(
            resolve(&c, 2),
            Resolved {
                style: "native".into(),
                repeat_minutes: Some(10),
            }
        );
        // And an unknown priority can only fall back to them.
        assert_eq!(resolve(&c, 9).style, "native");
    }

    #[test]
    fn an_override_wins_over_the_global_setting() {
        let c = setup();
        crate::settings::write(&c, "notification_style", "native").unwrap();
        crate::settings::write(&c, "reminder_repeat_minutes", "10").unwrap();
        update(&c, 1, &input()).unwrap();
        assert_eq!(
            resolve(&c, 1),
            Resolved {
                style: "native".into(),
                repeat_minutes: Some(2),
            }
        );
        update(
            &c,
            1,
            &ProfileInput {
                notification_style: Some("custom".into()),
                ..input()
            },
        )
        .unwrap();
        assert_eq!(resolve(&c, 1).style, "custom");
    }

    /// Only some of a profile's fields being set must leave the rest on the
    /// global — that is the whole point of them being nullable.
    #[test]
    fn overrides_are_folded_field_by_field() {
        let c = setup();
        crate::settings::write(&c, "notification_style", "native").unwrap();
        crate::settings::write(&c, "reminder_repeat_minutes", "10").unwrap();
        update(
            &c,
            3,
            &ProfileInput {
                notification_style: None,
                repeat_minutes: Some(5),
                ..input()
            },
        )
        .unwrap();
        assert_eq!(
            resolve(&c, 3),
            Resolved {
                style: "native".into(),
                repeat_minutes: Some(5),
            }
        );
    }

    /// "This one only tells me once" is a choice, and has to survive a global
    /// setting that says to keep nagging.
    #[test]
    fn a_zero_repeat_override_means_once_rather_than_inherit() {
        let c = setup();
        crate::settings::write(&c, "reminder_repeat_minutes", "2").unwrap();
        update(
            &c,
            4,
            &ProfileInput {
                repeat_minutes: Some(0),
                ..input()
            },
        )
        .unwrap();
        assert_eq!(resolve(&c, 4).repeat_minutes, None);
    }

    /// The frontend reads these keys off the wire, so a rename here is a
    /// silently unstyled priority over there.
    #[test]
    fn serializes_as_the_frontend_reads_it() {
        let c = setup();
        update(&c, 1, &input()).unwrap();
        let json = serde_json::to_value(profile(&c, 1)).unwrap();
        assert_eq!(json["priority"], 1);
        assert_eq!(json["name"], "Urgent");
        assert_eq!(json["color"], "#f2555a");
        assert_eq!(json["sound"], "bell");
        assert_eq!(json["volume"], 90);
        assert_eq!(json["ramp"], true);
        assert_eq!(json["notificationStyle"], "native");
        assert_eq!(json["repeatMinutes"], 2);
        assert!(json["updatedAt"].is_string());
    }
}
