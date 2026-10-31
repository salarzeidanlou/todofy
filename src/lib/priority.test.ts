import { expect, test } from "bun:test";
import {
  DEFAULT_PROFILES,
  clampPriority,
  hasOverrides,
  isCustomized,
  priorityColor,
  priorityTag,
  profileFor,
  showsPriority,
  type PriorityProfile,
} from "./priority";
import { resolveSoundSettings, type SoundSettings } from "./sound";

const GLOBAL: SoundSettings = {
  sound: "chime",
  volume: 70,
  ramp: false,
  customData: null,
};

function profile(overrides: Partial<PriorityProfile> = {}): PriorityProfile {
  return { ...DEFAULT_PROFILES[0], ...overrides };
}

test("an untouched profile resolves to the global sound settings", () => {
  expect(resolveSoundSettings(profile(), GLOBAL, null)).toEqual(GLOBAL);
  expect(resolveSoundSettings(null, GLOBAL, null)).toEqual(GLOBAL);
});

test("each sound override is folded on its own", () => {
  expect(
    resolveSoundSettings(profile({ sound: "bell" }), GLOBAL, null),
  ).toEqual({ sound: "bell", volume: 70, ramp: false, customData: null });
  expect(resolveSoundSettings(profile({ volume: 20 }), GLOBAL, null)).toEqual({
    sound: "chime",
    volume: 20,
    ramp: false,
    customData: null,
  });
  expect(resolveSoundSettings(profile({ ramp: true }), GLOBAL, null)).toEqual({
    sound: "chime",
    volume: 70,
    ramp: true,
    customData: null,
  });
});

test("a volume of zero is a choice, not an absent override", () => {
  expect(resolveSoundSettings(profile({ volume: 0 }), GLOBAL, null).volume).toBe(
    0,
  );
  expect(
    resolveSoundSettings(profile({ ramp: false }), { ...GLOBAL, ramp: true }, null)
      .ramp,
  ).toBe(false);
});

test("a silent priority stays silent whatever the global sound is", () => {
  expect(resolveSoundSettings(profile({ sound: "none" }), GLOBAL, null).sound).toBe(
    "none",
  );
});

/**
 * A profile that chose a custom sound on another device arrives here with no
 * bytes to play — those never leave the device they were loaded on. Silence
 * would be indistinguishable from a reminder that never fired.
 */
test("a custom sound with no bytes on this device falls back to the global", () => {
  const resolved = resolveSoundSettings(
    profile({ sound: "custom", volume: 90 }),
    GLOBAL,
    null,
  );
  expect(resolved.sound).toBe("chime");
  expect(resolved.volume).toBe(90);
  expect(resolved.customData).toBe(null);
});

test("a custom sound plays this priority's own bytes when it has them", () => {
  const resolved = resolveSoundSettings(
    profile({ sound: "custom" }),
    GLOBAL,
    "AAAA",
  );
  expect(resolved.sound).toBe("custom");
  expect(resolved.customData).toBe("AAAA");
});

test("priority 4 shows nothing until it is named or recolored", () => {
  expect(showsPriority(4)).toBe(false);
  expect(showsPriority(1)).toBe(true);
  const named = profile({ priority: 4, name: "Someday" });
  expect(showsPriority(4, [named])).toBe(true);
  expect(isCustomized(named)).toBe(true);
  const recolored = profile({ priority: 4, name: "Priority 4", color: "#38bdf8" });
  expect(showsPriority(4, [recolored])).toBe(true);
});

test("the compact tag keeps P-numbers until a priority is renamed", () => {
  expect(priorityTag(2)).toBe("P2");
  expect(priorityTag(2, [profile({ priority: 2, name: "Urgent" })])).toBe(
    "Urgent",
  );
  expect(
    priorityTag(2, [profile({ priority: 2, name: "Needs doing this week" })]),
  ).toBe("Needs doing t…");
});

/** A task from an older client, or a corrupt row, must not paint undefined. */
test("a priority outside 1-4 resolves to no priority", () => {
  expect(clampPriority(0)).toBe(4);
  expect(clampPriority(7)).toBe(4);
  expect(profileFor(99).priority).toBe(4);
  expect(priorityColor(99)).toBe(DEFAULT_PROFILES[3].color);
});

/** The profiles list can be short or stale while a load is in flight. */
test("a missing profile falls back to the built-in one", () => {
  expect(profileFor(3, []).name).toBe("Priority 3");
  expect(priorityColor(3, [])).toBe(DEFAULT_PROFILES[2].color);
});

test("overrides are what mark a profile as having its own reminder", () => {
  expect(hasOverrides(profile())).toBe(false);
  expect(hasOverrides(profile({ name: "Urgent" }))).toBe(false);
  expect(hasOverrides(profile({ repeatMinutes: 0 }))).toBe(true);
  expect(hasOverrides(profile({ volume: 0 }))).toBe(true);
  expect(hasOverrides(profile({ ramp: false }))).toBe(true);
});
