import { parseClock } from "./dates";

export const QUICK_TIMES_KEY = "quick_times";

export const DEFAULT_QUICK_TIMES = ["09:00", "12:00", "18:00"];

/** The picker row only has space for so many chips beside the time field. */
export const MAX_QUICK_TIMES = 4;

/**
 * Read the stored list, dropping anything unusable and falling back to the
 * defaults when nothing valid is left. Blank is a deliberate choice, though —
 * it means "no shortcuts", not "give me the defaults back".
 */
export function parseQuickTimes(stored: string | null | undefined): string[] {
  if (stored === null || stored === undefined) return DEFAULT_QUICK_TIMES;
  if (stored.trim() === "") return [];
  const times = stored
    .split(",")
    .map((part) => normalizeQuickTime(part))
    .filter((part): part is string => part !== null);
  const unique = [...new Set(times)].sort();
  return unique.length ? unique.slice(0, MAX_QUICK_TIMES) : DEFAULT_QUICK_TIMES;
}

export function serializeQuickTimes(times: string[]): string {
  return times.join(",");
}

/** A stored "HH:mm", or null if the text isn't a time of day. */
export function normalizeQuickTime(value: string): string | null {
  const clock = parseClock(value.trim());
  if (!clock) return null;
  return `${String(clock.h).padStart(2, "0")}:${String(clock.m).padStart(2, "0")}`;
}

export function addQuickTime(times: string[], value: string): string[] {
  const time = normalizeQuickTime(value);
  if (!time || times.includes(time)) return times;
  return [...times, time].sort().slice(0, MAX_QUICK_TIMES);
}
