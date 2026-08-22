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
 * Human label for a due date, phrased relative to today ("in 3 days",
 * "2 weeks ago") rather than as a bare calendar date. Relative wording is
 * easier to act on for anyone with time-blindness; far-off dates fall back to
 * an absolute date so they stay unambiguous.
 */
export function formatDue(date: string): {
  label: string;
  tone: "overdue" | "today" | "soon" | "future";
} {
  const t = today();
  const days = daysBetween(t, date);

  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days === -1) return { label: "Yesterday", tone: "overdue" };

  if (days > 1) return { label: relativeFuture(date, days), tone: "future" };
  return { label: relativePast(date, -days), tone: "overdue" };
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
  return d.toLocaleDateString(undefined, {
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

/** Human 12-hour time, e.g. "9:00 AM". */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Human-readable reminder time, e.g. "Aug 14, 9:00 AM". */
export function formatReminder(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
