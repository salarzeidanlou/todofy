import { create } from "zustand";
import { api } from "./lib/api";
import { snoozeFrom, toLocalDate, today } from "./lib/dates";
import { sectionsForView } from "./lib/grouping";
import { applyTheme, initialTheme, type Theme } from "./lib/theme";
import type {
  ActiveReminder,
  ActiveTimer,
  Label,
  NewTask,
  Pomodoro,
  Task,
  TaskPatch,
  ViewId,
} from "./types";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface State {
  tasks: Task[];
  labels: Label[];
  view: ViewId;
  selectedId: number | null;
  loading: boolean;
  reminders: ActiveReminder[];
  theme: Theme;
  confirm: ConfirmOptions | null;
  sidebarCollapsed: boolean;

  activeTimer: ActiveTimer | null;
  pomodoro: Pomodoro | null;
  showFocus: boolean;

  load: () => Promise<void>;
  setView: (view: ViewId) => void;
  select: (id: number | null) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  pushReminder: (r: ActiveReminder) => void;
  dismissReminder: (id: number) => void;
  requestConfirm: (opts: ConfirmOptions) => void;
  closeConfirm: () => void;

  addTask: (input: NewTask) => Promise<void>;
  patchTask: (patch: TaskPatch) => Promise<void>;
  reorderTask: (id: number, orderIndex: number) => Promise<void>;
  toggleTask: (id: number, done: boolean) => Promise<void>;
  snoozeTask: (id: number, minutes: number) => Promise<void>;
  removeTask: (id: number) => Promise<void>;

  addLabel: (name: string, color: string) => Promise<Label>;
  editLabel: (id: number, name: string, color: string) => Promise<void>;
  removeLabel: (id: number) => Promise<void>;

  loadTimers: () => Promise<void>;
  onTimersChanged: () => Promise<void>;
  toggleFocus: () => void;
  refreshPomodoro: () => Promise<void>;
  startTaskTimer: (id: number) => Promise<void>;
  stopTaskTimer: () => Promise<void>;
  pomodoroStart: () => Promise<void>;
  pomodoroPause: () => Promise<void>;
  pomodoroReset: () => Promise<void>;
  pomodoroNext: () => Promise<void>;
  setPomodoroConfig: (
    focusMin: number,
    shortMin: number,
    longMin: number,
    longEvery: number,
  ) => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  tasks: [],
  labels: [],
  view: { kind: "today" },
  selectedId: null,
  loading: true,
  reminders: [],
  theme: initialTheme(),
  confirm: null,
  sidebarCollapsed: localStorage.getItem("todofy-sidebar") === "collapsed",

  activeTimer: null,
  pomodoro: null,
  showFocus: false,

  load: async () => {
    set({ loading: true });
    const [tasks, labels] = await Promise.all([
      api.listTasks(),
      api.listLabels(),
    ]);
    set({ tasks: sortTasks(tasks), labels, loading: false });
  },

  setView: (view) => set({ view, selectedId: null }),
  select: (id) => set({ selectedId: id }),

  toggleTheme: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    set({ theme });
  },

  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    localStorage.setItem("todofy-sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    set({ sidebarCollapsed });
  },

  pushReminder: (r) =>
    set({
      // Avoid duplicate toasts for the same task.
      reminders: [...get().reminders.filter((x) => x.id !== r.id), r],
    }),
  dismissReminder: (id) =>
    set({ reminders: get().reminders.filter((r) => r.id !== id) }),

  requestConfirm: (opts) => set({ confirm: opts }),
  closeConfirm: () => set({ confirm: null }),

  addTask: async (input) => {
    const task = await api.createTask(input);
    set({ tasks: sortTasks([...get().tasks, task]) });
  },

  patchTask: async (patch) => {
    const updated = await api.updateTask(patch);
    set({
      tasks: get().tasks.map((t) => (t.id === updated.id ? updated : t)),
    });
  },

  reorderTask: async (id, orderIndex) => {
    // Optimistically apply the new position, then persist. Keeping the
    // array sorted mirrors the backend so grouping and keyboard nav agree.
    set({
      tasks: sortTasks(
        get().tasks.map((t) => (t.id === id ? { ...t, orderIndex } : t)),
      ),
    });
    try {
      await api.reorderTask(id, orderIndex);
    } catch {
      // Fall back to the source of truth if the write failed.
      await get().load();
    }
  },

  toggleTask: async (id, done) => {
    const updated = await api.toggleTask(id, done);
    set({
      tasks: get().tasks.map((t) => (t.id === updated.id ? updated : t)),
    });
  },

  // Push a task's reminder `minutes` into the future. The due date follows the
  // reminder so a snoozed task lands in the view that matches its new time —
  // shared by the reminder toast and the detail panel so both behave the same.
  snoozeTask: async (id, minutes) => {
    const iso = snoozeFrom(minutes);
    await get().patchTask({
      id,
      dueDate: toLocalDate(new Date(iso)),
      remindAt: iso,
    });
  },

  removeTask: async (id) => {
    await api.deleteTask(id);
    set({
      tasks: get().tasks.filter((t) => t.id !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
  },

  addLabel: async (name, color) => {
    const label = await api.createLabel(name, color);
    set({ labels: [...get().labels, label].sort((a, b) => a.name.localeCompare(b.name)) });
    return label;
  },

  editLabel: async (id, name, color) => {
    const updated = await api.updateLabel(id, name, color);
    set({
      labels: get()
        .labels.map((l) => (l.id === id ? updated : l))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  },

  removeLabel: async (id) => {
    await api.deleteLabel(id);
    const view = get().view;
    set({
      labels: get().labels.filter((l) => l.id !== id),
      tasks: get().tasks.map((t) => ({
        ...t,
        labelIds: t.labelIds.filter((lid) => lid !== id),
      })),
      view: view.kind === "label" && view.labelId === id ? { kind: "today" } : view,
    });
  },

  // --- Focus timers ---------------------------------------------------------

  loadTimers: async () => {
    const [activeTimer, pomodoro] = await Promise.all([
      api.activeTimer(),
      api.getPomodoro(),
    ]);
    // Surface the widget if something is already running (e.g. after restart).
    set({
      activeTimer,
      pomodoro,
      showFocus: get().showFocus || !!activeTimer || pomodoro.running,
    });
  },

  // A timer changed outside the UI (e.g. the tray menu) — re-sync everything.
  onTimersChanged: async () => {
    const [activeTimer, pomodoro, tasks] = await Promise.all([
      api.activeTimer(),
      api.getPomodoro(),
      api.listTasks(),
    ]);
    set({ activeTimer, pomodoro, tasks: sortTasks(tasks) });
  },

  toggleFocus: () => set({ showFocus: !get().showFocus }),

  refreshPomodoro: async () => set({ pomodoro: await api.getPomodoro() }),

  // Refresh tasks (without the loading skeleton) so tracked totals stay current
  // after a session closes.
  startTaskTimer: async (id) => {
    const activeTimer = await api.startTimer(id);
    set({ activeTimer, showFocus: true, tasks: sortTasks(await api.listTasks()) });
  },
  stopTaskTimer: async () => {
    await api.stopTimer();
    set({ activeTimer: null, tasks: sortTasks(await api.listTasks()) });
  },

  pomodoroStart: async () => set({ pomodoro: await api.pomodoroStart(), showFocus: true }),
  pomodoroPause: async () => set({ pomodoro: await api.pomodoroPause() }),
  pomodoroReset: async () => set({ pomodoro: await api.pomodoroReset() }),
  pomodoroNext: async () => set({ pomodoro: await api.pomodoroNext() }),
  setPomodoroConfig: async (focusMin, shortMin, longMin, longEvery) =>
    set({ pomodoro: await api.setPomodoroConfig(focusMin, shortMin, longMin, longEvery) }),
}));

/**
 * Keep the task array in the same order the backend returns: active before
 * done, then by manual `orderIndex`, then by creation time. Grouping and
 * keyboard navigation both read this order, so it must match `list_tasks`.
 */
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      a.orderIndex - b.orderIndex ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** Filter tasks for the active view. */
export function tasksForView(tasks: Task[], view: ViewId): Task[] {
  const t = today();
  switch (view.kind) {
    case "inbox":
      return tasks.filter((x) => !x.dueDate);
    case "today":
      return tasks.filter((x) =>
        x.status === "done"
          ? !!x.completedAt && toLocalDate(new Date(x.completedAt)) === t
          : x.dueDate && x.dueDate <= t,
      );
    case "upcoming":
      return tasks.filter((x) => x.dueDate && x.dueDate > t);
    case "pinned":
      return tasks.filter((x) => x.pinned);
    case "completed":
      return tasks.filter((x) => x.status === "done");
    case "labels":
    case "settings":
    case "focus":
      return [];
    case "label":
      return tasks.filter((x) => x.labelIds.includes(view.labelId));
  }
}

/** Count of active (not done) tasks per view, for sidebar badges. */
export function activeCount(tasks: Task[], view: ViewId): number {
  return tasksForView(tasks, view).filter((t) => t.status === "active").length;
}

/**
 * Badge count for sidebar nav items. Completed and Pinboard aren't about
 * "active" tasks, so they get a plain total instead.
 */
export function navCount(tasks: Task[], view: ViewId): number {
  if (view.kind === "completed" || view.kind === "pinned") {
    return tasksForView(tasks, view).length;
  }
  if (view.kind === "labels") return 0;
  return activeCount(tasks, view);
}

/** Task ids in on-screen order for the active view — drives keyboard nav. */
export function visibleTaskIds(tasks: Task[], view: ViewId): number[] {
  const inView = tasksForView(tasks, view);
  const relevant =
    view.kind === "completed" || view.kind === "pinned"
      ? inView
      : inView.filter((t) => t.status === "active");
  return sectionsForView(relevant, view)
    .filter((s) => s.tasks.length > 0)
    .flatMap((s) => s.tasks.map((t) => t.id));
}
