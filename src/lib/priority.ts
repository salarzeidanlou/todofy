/**
 * Priority profiles.
 *
 * A priority's *number* is the data — it is what a task stores, what quick-add
 * parses out of `p1`, and what filters match on. Everything else about it (its
 * name, its color, and how its reminders behave) is presentation the user owns.
 *
 * Every reminder field is nullable, meaning "follow the global reminder
 * settings in Settings → Notifications". So a profile the user has never
 * touched changes nothing about how todofy already behaves, and the common
 * case stays configured in exactly one place.
 */

import type { SoundId } from "./sound";

export type PriorityValue = 1 | 2 | 3 | 4;

export const PRIORITY_VALUES: PriorityValue[] = [1, 2, 3, 4];

export type NotificationStyle = "custom" | "native";

export interface PriorityProfile {
  priority: PriorityValue;
  name: string;
  color: string;
  /** Overrides, each null when this priority defers to the global setting. */
  sound: SoundId | null;
  volume: number | null;
  ramp: boolean | null;
  notificationStyle: NotificationStyle | null;
  /** Minutes between repeats of an unanswered reminder; 0 means "once". */
  repeatMinutes: number | null;
  updatedAt: string;
}

/** What the editor sends back: everything but the number and the revision. */
export type PriorityProfileInput = Omit<
  PriorityProfile,
  "priority" | "updatedAt"
>;

export function inputOf(profile: PriorityProfile): PriorityProfileInput {
  const { priority: _priority, updatedAt: _updatedAt, ...input } = profile;
  return input;
}

/**
 * Matching `--color-prio-1..4` in `styles/global.css`, which stay as the CSS
 * fallbacks for rules that can't read a profile (and as the generic red/amber
 * the board's WIP badges borrow).
 */
export const DEFAULT_PRIORITY_COLORS = [
  "#f2555a",
  "#f2b155",
  "#6c7cff",
  "#6b7885",
] as const;

/**
 * The same ancient revision the board's seeded columns carry, so a fresh
 * install can never win a last-write-wins race against profiles customized on
 * another device (see `board::SEED_TIME`).
 */
export const PRIORITY_SEED_TIME = "1970-01-01T00:00:01Z";

export const DEFAULT_PROFILES: PriorityProfile[] = PRIORITY_VALUES.map(
  (priority) => ({
    priority,
    name: `Priority ${priority}`,
    color: DEFAULT_PRIORITY_COLORS[priority - 1],
    sound: null,
    volume: null,
    ramp: null,
    notificationStyle: null,
    repeatMinutes: null,
    updatedAt: PRIORITY_SEED_TIME,
  }),
);

export function defaultProfile(priority: number): PriorityProfile {
  return DEFAULT_PROFILES[clampPriority(priority) - 1];
}

/**
 * Tasks written by an older client — or a corrupt row — can carry a priority
 * outside 1–4. Treat anything unrecognized as "no priority" rather than
 * rendering an undefined color.
 */
export function clampPriority(priority: number): PriorityValue {
  return PRIORITY_VALUES.includes(priority as PriorityValue)
    ? (priority as PriorityValue)
    : 4;
}

/** The profile for a priority, falling back to the built-in one. */
export function profileFor(
  priority: number,
  profiles: PriorityProfile[] = DEFAULT_PROFILES,
): PriorityProfile {
  const value = clampPriority(priority);
  return (
    profiles.find((profile) => profile.priority === value) ??
    defaultProfile(value)
  );
}

export function priorityColor(
  priority: number,
  profiles?: PriorityProfile[],
): string {
  return profileFor(priority, profiles).color;
}

/** The full name, for pickers and filter menus: "Priority 1" or "Urgent". */
export function priorityName(
  priority: number,
  profiles?: PriorityProfile[],
): string {
  return profileFor(priority, profiles).name;
}

/** Has the user made this priority their own? Drives the chip rules below. */
export function isCustomized(profile: PriorityProfile): boolean {
  const base = defaultProfile(profile.priority);
  return (
    profile.name !== base.name ||
    profile.color.toLowerCase() !== base.color.toLowerCase()
  );
}

/** How long a renamed priority may be before a task row truncates it. */
const TAG_LIMIT = 14;

/**
 * The compact form for a task row, card or parsed chip: `P1` while the
 * priority is still called "Priority 1", otherwise the name the user gave it.
 */
export function priorityTag(
  priority: number,
  profiles?: PriorityProfile[],
): string {
  const profile = profileFor(priority, profiles);
  if (profile.name === defaultProfile(profile.priority).name) {
    return `P${profile.priority}`;
  }
  return profile.name.length > TAG_LIMIT
    ? `${profile.name.slice(0, TAG_LIMIT - 1).trimEnd()}…`
    : profile.name;
}

/**
 * Whether a task row should show its priority at all. P4 means "no priority",
 * so it stays silent — unless the user has named or recolored it, which says
 * they want to see it.
 */
export function showsPriority(
  priority: number,
  profiles?: PriorityProfile[],
): boolean {
  const profile = profileFor(priority, profiles);
  return profile.priority < 4 || isCustomized(profile);
}
