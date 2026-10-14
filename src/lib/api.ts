import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveTimer,
  BoardColumnDefinition,
  BoardColumnInput,
  Event,
  EventPatch,
  JournalEntry,
  JournalPatch,
  Label,
  NewEvent,
  NewJournalEntry,
  NewTask,
  Pomodoro,
  SessionLog,
  Task,
  TaskPatch,
} from "../types";

export const api = {
  listBoardColumns: () => invoke<BoardColumnDefinition[]>("list_board_columns"),
  createBoardColumn: (input: BoardColumnInput) => invoke<BoardColumnDefinition[]>("create_board_column", { input }),
  updateBoardColumn: (id: string, input: BoardColumnInput) => invoke<BoardColumnDefinition[]>("update_board_column", { id, input }),
  reorderBoardColumns: (ids: string[]) => invoke<BoardColumnDefinition[]>("reorder_board_columns", { ids }),
  deleteBoardColumn: (id: string, replacementId: string) => invoke<BoardColumnDefinition[]>("delete_board_column", { id, replacementId }),
  listTasks: () => invoke<Task[]>("list_tasks"),
  createTask: (task: NewTask) => invoke<Task>("create_task", { task }),
  updateTask: (patch: TaskPatch) => invoke<Task>("update_task", { patch }),
  // Both resolve to every task the move repositioned — just the dropped one,
  // unless the fractional indices had to be renumbered (see `reorder_task`).
  reorderTask: (id: string, orderIndex: number) =>
    invoke<Task[]>("reorder_task", { id, orderIndex }),
  moveTaskToStage: (id: string, stage: string | null, boardIndex: number) =>
    invoke<Task[]>("move_task_to_stage", { id, stage, boardIndex }),
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

  listEvents: () => invoke<Event[]>("list_events"),
  createEvent: (event: NewEvent) => invoke<Event>("create_event", { event }),
  updateEvent: (patch: EventPatch) => invoke<Event>("update_event", { patch }),
  deleteEvent: (id: string) => invoke<void>("delete_event", { id }),

  systemLocale: () => invoke<string | null>("system_locale"),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) =>
    invoke<void>("set_autostart", { enabled }),
  // Fires a test notification through the same portal path reminders use.
  // Resolves to the delivery route ("portal" or "fallback").
  sendTestNotification: () => invoke<string>("send_test_notification"),

  // Stops a reminder repeating (see settings::reminder_repeat_minutes).
  acknowledgeReminder: (id: string) =>
    invoke<void>("acknowledge_reminder", { id }),

  // Per-task stopwatch
  startTimer: (id: string) => invoke<ActiveTimer | null>("start_timer", { id }),
  pauseTimer: () => invoke<ActiveTimer | null>("pause_timer"),
  resumeTimer: () => invoke<ActiveTimer | null>("resume_timer"),
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
