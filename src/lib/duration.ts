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

/** Whole seconds between an ISO instant and now (never negative). */
export function secondsSince(iso: string): number {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}
