import type { SessionLog, Task } from "../types";
import { toLocalDate } from "./dates";

export interface DaySummary {
  completed: number;
  focusMinutes: number;
}

/** What the user got done on `date` — a low-friction writing prompt. */
export function daySummary(
  tasks: Task[],
  sessions: SessionLog[],
  date: string,
): DaySummary {
  const completed = tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completedAt &&
      toLocalDate(new Date(t.completedAt)) === date,
  ).length;
  const focusSeconds = sessions
    .filter((s) => toLocalDate(new Date(s.startAt)) === date)
    .reduce((sum, s) => sum + s.seconds, 0);
  return { completed, focusMinutes: Math.round(focusSeconds / 60) };
}

export function summaryText({ completed, focusMinutes }: DaySummary): string {
  const parts: string[] = [];
  if (completed > 0)
    parts.push(`${completed} task${completed === 1 ? "" : "s"} completed`);
  if (focusMinutes > 0) parts.push(`${focusMinutes}m focused`);
  return parts.join(" · ");
}
