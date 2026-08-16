import type { RepeatRule } from "../types";

/** Selectable recurrence options, in menu order. `null` = does not repeat. */
export const REPEAT_OPTIONS: { value: RepeatRule | null; label: string }[] = [
  { value: null, label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Every weekday" },
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
