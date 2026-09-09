import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import {
  autoSummary,
  timeFormat,
  weekStartSetting,
  type TimeFormatPref,
  type WeekStartPref,
} from "../lib/locale";
import {
  DEFAULT_VOLUME,
  MAX_CUSTOM_BYTES,
  parseSoundSettings,
  playReminderSound,
  SOUNDS,
  SOUND_KEYS,
  type SoundId,
} from "../lib/sound";
import {
  addQuickTime,
  DEFAULT_QUICK_TIMES,
  MAX_QUICK_TIMES,
  parseQuickTimes,
  QUICK_TIMES_KEY,
  serializeQuickTimes,
} from "../lib/quickTimes";
import { formatTime } from "../lib/dates";
import { TimeField } from "./TimeField";
import { useStore } from "../store";
import type { TaskTimerMode } from "../types";
import { AccountSection } from "./AccountSection";
import { CalendarSection } from "./CalendarSection";
import {
  BellIcon,
  BoltIcon,
  CheckCircleIcon,
  CloseIcon,
  ExternalLinkIcon,
  GitHubIcon,
  MoonIcon,
  PowerIcon,
  SunIcon,
  WebsiteIcon,
} from "./Icons";

const WEBSITE_URL = "https://unifybrowse.com/";
const GITHUB_URL = "https://github.com/salarzeidanlou/todofy";

const openExternal = (url: string) => {
  openUrl(url).catch(() => {});
};

type StartupMode = "window" | "tray";
type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNERS: { value: Corner; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

const TIME_FORMATS: { value: TimeFormatPref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "12", label: "12-hour" },
  { value: "24", label: "24-hour" },
];

const WEEK_STARTS: { value: WeekStartPref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1", label: "Monday" },
  { value: "0", label: "Sunday" },
  { value: "6", label: "Saturday" },
];

/** How often an unanswered reminder repeats. "0" is the default: it doesn't. */
const REPEAT_INTERVALS: { value: string; label: string }[] = [
  { value: "0", label: "Once" },
  { value: "2", label: "2 min" },
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
];

const TIMER_MODES: { value: TaskTimerMode; label: string; hint: string }[] = [
  {
    value: "tracker",
    label: "Stopwatch",
    hint: "Times how long the task actually takes.",
  },
  {
    value: "pomodoro",
    label: "Pomodoro",
    hint: "Also runs a focus countdown for that task.",
  },
];

// How the backend routed the test notification (see notify::deliver).
const ROUTE_LABEL: Record<string, string> = {
  popup: "the in-app popup",
  portal: "the desktop portal",
  fallback: "the fallback (classic) path",
};

export function SettingsView() {
  const {
    theme,
    toggleTheme,
    celebrate,
    toggleCelebrate,
    toggleShortcuts,
    setTimeFormat,
    setWeekStart,
    taskTimerMode,
    setTaskTimerMode,
  } = useStore();
  // Read back from the locale module, which the store actions keep in step.
  const timeFormatPref = timeFormat();
  const weekStartPref = weekStartSetting();
  const [autostart, setAutostart] = useState(false);
  const [mode, setMode] = useState<StartupMode>("window");
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [notifStyle, setNotifStyle] = useState<"custom" | "native">("custom");
  const [notifPosition, setNotifPosition] = useState<Corner>("bottom-right");
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState("0");
  const [sound, setSound] = useState<SoundId>("chime");
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [ramp, setRamp] = useState(false);
  const [customName, setCustomName] = useState("");
  const [soundError, setSoundError] = useState("");
  const [quickTimes, setQuickTimesState] = useState(DEFAULT_QUICK_TIMES);
  const [newQuickTime, setNewQuickTime] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [testRoute, setTestRoute] = useState("");

  // Load current startup preferences from the backend.
  useEffect(() => {
    (async () => {
      const [
        enabled,
        storedMode,
        storedNotifications,
        style,
        position,
        repeat,
        storedSound,
        storedVolume,
        storedRamp,
        storedName,
        storedQuickTimes,
      ] = await Promise.all([
        api.getAutostart().catch(() => false),
        api.getSetting("startup_mode").catch(() => null),
        api.getSetting("desktop_notifications_enabled").catch(() => null),
        api.getSetting("notification_style").catch(() => null),
        api.getSetting("notification_position").catch(() => null),
        api.getSetting("reminder_repeat_minutes").catch(() => null),
        api.getSetting(SOUND_KEYS.sound).catch(() => null),
        api.getSetting(SOUND_KEYS.volume).catch(() => null),
        api.getSetting(SOUND_KEYS.ramp).catch(() => null),
        api.getSetting(SOUND_KEYS.name).catch(() => null),
        api.getSetting(QUICK_TIMES_KEY).catch(() => null),
      ]);
      setQuickTimesState(parseQuickTimes(storedQuickTimes));
      setAutostart(enabled);
      if (storedMode === "tray" || storedMode === "window") setMode(storedMode);
      setDesktopNotifications(storedNotifications !== "false");
      setNotifStyle(style === "native" ? "native" : "custom");
      if (CORNERS.some((c) => c.value === position))
        setNotifPosition(position as Corner);
      if (REPEAT_INTERVALS.some((option) => option.value === repeat))
        setRepeatEvery(repeat as string);
      const parsed = parseSoundSettings({
        sound: storedSound,
        volume: storedVolume,
        ramp: storedRamp,
      });
      setSound(parsed.sound);
      setVolume(parsed.volume);
      setRamp(parsed.ramp);
      setCustomName(storedName ?? "");
      setReady(true);
    })();
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const toggleAutostart = async () => {
    const next = !autostart;
    setAutostart(next); // optimistic
    try {
      await api.setAutostart(next);
    } catch {
      setAutostart(!next); // revert on failure
    }
  };

  const chooseMode = async (next: StartupMode) => {
    setMode(next);
    try {
      await api.setSetting("startup_mode", next);
    } catch {
      /* best-effort; the current selection stays shown */
    }
  };

  const toggleDesktopNotifications = async () => {
    const next = !desktopNotifications;
    setDesktopNotifications(next); // optimistic
    try {
      await api.setSetting(
        "desktop_notifications_enabled",
        next ? "true" : "false",
      );
    } catch {
      setDesktopNotifications(!next); // revert on failure
    }
  };

  const chooseStyle = async (next: "custom" | "native") => {
    const prev = notifStyle;
    setNotifStyle(next); // optimistic
    try {
      await api.setSetting("notification_style", next);
    } catch {
      setNotifStyle(prev);
    }
  };

  const choosePosition = async (next: Corner) => {
    const prev = notifPosition;
    setNotifPosition(next); // optimistic
    try {
      await api.setSetting("notification_position", next);
    } catch {
      setNotifPosition(prev);
    }
  };

  const chooseRepeat = async (next: string) => {
    const prev = repeatEvery;
    setRepeatEvery(next); // optimistic
    try {
      await api.setSetting("reminder_repeat_minutes", next);
    } catch {
      setRepeatEvery(prev);
    }
  };

  const chooseSound = async (next: SoundId) => {
    setSoundError("");
    // Picking "Custom…" with nothing loaded means "go find one".
    if (next === "custom" && !customName) return pickCustomSound();
    setSound(next);
    await api.setSetting(SOUND_KEYS.sound, next).catch(() => {});
    void previewSound(next, volume);
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    void api.setSetting(SOUND_KEYS.volume, String(next)).catch(() => {});
  };

  const toggleRamp = async () => {
    const next = !ramp;
    setRamp(next);
    await api.setSetting(SOUND_KEYS.ramp, String(next)).catch(() => {});
  };

  /**
   * Keeps the bytes rather than the path, so the sound survives the original
   * file being moved or deleted.
   */
  const pickCustomSound = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_CUSTOM_BYTES) {
        setSoundError(
          `That file is ${Math.round(file.size / 1024)} KB — the limit is ${MAX_CUSTOM_BYTES / 1024} KB.`,
        );
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const data = btoa(binary);
        await Promise.all([
          api.setSetting(SOUND_KEYS.data, data),
          api.setSetting(SOUND_KEYS.name, file.name),
          api.setSetting(SOUND_KEYS.sound, "custom"),
        ]);
        setSound("custom");
        setCustomName(file.name);
        setSoundError("");
        void playReminderSound({ sound: "custom", volume, ramp: false, customData: data });
      } catch {
        setSoundError("That file couldn't be read.");
      }
    };
    input.click();
  };

  /** The ramp belongs to repeats, so a preview plays at the set volume. */
  const previewSound = async (id: SoundId, level: number) => {
    const data =
      id === "custom" ? await api.getSetting(SOUND_KEYS.data).catch(() => null) : null;
    void playReminderSound({ sound: id, volume: level, ramp: false, customData: data });
  };

  const saveQuickTimes = (next: string[]) => {
    setQuickTimesState(next);
    void api.setSetting(QUICK_TIMES_KEY, serializeQuickTimes(next)).catch(() => {});
  };

  const removeQuickTime = (time: string) =>
    saveQuickTimes(quickTimes.filter((t) => t !== time));

  const addNewQuickTime = () => {
    if (!newQuickTime) return;
    saveQuickTimes(addQuickTime(quickTimes, newQuickTime));
    setNewQuickTime(null);
  };

  const chooseTimeFormat = (next: TimeFormatPref) => {
    void setTimeFormat(next);
  };

  const chooseWeekStart = (next: WeekStartPref) => {
    void setWeekStart(next);
  };

  const sendTestNotification = async () => {
    setTestStatus("sending");
    try {
      // Goes through the same portal path reminders use; resolves to the
      // route that delivered it ("portal" or "fallback").
      const route = await api.sendTestNotification();
      setTestRoute(route);
      setTestStatus("sent");
    } catch {
      setTestStatus("error");
    } finally {
      setTimeout(() => setTestStatus("idle"), 5000);
    }
  };

  return (
    <main class="redesign-secondary settings-main flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="app-page-header shrink-0 px-8 pt-8 pb-4">
        <h2 class="text-2xl font-semibold tracking-tight">Settings</h2>
        <p class="mt-0.5 text-sm text-[var(--color-muted)]">
          Startup, appearance, and about
        </p>
      </header>

      <div class="secondary-scroll settings-content mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-8">
        <AccountSection />
        <CalendarSection />

        {/* Startup */}
        <Section title="Startup">
          <Row
            icon={<PowerIcon width={18} height={18} />}
            title="Run todofy on startup"
            desc="Launch automatically when you sign in to your computer."
          >
            <Switch
              checked={autostart}
              onChange={toggleAutostart}
              disabled={!ready}
            />
          </Row>

          {autostart && (
            <div class="animate-fade-rise border-t border-[var(--color-border)] px-4 py-3.5">
              <p class="mb-2.5 text-xs font-medium text-[var(--color-muted)]">
                When todofy starts at login
              </p>
              <div class="flex flex-col gap-2">
                <ModeOption
                  active={mode === "window"}
                  onSelect={() => chooseMode("window")}
                  title="Open the window"
                  desc="Start with the todofy window visible."
                />
                <ModeOption
                  active={mode === "tray"}
                  onSelect={() => chooseMode("tray")}
                  title="Start in the tray"
                  desc="Run quietly in the system tray — open it from the tray icon or Ctrl+Alt+A."
                />
              </div>
            </div>
          )}
        </Section>

        {/* Quick capture */}
        <Section title="Quick capture">
          <Row
            icon={<BoltIcon width={18} height={18} />}
            title="Global quick-add hotkey"
            desc="Press this from any app to pop up todofy's capture box — jot a task and it's saved to your inbox without switching windows."
          >
            <kbd class="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)]">
              Ctrl + Alt + A
            </kbd>
          </Row>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Row
            icon={<BellIcon width={18} height={18} />}
            title="Desktop notifications"
            desc="Show a native system notification when a reminder or timer is due, in addition to the in-app toast."
          >
            <Switch
              checked={desktopNotifications}
              onChange={toggleDesktopNotifications}
              disabled={!ready}
            />
          </Row>

          {desktopNotifications && (
            <div class="animate-fade-rise border-t border-[var(--color-border)] px-4 py-3.5">
              <p class="mb-2.5 text-xs font-medium text-[var(--color-muted)]">
                Notification style
              </p>
              <div class="flex flex-col gap-2">
                <ModeOption
                  active={notifStyle === "custom"}
                  onSelect={() => chooseStyle("custom")}
                  title="In-app popup"
                  desc="Show todofy's own notification in a screen corner, above other apps."
                />
                <ModeOption
                  active={notifStyle === "native"}
                  onSelect={() => chooseStyle("native")}
                  title="System notification"
                  desc="Hand the notification to your desktop's notification centre."
                />
              </div>

              {notifStyle === "custom" && (
                <div class="mt-3.5 animate-fade-rise">
                  <p class="mb-2 text-xs font-medium text-[var(--color-muted)]">
                    Position on screen
                  </p>
                  <div class="grid grid-cols-2 gap-2">
                    {CORNERS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => choosePosition(c.value)}
                        class={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          notifPosition === c.value
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]"
                            : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {desktopNotifications && (
            <div class="border-t border-[var(--color-border)] px-4 py-3.5">
              <p class="mb-2 text-xs font-medium text-[var(--color-muted)]">
                Keep reminding until answered
              </p>
              <div class="grid grid-cols-4 gap-2">
                {REPEAT_INTERVALS.map((option) => (
                  <Choice
                    key={option.value}
                    active={repeatEvery === option.value}
                    onSelect={() => chooseRepeat(option.value)}
                    label={option.label}
                  />
                ))}
              </div>
              <p class="mt-3 text-xs text-[var(--color-faint)]">
                {repeatEvery === "0"
                  ? "A reminder shows once and then waits for you."
                  : `A reminder shows again every ${repeatEvery} minutes until you open it, dismiss it, snooze it, complete the task, or start timing it.`}
              </p>

              <p class="mt-4 mb-2 text-xs font-medium text-[var(--color-muted)]">
                Sound
              </p>
              <div class="grid grid-cols-3 gap-2">
                {SOUNDS.map((option) => (
                  <Choice
                    key={option.value}
                    active={sound === option.value}
                    onSelect={() => chooseSound(option.value)}
                    label={
                      option.value === "custom" && customName
                        ? customName.replace(/\.[^.]+$/, "")
                        : option.label
                    }
                  />
                ))}
              </div>

              {sound === "custom" && (
                <button
                  onClick={pickCustomSound}
                  class="mt-2 text-xs text-[var(--color-accent)] hover:underline"
                >
                  Choose a different file…
                </button>
              )}
              {soundError && (
                <p class="mt-2 text-xs text-[var(--color-danger)]">{soundError}</p>
              )}

              {sound !== "none" && (
                <div class="mt-4 animate-fade-rise">
                  <div class="mb-2 flex items-center justify-between">
                    <p class="text-xs font-medium text-[var(--color-muted)]">Volume</p>
                    <button
                      onClick={() => previewSound(sound, volume)}
                      class="text-xs text-[var(--color-accent)] hover:underline"
                    >
                      Play
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={volume}
                    onInput={(e) => setVolume(Number(e.currentTarget.value))}
                    onChange={(e) => changeVolume(Number(e.currentTarget.value))}
                    class="w-full accent-[var(--color-accent)]"
                    aria-label="Reminder volume"
                  />

                  <label class="mt-3 flex items-start gap-2.5 text-xs text-[var(--color-muted)]">
                    <input
                      type="checkbox"
                      checked={ramp}
                      onChange={toggleRamp}
                      class="mt-0.5 accent-[var(--color-accent)]"
                    />
                    <span>
                      Get louder each time a reminder repeats
                      {repeatEvery === "0" && (
                        <em class="not-italic text-[var(--color-faint)]">
                          {" "}
                          — needs repeating reminders, above
                        </em>
                      )}
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          <div class="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-[var(--color-text)]">
                Test notification
              </p>
              <p class="mt-0.5 text-xs text-[var(--color-muted)]">
                {testStatus === "sent"
                  ? `Sent via ${ROUTE_LABEL[testRoute] ?? "notification"} — check your screen.`
                  : testStatus === "error"
                    ? "Couldn't send a notification."
                    : "Send a one-off notification to confirm your setup."}
              </p>
            </div>
            <button
              onClick={sendTestNotification}
              disabled={testStatus === "sending"}
              class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {testStatus === "sending" ? "Sending…" : "Send test"}
            </button>
          </div>
        </Section>

        {/* Date & time */}
        <Section title="Date & time">
          <div class="px-4 py-3.5">
            <p class="mb-2.5 text-xs font-medium text-[var(--color-muted)]">
              Clock
            </p>
            <div class="grid grid-cols-3 gap-2">
              {TIME_FORMATS.map((option) => (
                <Choice
                  key={option.value}
                  active={timeFormatPref === option.value}
                  onSelect={() => chooseTimeFormat(option.value)}
                  label={option.label}
                />
              ))}
            </div>

            <p class="mt-3.5 mb-2.5 text-xs font-medium text-[var(--color-muted)]">
              Week starts on
            </p>
            <div class="grid grid-cols-4 gap-2">
              {WEEK_STARTS.map((option) => (
                <Choice
                  key={option.value}
                  active={weekStartPref === option.value}
                  onSelect={() => chooseWeekStart(option.value)}
                  label={option.label}
                />
              ))}
            </div>

            <p class="mt-3 text-xs text-[var(--color-faint)]">
              Auto follows your system settings — currently {autoSummary()}.
            </p>

            <p class="mt-4 mb-2 text-xs font-medium text-[var(--color-muted)]">
              Quick times in the date picker
            </p>
            <div class="flex flex-wrap items-center gap-2">
              {quickTimes.map((t) => (
                <button
                  key={t}
                  onClick={() => removeQuickTime(t)}
                  title="Remove"
                  class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                >
                  {formatTime(t)}
                  <CloseIcon width={12} height={12} />
                </button>
              ))}
              {quickTimes.length < MAX_QUICK_TIMES && (
                <TimeField
                  value={newQuickTime}
                  onChange={setNewQuickTime}
                  onDone={addNewQuickTime}
                  variant="field"
                  label="Add"
                />
              )}
            </div>
            <p class="mt-2 text-xs text-[var(--color-faint)]">
              {quickTimes.length
                ? "Shown as one-tap buttons when you set a time. Click one to remove it."
                : "No shortcuts — the date picker shows only the time field."}
            </p>
          </div>
        </Section>

        {/* Task timer */}
        <Section title="Task timer">
          <div class="px-4 py-3.5">
            <p class="mb-2.5 text-xs font-medium text-[var(--color-muted)]">
              The play button on a task
            </p>
            <div class="grid grid-cols-2 gap-2">
              {TIMER_MODES.map((option) => (
                <Choice
                  key={option.value}
                  active={taskTimerMode === option.value}
                  onSelect={() => setTaskTimerMode(option.value)}
                  label={option.label}
                />
              ))}
            </div>
            <p class="mt-3 text-xs text-[var(--color-faint)]">
              {TIMER_MODES.find((option) => option.value === taskTimerMode)?.hint}{" "}
              Either way the task's time is recorded, and start, pause and stop
              work the same.
            </p>
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <Row
            icon={
              theme === "dark" ? (
                <MoonIcon width={18} height={18} />
              ) : (
                <SunIcon width={18} height={18} />
              )
            }
            title="Theme"
            desc={theme === "dark" ? "Dark mode is on." : "Light mode is on."}
          >
            <button
              onClick={toggleTheme}
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              Switch to {theme === "dark" ? "light" : "dark"}
            </button>
          </Row>

          <Row
            icon={<CheckCircleIcon width={18} height={18} />}
            title="Celebrate completions"
            desc="Play a little confetti burst when you finish a task. Automatically skipped if your system prefers reduced motion."
          >
            <Switch checked={celebrate} onChange={toggleCelebrate} />
          </Row>
        </Section>

        {/* Keyboard */}
        <Section title="Keyboard">
          <Row
            title="Keyboard shortcuts"
            desc="Navigate and edit without the mouse. Press ? anytime to open this list."
          >
            <button
              onClick={() => toggleShortcuts(true)}
              class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              View shortcuts
            </button>
          </Row>
        </Section>

        {/* About */}
        <Section title="About">
          <Row
            icon={<WebsiteIcon width={18} height={18} />}
            title="Todofy website"
            desc="News, downloads, and more from UnifyBrowse."
          >
            <ExternalButton
              label="Visit website"
              onClick={() => openExternal(WEBSITE_URL)}
            />
          </Row>
          <div class="border-t border-[var(--color-border)]" />
          <Row
            icon={<GitHubIcon width={18} height={18} />}
            title="GitHub repository"
            desc="Explore the source, report an issue, or contribute."
          >
            <ExternalButton
              label="Open GitHub"
              onClick={() => openExternal(GITHUB_URL)}
            />
          </Row>
          <div class="border-t border-[var(--color-border)]" />
          <Row
            title="Version"
            desc="You're running the latest installed build."
          >
            <span class="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
              {version ? `v${version}` : "—"}
            </span>
          </Row>
        </Section>
      </div>
    </main>
  );
}

/** A compact single-select option, as used by the date & time preferences. */
function Choice({
  active,
  onSelect,
  label,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      class={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      }`}
    >
      {label}
    </button>
  );
}

function ExternalButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
    >
      {label}
      <ExternalLinkIcon width={13} height={13} />
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="mb-6">
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        {title}
      </h3>
      <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {children}
      </div>
    </section>
  );
}

function Row({
  icon,
  title,
  desc,
  children,
}: {
  icon?: ComponentChildren;
  title: string;
  desc?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex items-center gap-3 px-4 py-3.5">
      {icon && (
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)]">
          {icon}
        </span>
      )}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-[var(--color-text)]">{title}</p>
        {desc && <p class="mt-0.5 text-xs text-[var(--color-muted)]">{desc}</p>}
      </div>
      <div class="shrink-0">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-2)]"
      }`}
    >
      <span
        class={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function ModeOption({
  active,
  onSelect,
  title,
  desc,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onSelect}
      class={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      <span
        class={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 transition-colors ${
          active
            ? "border-[var(--color-accent)]"
            : "border-[var(--color-border-strong)]"
        }`}
      >
        {active && (
          <span class="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
        )}
      </span>
      <div class="min-w-0">
        <p class="text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p class="mt-0.5 text-xs text-[var(--color-muted)]">{desc}</p>
      </div>
    </button>
  );
}
