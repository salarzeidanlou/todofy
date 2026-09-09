import type { ActiveTimer, Task } from "../types";
import { secondsSince } from "./duration";

export type TrackingState = "off" | "running" | "paused";

export function trackingState(
  taskId: string,
  timer: ActiveTimer | null,
): TrackingState {
  if (!timer || timer.taskId !== taskId) return "off";
  return timer.resumedAt ? "running" : "paused";
}

/** The banked total plus any running segment. */
export function timerElapsed(timer: ActiveTimer): number {
  return timer.accumulated + (timer.resumedAt ? secondsSince(timer.resumedAt) : 0);
}

/** Seconds past the task's estimate, or 0 while still inside it. */
export function overEstimateBy(task: Task, elapsed: number): number {
  if (!task.estimateMinutes || task.estimateMinutes <= 0) return 0;
  return Math.max(0, elapsed - task.estimateMinutes * 60);
}

/**
 * Seconds tracked on a task, including the session still open.
 *
 * `task.trackedSeconds` sums only ended sessions, so on its own it sits frozen
 * while a timer runs. Pair with `useTick` to keep the readout moving.
 */
export function trackedElapsed(
  task: Task,
  activeTimer: ActiveTimer | null,
): number {
  const open =
    activeTimer && activeTimer.taskId === task.id ? timerElapsed(activeTimer) : 0;
  return task.trackedSeconds + open;
}
