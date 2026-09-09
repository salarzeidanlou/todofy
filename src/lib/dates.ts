import { appLocale, usesHour12 } from "./locale";

/** Local YYYY-MM-DD for a Date (avoids UTC off-by-one from toISOString). */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toLocalDate(new Date());
}

/**
 * Human label for a due date, phrased relative to today ("in 3 days") rather
 * than as a calendar date; far-off dates fall back to an absolute date.
 *
 * `remindAt` makes "today" precise — a task set for 09:00 is late by 20:00 —
 * so pass it, omitting it for completed tasks, which are never late.
 */
export function formatDue(
  date: string,
  remindAt?: string | null,
): {
  label: string;
  tone: "overdue" | "today" | "soon" | "future";
} {
  const t = today();
  const days = daysBetween(t, date);

  // The reminder time itself is rendered alongside this label, so lateness
  // shows as a change of tone rather than a repeat of the time.
  if (days === 0)
    return { label: "Today", tone: isPast(remindAt) ? "overdue" : "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days === -1) return { label: "Yesterday", tone: "overdue" };

  if (days > 1) return { label: relativeFuture(date, days), tone: "future" };
  return { label: relativePast(date, -days), tone: "overdue" };
}

/** Has this reminder instant already passed? Unset or unparseable means no. */
export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && t <= Date.now();
}

/** Whole-day difference between two YYYY-MM-DD dates (b - a), calendar-based. */
function daysBetween(a: string, b: string): number {
  const start = new Date(a + "T00:00:00").getTime();
  const end = new Date(b + "T00:00:00").getTime();
  return Math.round((end - start) / 86400000);
}

function absoluteDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(appLocale(), {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function relativeFuture(date: string, days: number): string {
  if (days <= 13) return `in ${days} days`;
  if (days <= 30) return `in ${Math.round(days / 7)} weeks`;
  return absoluteDate(date);
}

function relativePast(date: string, days: number): string {
  if (days <= 13) return `${days} days ago`;
  if (days <= 30) return `${Math.round(days / 7)} weeks ago`;
  return absoluteDate(date);
}

/** Convert a stored ISO/UTC datetime to a value for <input type=datetime-local>. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Convert a datetime-local input value (local wall time) to stored ISO/UTC. */
export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function atTime(d: Date, h: number, m = 0): string {
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/** Quick reminder presets for the detail panel. */
export function reminderPresets(): { label: string; iso: string }[] {
  const evening = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextMon = new Date();
  // 1..7 days until the next Monday.
  nextMon.setDate(nextMon.getDate() + ((8 - nextMon.getDay()) % 7 || 7));

  return [
    { label: "Later today", iso: new Date(Date.now() + 3 * 3600_000).toISOString() },
    { label: "This evening", iso: atTime(evening, 18) },
    { label: "Tomorrow 9am", iso: atTime(tomorrow, 9) },
    { label: "Next week", iso: atTime(nextMon, 9) },
  ];
}

/** ISO time `minutes` from now — used for snoozing. */
export function snoozeFrom(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Combine a local date (YYYY-MM-DD) + time (HH:mm) into a stored ISO/UTC. */
export function combineDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

/** Extract the local time (HH:mm) from a stored ISO datetime, else "". */
export function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Numeric parts of a wall-clock time. */
export interface Clock {
  h: number;
  m: number;
}

/** Parse a stored 24-hour "HH:mm" into parts, or null if unusable. */
export function parseClock(value: string | null): Clock | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/**
 * A stored 24-hour "HH:mm" from a picker's segments, or null while incomplete
 * or out of range. An empty minute reads as :00, so a bare hour is usable.
 */
export function composeClock(
  hourText: string,
  minuteText: string,
  pm: boolean,
  hour12: boolean,
): string | null {
  if (hourText === "") return null;
  let h = Number(hourText);
  if (!Number.isInteger(h)) return null;
  if (hour12) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  const m = minuteText === "" ? 0 : Number(minuteText);
  if (!Number.isInteger(m) || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/** The hour as displayed in the active convention (12-hour shows 12, not 0). */
export function clockHourText(clock: Clock | null, hour12: boolean): string {
  if (!clock) return "";
  if (!hour12) return pad2(clock.h);
  return String(clock.h % 12 === 0 ? 12 : clock.h % 12);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Human time in the user's convention, e.g. "9:00 AM" or "09:00". */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(appLocale(), {
    hour: "numeric",
    minute: "2-digit",
    hour12: usesHour12(),
  });
}

/** Human-readable reminder time, e.g. "Aug 14, 9:00 AM". */
export function formatReminder(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(appLocale(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: usesHour12(),
  });
}
