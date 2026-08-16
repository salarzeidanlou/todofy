//! Recurrence math for repeating tasks. A task's `repeat` rule is one of
//! `daily | weekdays | weekly | monthly | yearly`. Completing such a task rolls
//! its due date (and reminder, keeping the same wall-clock time) forward to the
//! next occurrence instead of marking it done.

use chrono::{DateTime, Datelike, Days, Local, Months, NaiveDate, TimeZone, Weekday};

/// The next occurrence of `date` under `rule`, or `None` for an unknown rule.
pub fn next_date(date: NaiveDate, rule: &str) -> Option<NaiveDate> {
    match rule {
        "daily" => date.checked_add_days(Days::new(1)),
        "weekly" => date.checked_add_days(Days::new(7)),
        "weekdays" => {
            // Skip Saturday and Sunday: Fri -> Mon, Sat -> Mon, etc.
            let mut d = date.checked_add_days(Days::new(1))?;
            while matches!(d.weekday(), Weekday::Sat | Weekday::Sun) {
                d = d.checked_add_days(Days::new(1))?;
            }
            Some(d)
        }
        // `checked_add_months` clamps overflowing days (Jan 31 -> Feb 28/29).
        "monthly" => date.checked_add_months(Months::new(1)),
        "yearly" => date.checked_add_months(Months::new(12)),
        _ => None,
    }
}

/// Advance a stored due date (`YYYY-MM-DD`) to its next occurrence.
pub fn advance_due(due: &str, rule: &str) -> Option<String> {
    let d = NaiveDate::parse_from_str(due, "%Y-%m-%d").ok()?;
    Some(next_date(d, rule)?.format("%Y-%m-%d").to_string())
}

/// Advance a stored reminder instant (RFC3339) to the same local time on the
/// next occurrence.
pub fn advance_remind(remind: &str, rule: &str) -> Option<String> {
    let dt = DateTime::parse_from_rfc3339(remind)
        .ok()?
        .with_timezone(&Local);
    let naive = next_date(dt.date_naive(), rule)?.and_time(dt.time());
    let local = Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| Local.from_local_datetime(&naive).earliest())?;
    Some(local.to_rfc3339())
}
