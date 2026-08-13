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

/** Human label for a due date relative to today. */
export function formatDue(date: string): {
  label: string;
  tone: "overdue" | "today" | "soon" | "future";
} {
  const t = today();
  if (date < t) return { label: relative(date), tone: "overdue" };
  if (date === t) return { label: "Today", tone: "today" };

  const tomorrow = toLocalDate(new Date(Date.now() + 86400000));
  if (date === tomorrow) return { label: "Tomorrow", tone: "soon" };

  const d = new Date(date + "T00:00:00");
  const withinWeek = (d.getTime() - Date.now()) / 86400000 < 7;
  const opts: Intl.DateTimeFormatOptions = withinWeek
    ? { weekday: "long" }
    : { month: "short", day: "numeric" };
  return { label: d.toLocaleDateString(undefined, opts), tone: "future" };
}

function relative(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
