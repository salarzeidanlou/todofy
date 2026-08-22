import type { Task } from "../types";
import { today, toLocalDate } from "./dates";

/**
 * Completion stats for the little progress/streak indicator.
 *
 * - `doneToday`: tasks completed today.
 * - `streak`: consecutive days (ending today, or yesterday if nothing's done
 *   yet today) on which at least one task was completed. Keeping the streak
 *   alive through "today so far empty" avoids punishing the user first thing in
 *   the morning.
 */
export function completionStats(tasks: Task[]): {
  doneToday: number;
  streak: number;
} {
  const t = today();
  const days = new Set<string>();
  let doneToday = 0;

  for (const task of tasks) {
    if (task.status === "done" && task.completedAt) {
      const d = toLocalDate(new Date(task.completedAt));
      days.add(d);
      if (d === t) doneToday++;
    }
  }

  const has = (d: Date) => days.has(toLocalDate(d));
  const cursor = new Date(t + "T00:00:00");
  // If nothing's completed today yet, count the streak up to yesterday.
  if (!has(cursor)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (has(cursor)) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { doneToday, streak };
}
