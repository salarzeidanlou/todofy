import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../lib/api";
import { useStore } from "../store";
import { MoonIcon, PowerIcon, SunIcon } from "./Icons";

type StartupMode = "window" | "tray";

export function SettingsView() {
  const { theme, toggleTheme } = useStore();
  const [autostart, setAutostart] = useState(false);
  const [mode, setMode] = useState<StartupMode>("window");
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);

  // Load current startup preferences from the backend.
  useEffect(() => {
    (async () => {
      const [enabled, storedMode] = await Promise.all([
        api.getAutostart().catch(() => false),
        api.getSetting("startup_mode").catch(() => null),
      ]);
      setAutostart(enabled);
      if (storedMode === "tray" || storedMode === "window") setMode(storedMode);
      setReady(true);
    })();
    getVersion().then(setVersion).catch(() => {});
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

  return (
    <main class="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="shrink-0 px-8 pt-8 pb-4">
        <h2 class="text-2xl font-semibold tracking-tight">Settings</h2>
        <p class="mt-0.5 text-sm text-[var(--color-muted)]">
          Startup, appearance, and about
        </p>
      </header>

      <div class="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-8">
        {/* Startup */}
        <Section title="Startup">
          <Row
            icon={<PowerIcon width={18} height={18} />}
            title="Run todofy on startup"
            desc="Launch automatically when you sign in to your computer."
          >
            <Switch checked={autostart} onChange={toggleAutostart} disabled={!ready} />
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
        </Section>

        {/* About */}
        <Section title="About">
          <Row title="Version" desc="You're running the latest installed build.">
            <span class="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
              {version ? `v${version}` : "—"}
            </span>
          </Row>
        </Section>
      </div>
    </main>
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
