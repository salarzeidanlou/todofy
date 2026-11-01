import { useEffect, useState } from "preact/hooks";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { activeCount, useStore } from "./store";
import { api } from "./lib/api";
import {
  customKeysFor,
  parseSoundSettings,
  playReminderSound,
  resolveSoundSettings,
  SOUND_KEYS,
} from "./lib/sound";
import { useAuth } from "./lib/auth";
import { initSync } from "./lib/sync";
import { initCalendar } from "./lib/googleCalendar";
import { initBilling } from "./lib/billing";
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
import { UpdateDialog } from "./components/UpdateDialog";
import { Celebration } from "./components/Celebration";
import { SyncAccountDialog } from "./components/SyncAccountDialog";
import { ProPaywall } from "./components/ProPaywall";
import { AuthDialog } from "./components/AuthDialog";
import { Onboarding } from "./components/onboarding/Onboarding";
import { initOnboarding } from "./lib/onboarding";
import { initUpdater } from "./lib/updater";

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
  // Subscribed for the side effect: the resolved locale values live outside
  // the store, so this is what repaints the tree when they change.
  useStore((s) => s.localeVersion);

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
    // The first-run tour needs to know whether this install already holds
    // data, so it waits for the first load to land.
    load().then(initOnboarding);
    loadTimers();
    // Restore any saved Supabase session and watch for auth changes.
    useAuth.getState().init();
    // Load authoritative Cloud Sync access before the sync scheduler starts.
    initBilling();
    // Wire account sync (runs on sign-in, then periodically + after edits).
    initSync();
    // Wire Google Calendar push (pushes dated tasks while connected).
    initCalendar();
    // Look for a new version in the background, a while after startup.
    initUpdater();
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
    // An update notice was clicked — open the controls that act on it.
    const unUpdate = listen("update-open", () => {
      setView({ kind: "settings" });
    });
    // Played here rather than in the popup window, which may never have had
    // the user gesture audio playback requires. The payload carries the round,
    // for the volume ramp, and the priority whose profile picked the sound.
    const unSound = listen<{ round: number; priority: number }>(
      "reminder-sound",
      async (e) => {
        const perPriority = customKeysFor(e.payload.priority);
        const [sound, volume, ramp, data, profileData] = await Promise.all([
          api.getSetting(SOUND_KEYS.sound),
          api.getSetting(SOUND_KEYS.volume),
          api.getSetting(SOUND_KEYS.ramp),
          api.getSetting(SOUND_KEYS.data),
          api.getSetting(perPriority.data),
        ]).catch(() => [null, null, null, null, null]);
        const profile = useStore
          .getState()
          .priorityProfiles.find((p) => p.priority === e.payload.priority);
        playReminderSound(
          resolveSoundSettings(
            profile ?? null,
            parseSoundSettings({ sound, volume, ramp, data }),
            profileData,
          ),
          e.payload.round,
        );
      },
    );
    // Refresh when a task is added from the quick-add window.
    const unAdded = listen("todo-added", () => load());
    // A task was changed from another window (e.g. snoozed from the
    // notification popup) — pull the new state in.
    const unChanged = listen("tasks-changed", () => load());
    // The scheduler advanced the Pomodoro (e.g. a phase finished) — re-sync.
    const unPomo = listen("pomodoro-updated", () => refreshPomodoro());
    // A timer was started/stopped from the tray menu — re-sync all timer state.
    const unTimers = listen("timers-changed", () => onTimersChanged());
    return () => {
      unlisten.then((off) => off());
      unOpen.then((off) => off());
      unUpdate.then((off) => off());
      unSound.then((off) => off());
      unAdded.then((off) => off());
      unChanged.then((off) => off());
      unPomo.then((off) => off());
      unTimers.then((off) => off());
    };
  }, []);

  // Due dates are read from the clock at render time, so without a tick a
  // task never turns overdue on screen and an app left open overnight keeps
  // yesterday's "Today".
  const [, setMinute] = useState(0);
  useEffect(() => {
    let interval: number | undefined;
    const tick = () => setMinute((n) => n + 1);
    const timeout = window.setTimeout(
      () => {
        tick();
        interval = window.setInterval(tick, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
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
      <SyncAccountDialog />
      <ProPaywall />
      <AuthDialog />
      <ShortcutsOverlay />
      <UpdateDialog />
      <Celebration />
      <Onboarding />
      <ContextMenu appItems={menuActions} />
    </div>
  );
}

export default App;
