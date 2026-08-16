export interface Label {
  id: number;
  name: string;
  color: string;
}

/** How a task repeats. Completing it rolls the due date to the next occurrence. */
export type RepeatRule = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  dueDate: string | null; // YYYY-MM-DD
  remindAt: string | null; // ISO datetime
  status: "active" | "done";
  priority: 1 | 2 | 3 | 4;
  createdAt: string;
  completedAt: string | null;
  orderIndex: number;
  pinned: boolean;
  repeat: RepeatRule | null;
  trackedSeconds: number;
  labelIds: number[];
}

/** The currently running per-task stopwatch. */
export interface ActiveTimer {
  taskId: number;
  title: string;
  startAt: string; // ISO
}

/** A completed focus session, for the history view. */
export interface SessionLog {
  id: number;
  taskId: number;
  title: string;
  startAt: string;
  endAt: string;
  seconds: number;
}

export type PomodoroPhase = "focus" | "short" | "long";

/** Standalone Pomodoro timer state (mirrors the backend row). */
export interface Pomodoro {
  phase: PomodoroPhase;
  running: boolean;
  startAt: string | null; // ISO; set while running
  accumulated: number; // seconds elapsed before the running segment
  completedFocus: number;
  target: number; // seconds the current phase should last
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
}

export interface NewTask {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  priority?: number;
  labelIds?: number[];
  repeat?: RepeatRule | null;
}

export interface TaskPatch {
  id: number;
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  priority?: number;
  labelIds?: number[];
  pinned?: boolean;
  repeat?: RepeatRule | null;
}

/** A reminder that has fired, shown as an in-app toast. */
export interface ActiveReminder {
  id: number;
  title: string;
}

/** Built-in smart views plus dynamic label views. */
export type ViewId =
  | { kind: "inbox" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "pinned" }
  | { kind: "completed" }
  | { kind: "labels" }
  | { kind: "settings" }
  | { kind: "focus" }
  | { kind: "label"; labelId: number };
