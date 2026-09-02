import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useStore } from "../store";
import { AccountSection } from "./AccountSection";
import {
  BellIcon,
  BoltIcon,
  CheckCircleIcon,
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

// How the backend routed the test notification (see notify::deliver).
const ROUTE_LABEL: Record<string, string> = {
  popup: "the in-app popup",
  portal: "the desktop portal",
  fallback: "the fallback (classic) path",
};

export function SettingsView() {
  const { theme, toggleTheme, celebrate, toggleCelebrate, toggleShortcuts } =
    useStore();
  const [autostart, setAutostart] = useState(false);
  const [mode, setMode] = useState<StartupMode>("window");
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [notifStyle, setNotifStyle] = useState<"custom" | "native">("custom");
  const [notifPosition, setNotifPosition] = useState<Corner>("bottom-right");
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [testRoute, setTestRoute] = useState("");

  // Load current startup preferences from the backend.
  useEffect(() => {
    (async () => {
      const [enabled, storedMode, storedNotifications, style, position] =
        await Promise.all([
          api.getAutostart().catch(() => false),
          api.getSetting("startup_mode").catch(() => null),
          api.getSetting("desktop_notifications_enabled").catch(() => null),
          api.getSetting("notification_style").catch(() => null),
          api.getSetting("notification_position").catch(() => null),
        ]);
      setAutostart(enabled);
      if (storedMode === "tray" || storedMode === "window") setMode(storedMode);
      setDesktopNotifications(storedNotifications !== "false");
      setNotifStyle(style === "native" ? "native" : "custom");
      if (CORNERS.some((c) => c.value === position))
        setNotifPosition(position as Corner);
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
