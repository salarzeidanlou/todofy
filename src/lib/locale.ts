/**
 * Locale resolution for clock and calendar conventions.
 *
 * The webview's own locale is unreliable — under WebKitGTK `navigator.language`
 * reports `en-US` whatever `LC_TIME` says — so it comes from the backend, with
 * explicit overrides. Resolved values live in module state so the formatters in
 * `dates.ts` can read them without hooks; changing one bumps `store.ts` to
 * repaint.
 */

import { api } from "./api";

export type TimeFormatPref = "auto" | "12" | "24";
/** "auto", or the resolved first day as a weekday index (0 = Sunday). */
export type WeekStartPref = "auto" | "0" | "1" | "6";

const TIME_FORMAT_KEY = "time_format";
const WEEK_START_KEY = "week_start";

interface Resolved {
  /** Passed to `Intl` as the locale; undefined means "let the runtime pick". */
  locale: string | undefined;
  hour12: boolean;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday. */
  weekStart: number;
}

let systemLocale: string | undefined;
let timeFormatPref: TimeFormatPref = "auto";
let weekStartPref: WeekStartPref = "auto";
let resolved: Resolved = { locale: undefined, hour12: true, weekStart: 0 };

/**
 * Regions that do not start the week on Monday, used only when the runtime is
 * too old for `getWeekInfo`. Monday is the ISO-8601 default; this is the
 * exception list.
 */
const SUNDAY_FIRST = new Set([
  "US", "CA", "JP", "IL", "KR", "TW", "HK", "MO", "BR", "MX", "CO", "AR", "PE",
  "VE", "CL", "PH", "ZA", "IN", "PK", "BD", "TH", "ID", "SG", "NZ", "AU", "CN",
]);
const SATURDAY_FIRST = new Set([
  "AE", "AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA",
  "SA", "SD", "SY", "YE",
]);

/** Does this locale write times with AM/PM? */
function deriveHour12(locale: string | undefined): boolean {
  try {
    // `hourCycle` is absent from the configured TS lib's resolved options, but
    // present at runtime in every engine this ships on.
    const { hourCycle } = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & {
      hourCycle?: string;
    };
    if (hourCycle) return hourCycle === "h11" || hourCycle === "h12";
  } catch {
    /* fall through to the probe below */
  }
  // Older runtimes omit `hourCycle`; look for an AM/PM part instead.
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })
      .formatToParts(new Date(2000, 0, 1, 13, 0))
      .some((part) => part.type === "dayPeriod");
  } catch {
    return true;
  }
}

/** Which weekday this locale starts on, as 0 = Sunday. */
function deriveWeekStart(locale: string | undefined): number {
  if (!locale) return 1;
  try {
    // `getWeekInfo` counts 1 = Monday .. 7 = Sunday; we want 0 = Sunday.
    const info = (
      new Intl.Locale(locale) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number };
        weekInfo?: { firstDay: number };
      }
    );
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (firstDay) return firstDay % 7;
  } catch {
    /* fall through to the region table */
  }
  const region = regionOf(locale);
  if (region && SATURDAY_FIRST.has(region)) return 6;
  if (region && SUNDAY_FIRST.has(region)) return 0;
  return 1;
}

/** The uppercased region subtag of a BCP-47 tag, e.g. "de-DE" -> "DE". */
function regionOf(locale: string): string | undefined {
  const region = locale.split("-").find((part) => /^[A-Za-z]{2}$/.test(part) && part === part.toUpperCase())
    ?? locale.split("-")[1];
  return region ? region.toUpperCase() : undefined;
}

function recompute(): void {
  const locale = systemLocale;
  resolved = {
    locale,
    hour12: timeFormatPref === "auto" ? deriveHour12(locale) : timeFormatPref === "12",
    weekStart:
      weekStartPref === "auto" ? deriveWeekStart(locale) : Number(weekStartPref),
  };
}

/**
 * Read the system locale and any stored overrides. Called once at startup,
 * before the first render that depends on either convention.
 */
export async function initLocale(): Promise<void> {
  const [system, time, week] = await Promise.all([
    api.systemLocale().catch(() => null),
    api.getSetting(TIME_FORMAT_KEY).catch(() => null),
    api.getSetting(WEEK_START_KEY).catch(() => null),
  ]);
  systemLocale = system ?? undefined;
  if (time === "12" || time === "24" || time === "auto") timeFormatPref = time;
  if (week === "0" || week === "1" || week === "6" || week === "auto")
    weekStartPref = week;
  recompute();
}

export const appLocale = (): string | undefined => resolved.locale;
export const usesHour12 = (): boolean => resolved.hour12;
export const weekStart = (): number => resolved.weekStart;
export const timeFormat = (): TimeFormatPref => timeFormatPref;
export const weekStartSetting = (): WeekStartPref => weekStartPref;

export async function setTimeFormat(pref: TimeFormatPref): Promise<void> {
  timeFormatPref = pref;
  recompute();
  await api.setSetting(TIME_FORMAT_KEY, pref).catch(() => {});
}

export async function setWeekStart(pref: WeekStartPref): Promise<void> {
  weekStartPref = pref;
  recompute();
  await api.setSetting(WEEK_START_KEY, pref).catch(() => {});
}

/** What "Auto" currently resolves to, for the settings hint. */
export function autoSummary(): string {
  const hour12 = deriveHour12(systemLocale);
  const start = deriveWeekStart(systemLocale);
  const day = ["Sunday", "Monday", "", "", "", "", "Saturday"][start];
  return `${systemLocale ?? "system default"} · ${hour12 ? "12-hour" : "24-hour"} · week starts ${day}`;
}

/**
 * Weekday names starting from the configured first day, paired with their
 * real weekday index so callers can map grid columns back to dates.
 */
export function weekdayNames(
  style: "narrow" | "short" | "long",
): { index: number; label: string }[] {
  const formatter = new Intl.DateTimeFormat(resolved.locale, { weekday: style });
  return Array.from({ length: 7 }, (_, column) => {
    const index = (resolved.weekStart + column) % 7;
    // 2023-01-01 was a Sunday, so `index` maps straight onto the date.
    return {
      index,
      label: formatter.format(new Date(2023, 0, 1 + index)),
    };
  });
}

/** How many columns sit before `date` in a week starting on the configured day. */
export function weekdayOffset(date: Date): number {
  return (date.getDay() - resolved.weekStart + 7) % 7;
}
