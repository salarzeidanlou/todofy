import { useEffect } from "preact/hooks";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { activeCount, useStore } from "./store";
import { useAuth } from "./lib/auth";
import { initSync } from "./lib/sync";
import { applyTheme } from "./lib/theme";
import { useKeyboard } from "./lib/useKeyboard";
import type { ActiveReminder } from "./types";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { DayRail, Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { ReminderToasts } from "./components/ReminderToasts";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FocusWidget } from "./components/FocusWidget";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { Celebration } from "./components/Celebration";

export function App() {
  const load = useStore((s) => s.load);
  const loadTimers = useStore((s) => s.loadTimers);
  const refreshPomodoro = useStore((s) => s.refreshPomodoro);
  const onTimersChanged = useStore((s) => s.onTimersChanged);
  const pushReminder = useStore((s) => s.pushReminder);
  const theme = useStore((s) => s.theme);
  const tasks = useStore((s) => s.tasks);
  const setView = useStore((s) => s.setView);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  const menuActions = (): MenuItem[] => [
    {
      label: "New task",
      onClick: () => {
        setView({ kind: "today" });
        requestAnimationFrame(() =>
          document.getElementById("quick-add-input")?.focus(),
        );
      },
    },
    {
      label: "New journal",
      onClick: () => {
        setView({ kind: "journal" });
        requestAnimationFrame(() =>
          document.getElementById("journal-add-input")?.focus(),
        );
      },
    },
    { label: "Settings", onClick: () => setView({ kind: "settings" }) },
    {
      label: theme === "dark" ? "Light theme" : "Dark theme",
      onClick: toggleTheme,
    },
  ];

  useKeyboard();

  useEffect(() => {
    load();
    loadTimers();
    // Restore any saved Supabase session and watch for auth changes.
    useAuth.getState().init();
    // Wire account sync (runs on sign-in, then periodically + after edits).
    initSync();
    // Ask for desktop notification permission once, up front.
    (async () => {
      if (!(await isPermissionGranted())) {
        await requestPermission();
      }
    })();

    // Surface an in-app toast when the backend scheduler fires a reminder.
    const unlisten = listen<ActiveReminder>("reminder-fired", (e) => {
      pushReminder(e.payload);
    });
    // The custom notification popup was clicked — jump to that task.
    const unOpen = listen<string>("reminder-open", (e) => {
      useStore.getState().select(e.payload);
    });
    // Refresh when a task is added from the quick-add window.
    const unAdded = listen("todo-added", () => load());
    // The scheduler advanced the Pomodoro (e.g. a phase finished) — re-sync.
    const unPomo = listen("pomodoro-updated", () => refreshPomodoro());
    // A timer was started/stopped from the tray menu — re-sync all timer state.
    const unTimers = listen("timers-changed", () => onTimersChanged());
    return () => {
      unlisten.then((off) => off());
      unOpen.then((off) => off());
      unAdded.then((off) => off());
      unPomo.then((off) => off());
      unTimers.then((off) => off());
    };
  }, []);

  // Reflect the current theme on the document.
  useEffect(() => applyTheme(theme), [theme]);

  // Show the count of tasks due today in the window title.
  useEffect(() => {
    const due = activeCount(tasks, { kind: "today" });
    document.title = due > 0 ? `todofy (${due})` : "todofy";
  }, [tasks]);

  return (
    <div class="app-shell">
      <Sidebar />
      <div class="app-workspace">
        <DayRail />
        {!sidebarCollapsed && (
          <button
            type="button"
            class="day-rail-backdrop"
            onClick={toggleSidebar}
            aria-label="Close calendar navigation"
          />
        )}
        <TaskList />
      </div>
      <FocusWidget />
      <ReminderToasts />
      <ConfirmDialog />
      <ShortcutsOverlay />
      <Celebration />
      <ContextMenu appItems={menuActions} />
    </div>
  );
}

export default App;
