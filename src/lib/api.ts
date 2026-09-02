import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveTimer,
  JournalEntry,
  JournalPatch,
  Label,
  NewJournalEntry,
  NewTask,
  Pomodoro,
  SessionLog,
  Task,
  TaskPatch,
} from "../types";

export const api = {
  listTasks: () => invoke<Task[]>("list_tasks"),
  createTask: (task: NewTask) => invoke<Task>("create_task", { task }),
  updateTask: (patch: TaskPatch) => invoke<Task>("update_task", { patch }),
  reorderTask: (id: string, orderIndex: number) =>
    invoke<Task>("reorder_task", { id, orderIndex }),
  toggleTask: (id: string, done: boolean) =>
    invoke<Task>("toggle_task", { id, done }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),

  listLabels: () => invoke<Label[]>("list_labels"),
  createLabel: (name: string, color: string) =>
    invoke<Label>("create_label", { name, color }),
  updateLabel: (id: string, name: string, color: string) =>
    invoke<Label>("update_label", { id, name, color }),
  deleteLabel: (id: string) => invoke<void>("delete_label", { id }),

  listJournal: () => invoke<JournalEntry[]>("list_journal"),
  createJournal: (entry: NewJournalEntry) =>
    invoke<JournalEntry>("create_journal", { entry }),
  updateJournal: (patch: JournalPatch) =>
    invoke<JournalEntry>("update_journal", { patch }),
  deleteJournal: (id: string) => invoke<void>("delete_journal", { id }),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) =>
    invoke<void>("set_autostart", { enabled }),
  // Fires a test notification through the same portal path reminders use.
  // Resolves to the delivery route ("portal" or "fallback").
  sendTestNotification: () => invoke<string>("send_test_notification"),

  // Per-task stopwatch
  startTimer: (id: string) => invoke<ActiveTimer | null>("start_timer", { id }),
  stopTimer: () => invoke<void>("stop_timer"),
  activeTimer: () => invoke<ActiveTimer | null>("active_timer"),
  focusHistory: (limit = 200) =>
    invoke<SessionLog[]>("focus_history", { limit }),

  // Standalone Pomodoro
  getPomodoro: () => invoke<Pomodoro>("get_pomodoro"),
  pomodoroStart: () => invoke<Pomodoro>("pomodoro_start"),
  pomodoroPause: () => invoke<Pomodoro>("pomodoro_pause"),
  pomodoroReset: () => invoke<Pomodoro>("pomodoro_reset"),
  pomodoroNext: () => invoke<Pomodoro>("pomodoro_next"),
  setPomodoroConfig: (
    focusMin: number,
    shortMin: number,
    longMin: number,
    longEvery: number,
  ) =>
    invoke<Pomodoro>("set_pomodoro_config", {
      focusMin,
      shortMin,
      longMin,
      longEvery,
    }),
};
