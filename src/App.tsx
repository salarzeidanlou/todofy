import { useEffect } from "preact/hooks";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { activeCount, useStore } from "./store";
import { applyTheme } from "./lib/theme";
import { useKeyboard } from "./lib/useKeyboard";
import type { ActiveReminder } from "./types";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { TaskDetail } from "./components/TaskDetail";
import { ReminderToasts } from "./components/ReminderToasts";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ChevronLeftIcon, ChevronRightIcon } from "./components/Icons";

export function App() {
  const load = useStore((s) => s.load);
  const pushReminder = useStore((s) => s.pushReminder);
  const theme = useStore((s) => s.theme);
  const tasks = useStore((s) => s.tasks);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  useKeyboard();

  useEffect(() => {
    load();
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
    // Refresh when a task is added from the quick-add window.
    const unAdded = listen("todo-added", () => load());
    return () => {
      unlisten.then((off) => off());
      unAdded.then((off) => off());
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
    <div class="relative flex h-full w-full overflow-hidden">
      <Sidebar />

      {/* Collapse / expand toggle, sitting on the sidebar↔main seam */}
      <button
        onClick={toggleSidebar}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{ left: `${(collapsed ? 56 : 256) - 11}px` }}
        class="absolute top-4 z-30 grid h-[22px] w-[22px] place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-elevated)] text-[var(--color-muted)] shadow-md shadow-black/20 transition-colors hover:text-[var(--color-text)]"
      >
        {collapsed ? (
          <ChevronRightIcon width={14} height={14} />
        ) : (
          <ChevronLeftIcon width={14} height={14} />
        )}
      </button>

      <TaskList />
      <TaskDetail />
      <ReminderToasts />
      <ConfirmDialog />
    </div>
  );
}

export default App;
