/** Compact human duration, e.g. "1h 20m", "45m", "30s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** m:ss clock for a countdown; negative values render as overtime "+m:ss". */
export function clock(totalSeconds: number): string {
  const over = totalSeconds < 0;
  const s = Math.abs(Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${over ? "+" : ""}${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Compact human duration from whole minutes, e.g. "1h 30m". Separate from
 * `formatDuration` so an estimate never renders as seconds.
 */
export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Parse a typed estimate into whole minutes: "90", "90m", "1h", "1h30",
 * "1h 30m", "1.5h", ":45". Returns null when nothing usable was typed, so the
 * caller can clear the estimate.
 */
export function parseMinutes(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const hm = /^(\d+(?:[.,]\d+)?)\s*h(?:ours?)?\s*(\d+)?\s*m?(?:in(?:ute)?s?)?$/.exec(text);
  if (hm) {
    const hours = Number(hm[1].replace(",", "."));
    const minutes = hm[2] ? Number(hm[2]) : 0;
    const total = Math.round(hours * 60 + minutes);
    return total > 0 ? total : null;
  }

  const mOnly = /^(\d+)\s*m(?:in(?:ute)?s?)?$/.exec(text);
  if (mOnly) return Number(mOnly[1]) > 0 ? Number(mOnly[1]) : null;

  // "1:30" or ":45" — colon-separated hours and minutes.
  const colon = /^(\d*):(\d{1,2})$/.exec(text);
  if (colon) {
    const total = (colon[1] ? Number(colon[1]) : 0) * 60 + Number(colon[2]);
    return total > 0 ? total : null;
  }

  const bare = /^\d+$/.exec(text);
  if (bare) return Number(text) > 0 ? Number(text) : null;

  return null;
}

/** Whole seconds between an ISO instant and now (never negative). */
export function secondsSince(iso: string): number {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}
