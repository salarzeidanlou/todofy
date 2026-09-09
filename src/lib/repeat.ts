import type { RepeatRule } from "../types";

/**
 * Selectable recurrence options, in menu order. `null` = does not repeat.
 * Labels are kept short for the date picker's chip row.
 */
export const REPEAT_OPTIONS: { value: RepeatRule | null; label: string }[] = [
  { value: null, label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const LABELS: Record<RepeatRule, string> = {
  daily: "Daily",
  weekdays: "Every weekday",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** Human label for a recurrence rule (short form for chips). */
export function repeatLabel(rule: RepeatRule | null | undefined): string {
  return rule ? LABELS[rule] : "Does not repeat";
}
