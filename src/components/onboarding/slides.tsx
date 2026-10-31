import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useStore } from "../../store";
import { api } from "../../lib/api";
import { billingConfigured, useBilling } from "../../lib/billing";
import { formatDue, formatTime } from "../../lib/dates";
import { parseQuickAdd } from "../../lib/nlp";
import { useOnboarding } from "../../lib/onboarding";
import { priorityColor, priorityTag } from "../../lib/priority";
import { repeatLabel } from "../../lib/repeat";
import {
  BellIcon,
  BoltIcon,
  CalendarIcon,
  CheckIcon,
  CloudIcon,
  DevicesIcon,
  FlagIcon,
  JournalIcon,
  LabelIcon,
  PlusIcon,
  PowerIcon,
  RepeatIcon,
  ShieldCheckIcon,
} from "../Icons";

/* ---------------------------------------------------------------- *
 * 1 — Welcome
 * ---------------------------------------------------------------- */

export function WelcomeSlide() {
  return (
    <div class="px-2 pt-2 text-center">
      <div class="relative mx-auto grid h-31 w-31 place-items-center">
        <span class="onb-orb pointer-events-none absolute -inset-3.5 rounded-full bg-(--color-accent) opacity-[0.18] blur-3xl" />
        <span class="onb-bloom relative">
          <Mark />
        </span>
      </div>

      <div class="onb-stagger mt-6">
        <Eyebrow>Welcome to todofy</Eyebrow>
        <h2 class="mt-2 text-[27px] font-semibold leading-[1.16] tracking-[-0.035em] text-text">
          Everything you need to do.
          <br />
          Nothing you don't.
        </h2>
        <p class="mx-auto mt-3 max-w-108 text-[13px] leading-5 text-muted">
          Your tasks live on this machine, in a plain database file you own. Two
          minutes here and it will feel like yours.
        </p>
        <div class="mt-6 flex flex-wrap items-center justify-center gap-2">
          <TrustChip icon={<BoltIcon width={12} height={12} />}>
            Opens instantly
          </TrustChip>
          <TrustChip icon={<ShieldCheckIcon width={12} height={12} />}>
            Private by default
          </TrustChip>
          <TrustChip icon={<CloudIcon width={12} height={12} />}>
            Works offline
          </TrustChip>
        </div>
      </div>
    </div>
  );
}

/** The app mark, drawing its own checkmark on arrival. */
function Mark() {
  return (
    <svg
      width="86"
      height="86"
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="onb-mark"
          x1="512"
          y1="64"
          x2="512"
          y2="960"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#7d8bff" />
          <stop offset="1" stop-color="#6c7cff" />
        </linearGradient>
      </defs>
      <rect
        x="64"
        y="64"
        width="896"
        height="896"
        rx="208"
        fill="url(#onb-mark)"
      />
      <path
        class="onb-draw"
        style={{ "--len": 600 } as never}
        d="M300 524 L442 666 L724 384"
        stroke="#ffffff"
        stroke-width="84"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------- *
 * 2 — Theme
 * ---------------------------------------------------------------- */

export function ThemeSlide() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <div class="onb-stagger text-center">
      <Eyebrow>Appearance</Eyebrow>
      <SlideTitle>Pick a side</SlideTitle>
      <SlideText>
        Todofy follows you either way — switch whenever you like from Settings.
      </SlideText>

      <div class="mt-7 grid grid-cols-2 gap-4">
        {(["dark", "light"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={theme === mode}
            onClick={() => theme !== mode && toggleTheme()}
            class={`group rounded-2xl border-2 p-2.5 text-left transition-[border-color,transform] active:translate-y-px ${
              theme === mode
                ? "border-(--color-accent)"
                : "border-border hover:border-border-strong"
            }`}
          >
            <ThemePreview mode={mode} />
            <span class="mt-2.5 flex items-center justify-between px-1 pb-0.5">
              <span class="text-[13px] font-medium text-text">
                {mode === "dark" ? "Dark" : "Light"}
              </span>
              <span
                class={`grid h-4.5 w-4.5 place-items-center rounded-full transition-colors ${
                  theme === mode
                    ? "bg-(--color-accent) text-white"
                    : "border border-border-strong text-transparent"
                }`}
              >
                <CheckIcon width={11} height={11} stroke-width={3} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A miniature of the app in a given theme. The colors are written out rather
 * than read from the CSS variables, since each card has to show the theme it
 * is offering and not the one currently applied.
 */
function ThemePreview({ mode }: { mode: "dark" | "light" }) {
  const c =
    mode === "dark"
      ? {
          bg: "#0e1116",
          side: "#161b22",
          row: "#1c232d",
          line: "#2a333f",
          text: "#3f4b59",
        }
      : {
          bg: "#f7f8fa",
          side: "#ffffff",
          row: "#ffffff",
          line: "#e3e7ec",
          text: "#c8cfd7",
        };
  return (
    <span
      class="flex h-26 gap-1.5 overflow-hidden rounded-xl p-1.5"
      style={{ background: c.bg }}
      aria-hidden="true"
    >
      <span
        class="flex w-[26%] flex-col gap-1.5 rounded-lg p-1.5"
        style={{ background: c.side }}
      >
        <span
          class="h-1.5 w-[70%] rounded-full"
          style={{ background: "#6c7cff" }}
        />
        {[60, 80, 50].map((w, i) => (
          <span
            key={i}
            class="h-1.5 rounded-full"
            style={{ background: c.text, width: `${w}%` }}
          />
        ))}
      </span>
      <span class="flex flex-1 flex-col gap-1.5">
        <span class="h-2 w-[45%] rounded-full" style={{ background: c.text }} />
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            class="flex flex-1 items-center gap-1.5 rounded-lg px-1.5"
            style={{ background: c.row, border: `1px solid ${c.line}` }}
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              style={{ border: `1.5px solid ${i === 0 ? "#6c7cff" : c.text}` }}
            />
            <span
              class="h-1.5 rounded-full"
              style={{ background: c.text, width: `${[70, 52, 62][i]}%` }}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- *
 * 3 — Capture
 * ---------------------------------------------------------------- */

const DEMO = "Call the bank tomorrow at 10am p1 every month";

export function CaptureSlide() {
  const labels = useStore((s) => s.labels);
  const priorityProfiles = useStore((s) => s.priorityProfiles);
  const setDraftText = useOnboarding((s) => s.setDraftText);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stepping back to this slide restores whatever was typed the first time.
  const [value, setValue] = useState(() => useOnboarding.getState().draftText);
  const [touched, setTouched] = useState(() => value.length > 0);
  const [ghost, setGhost] = useState("");

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Type the example out for anyone who is only watching, and drop it the
  // moment they start writing something of their own.
  useEffect(() => {
    if (touched) {
      setGhost("");
      return;
    }
    let shown = 0;
    let timer = 0;
    const tick = () => {
      shown = shown >= DEMO.length ? 0 : shown + 1;
      setGhost(DEMO.slice(0, shown));
      // Hold the finished sentence a beat, then start over from empty.
      timer = window.setTimeout(
        tick,
        shown === DEMO.length ? 2800 : shown === 0 ? 500 : 52,
      );
    };
    timer = window.setTimeout(tick, 650);
    return () => clearTimeout(timer);
  }, [touched]);

  const text = touched ? value : ghost;
  const parsed = useMemo(() => parseQuickAdd(text, labels), [text, labels]);

  // Only what the user actually wrote becomes a real task — the demo is a demo.
  useEffect(() => {
    setDraftText(touched ? value : "");
  }, [touched, value, setDraftText]);

  return (
    <div class="onb-stagger text-center">
      <Eyebrow>Quick add</Eyebrow>
      <SlideTitle>Type it like you'd say it</SlideTitle>
      <SlideText>
        Dates, times, priorities and repeats are read straight out of the
        sentence. Write yours — it'll be waiting when the tour ends.
      </SlideText>

      <div class="mt-7">
        <div class="flex items-center gap-3 rounded-2xl border border-border-strong bg-bg px-4 py-3.5 text-left shadow-inner shadow-black/5 transition-colors focus-within:border-(--color-accent)">
          <PlusIcon
            width={20}
            height={20}
            class="shrink-0 text-(--color-accent)"
          />
          <div class="relative min-w-0 flex-1">
            {!touched && (
              <div class="pointer-events-none absolute inset-0 flex items-center whitespace-pre text-[13px] text-muted">
                {ghost}
                <span class="onb-caret ml-px inline-block h-3.75 w-[1.5px] bg-(--color-accent) align-middle" />
              </div>
            )}
            <input
              ref={inputRef}
              value={value}
              onInput={(event) => {
                setTouched(true);
                setValue(event.currentTarget.value);
              }}
              aria-label="Your first task"
              spellcheck={false}
              class="w-full bg-transparent text-[13px] text-text outline-none"
            />
          </div>
        </div>

        <div class="mt-3 flex min-h-6.5 flex-wrap items-center justify-center gap-1.5">
          {parsed.priority !== null && (
            <ParsedChip
              key={`p${parsed.priority}`}
              color={priorityColor(parsed.priority, priorityProfiles)}
            >
              <FlagIcon width={11} height={11} />
              {priorityTag(parsed.priority, priorityProfiles)}
            </ParsedChip>
          )}
          {parsed.dueDate && (
            <ParsedChip key={`d${parsed.dueDate}`}>
              <CalendarIcon width={11} height={11} />
              {formatDue(parsed.dueDate).label}
            </ParsedChip>
          )}
          {parsed.time && (
            <ParsedChip key={`t${parsed.time}`}>
              <BellIcon width={11} height={11} />
              {formatTime(parsed.time)}
            </ParsedChip>
          )}
          {parsed.repeat && (
            <ParsedChip key={`r${parsed.repeat}`}>
              <RepeatIcon width={11} height={11} />
              {repeatLabel(parsed.repeat)}
            </ParsedChip>
          )}
          {parsed.title.trim() && (
            <span class="text-[11px] text-faint">
              → “{parsed.title.trim()}”
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ParsedChip({
  color,
  children,
}: {
  color?: string;
  children: ComponentChildren;
}) {
  return (
    <span
      class="onb-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        color
          ? { background: `${color}22`, color }
          : {
              background: "var(--color-accent-soft)",
              color: "var(--color-accent)",
            }
      }
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- *
 * 4 — Focus
 * ---------------------------------------------------------------- */

const LENGTHS = [25, 45, 50];

export function FocusSlide() {
  const pomodoro = useStore((s) => s.pomodoro);
  const refreshPomodoro = useStore((s) => s.refreshPomodoro);
  const [focusMin, setFocusMin] = useState(pomodoro?.focusMin ?? 25);

  const choose = async (minutes: number) => {
    setFocusMin(minutes);
    // Reconfiguring mid-session would disturb a running timer; nothing is
    // running on a first run, but a replay from Settings might be.
    if (pomodoro?.running) return;
    try {
      await api.setPomodoroConfig(
        minutes,
        pomodoro?.shortMin ?? 5,
        pomodoro?.longMin ?? 15,
        pomodoro?.longEvery ?? 4,
      );
      await refreshPomodoro();
    } catch {
      /* best-effort; it can still be set in Settings */
    }
  };

  return (
    <div class="onb-stagger text-center">
      <Eyebrow>Focus</Eyebrow>
      <SlideTitle>One task at a time</SlideTitle>
      <SlideText>
        Start a Pomodoro or a stopwatch on any task. Both are timed by the
        backend, so they keep counting with the window closed.
      </SlideText>

      <div class="relative mx-auto mt-6 grid h-33.5 w-33.5 place-items-center">
        <svg
          width="134"
          height="134"
          viewBox="0 0 134 134"
          class="absolute inset-0 -rotate-90"
        >
          <circle
            cx="67"
            cy="67"
            r="58"
            fill="none"
            stroke="var(--color-border)"
            stroke-width="7"
          />
          <circle
            class="onb-ring"
            style={{ "--len": 365 } as never}
            cx="67"
            cy="67"
            r="58"
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="7"
            stroke-linecap="round"
          />
        </svg>
        <span class="relative text-center">
          <span class="block text-[26px] font-semibold tabular-nums tracking-tight text-text">
            {focusMin}:00
          </span>
          <span class="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">
            Focus
          </span>
        </span>
      </div>

      <div class="mt-6">
        <p class="text-[11px] font-medium text-muted">Session length</p>
        <div class="mt-2 inline-grid grid-cols-3 gap-1 rounded-xl border border-border bg-bg p-1">
          {LENGTHS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={focusMin === minutes}
              onClick={() => void choose(minutes)}
              class={`rounded-lg px-5 py-1.5 text-xs font-medium transition-colors ${
                focusMin === minutes
                  ? "bg-(--color-accent) text-white"
                  : "text-muted hover:text-text"
              }`}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 5 — Capture anywhere + reminders
 * ---------------------------------------------------------------- */

type PermissionState = "idle" | "working" | "granted" | "denied";

export function RemindersSlide() {
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [autostart, setAutostart] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [granted, enabled] = await Promise.all([
        isPermissionGranted().catch(() => false),
        api.getAutostart().catch(() => false),
      ]);
      if (granted) setPermission("granted");
      setAutostart(enabled);
      setReady(true);
    })();
  }, []);

  const enableNotifications = async () => {
    setPermission("working");
    try {
      const granted =
        (await isPermissionGranted()) ||
        (await requestPermission()) === "granted";
      await api
        .setSetting("desktop_notifications_enabled", granted ? "true" : "false")
        .catch(() => {});
      setPermission(granted ? "granted" : "denied");
    } catch {
      setPermission("denied");
    }
  };

  const toggleAutostart = async () => {
    const next = !autostart;
    setAutostart(next); // optimistic
    try {
      await api.setAutostart(next);
      if (next) await api.setSetting("startup_mode", "window").catch(() => {});
    } catch {
      setAutostart(!next);
    }
  };

  return (
    <div class="onb-stagger text-center">
      <Eyebrow>Capture &amp; reminders</Eyebrow>
      <SlideTitle>Never lose a thought</SlideTitle>
      <SlideText>
        Press the hotkey in any app to jot something down, and let todofy tap
        you on the shoulder when it's due.
      </SlideText>

      <HotkeyArt />

      <div class="mt-6 space-y-2">
        <ActionRow
          icon={<BellIcon width={17} height={17} />}
          title="Desktop notifications"
          desc="Get a notification the moment a reminder or timer is due."
        >
          {permission === "granted" ? (
            <span class="inline-flex items-center gap-1.5 rounded-lg bg-success/12 px-3 py-1.5 text-xs font-medium text-success">
              <CheckIcon width={12} height={12} stroke-width={3} />
              Enabled
            </span>
          ) : (
            <button
              type="button"
              disabled={permission === "working"}
              onClick={() => void enableNotifications()}
              class="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {permission === "working"
                ? "Asking…"
                : permission === "denied"
                  ? "Try again"
                  : "Enable"}
            </button>
          )}
        </ActionRow>

        <ActionRow
          icon={<PowerIcon width={17} height={17} />}
          title="Start todofy at login"
          desc="Reminders only fire while todofy is running."
        >
          <MiniSwitch
            checked={autostart}
            disabled={!ready}
            onChange={() => void toggleAutostart()}
          />
        </ActionRow>
      </div>

      {permission === "denied" && (
        <p class="mt-3 text-[11px] text-(--color-warning)">
          Your system refused the request. You can still allow todofy in your
          desktop's notification settings.
        </p>
      )}
    </div>
  );
}

/** Keys press, the capture window drops in, a reminder slides up. One loop. */
function HotkeyArt() {
  return (
    <div
      class="relative mx-auto mt-6 h-37.5 w-full max-w-100"
      aria-hidden="true"
    >
      <div class="absolute bottom-1 left-2 flex items-center gap-1">
        {["Ctrl", "Alt", "A"].map((key, i) => (
          <span
            key={key}
            class="onb-key rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-[10px] font-semibold text-muted shadow-sm"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            {key}
          </span>
        ))}
      </div>

      <div class="onb-drop absolute left-1/2 top-0 w-63 -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-elevated shadow-2xl shadow-black/40">
        <div class="flex items-center gap-2 px-3 py-2.5">
          <PlusIcon width={14} height={14} class="text-(--color-accent)" />
          <span class="text-[11px] text-muted">Book the dentist…</span>
          <span class="onb-caret -ml-1 inline-block h-2.75 w-[1.5px] bg-(--color-accent)" />
        </div>
        <div class="border-t border-border px-3 py-1.5 text-[9px] text-faint">
          Enter to save · Esc to dismiss
        </div>
      </div>

      <div class="onb-toast absolute bottom-0 right-0 flex w-52.5 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-lg shadow-black/20">
        <span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-(--color-accent)">
          <BellIcon width={12} height={12} />
        </span>
        <span class="min-w-0 text-left">
          <span class="block truncate text-[10px] font-medium text-text">
            Call the bank
          </span>
          <span class="block text-[9px] text-faint">Due now · 10:00</span>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 6 — The rest of the app
 * ---------------------------------------------------------------- */

const FEATURES = [
  {
    icon: <JournalIcon width={18} height={18} />,
    title: "Journal",
    desc: "A dated page for how the day actually went.",
  },
  {
    icon: <CalendarIcon width={18} height={18} />,
    title: "Calendar",
    desc: "See the month, drop tasks and events onto days.",
  },
  {
    icon: <LabelIcon width={18} height={18} />,
    title: "Labels & priorities",
    desc: "Colour-code work and flag what can't slip.",
  },
  {
    icon: <RepeatIcon width={18} height={18} />,
    title: "Repeating tasks",
    desc: "Finish one and the next occurrence rolls forward.",
  },
];

export function FeaturesSlide() {
  return (
    <div class="text-center">
      <div class="onb-stagger">
        <Eyebrow>And there's more</Eyebrow>
        <SlideTitle>More than a task list</SlideTitle>
        <SlideText>
          Everything here is local and keyboard-first. Explore it at your own
          pace — nothing is hidden behind a setup wizard.
        </SlideText>
      </div>

      <div class="mt-7 grid grid-cols-2 gap-3 text-left">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.title}
            class="onb-pop rounded-2xl border border-border bg-surface p-4"
            style={{ animationDelay: `${140 + i * 90}ms` }}
          >
            <span
              class="onb-float grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-(--color-accent)"
              style={{ animationDelay: `${i * 420}ms` }}
            >
              {feature.icon}
            </span>
            <p class="mt-3 text-[13px] font-medium text-text">
              {feature.title}
            </p>
            <p class="mt-1 text-[11px] leading-4 text-muted">{feature.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 7 — Finish
 * ---------------------------------------------------------------- */

const SHORTCUTS: [string, string][] = [
  ["Ctrl + Alt + A", "Capture from any app"],
  ["N", "New task, right here"],
  ["?", "Every other shortcut"],
];

export function FinishSlide() {
  const draft = useOnboarding((s) => s.draftText.trim());
  const finish = useOnboarding((s) => s.finish);
  const openGate = useBilling((s) => s.openGate);

  return (
    <div class="onb-stagger text-center">
      <span class="onb-bloom mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/12 text-success">
        <CheckIcon width={26} height={26} stroke-width={2.5} />
      </span>

      <div>
        <SlideTitle class="mt-5">You're set up</SlideTitle>
        <SlideText>
          {draft
            ? "Your first task is waiting in Today. Three keys worth remembering:"
            : "That's the whole tour. Three keys worth remembering:"}
        </SlideText>
      </div>

      <div class="mt-6 space-y-2">
        {SHORTCUTS.map(([keys, what]) => (
          <div
            key={keys}
            class="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-2.5"
          >
            <kbd class="rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-[11px] font-semibold text-text">
              {keys}
            </kbd>
            <span class="text-[12px] text-muted">{what}</span>
          </div>
        ))}
      </div>

      {billingConfigured && (
        <p class="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-faint">
          <DevicesIcon width={13} height={13} />
          On more than one machine? Todofy Pro syncs them.
          <button
            type="button"
            onClick={() => {
              void finish();
              openGate("upgrade");
            }}
            class="font-medium text-muted underline underline-offset-2 transition-colors hover:text-text"
          >
            Take a look
          </button>
        </p>
      )}

      <p class="mt-2 text-[10px] text-faint">
        You can replay this tour anytime from Settings → About.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Shared pieces
 * ---------------------------------------------------------------- */

function Eyebrow({ children }: { children: ComponentChildren }) {
  return (
    <p class="text-[10px] font-semibold uppercase tracking-[0.26em] text-(--color-accent)">
      {children}
    </p>
  );
}

function SlideTitle({
  children,
  class: className = "",
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <h2
      class={`text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] text-text ${className}`}
    >
      {children}
    </h2>
  );
}

function SlideText({ children }: { children: ComponentChildren }) {
  return (
    <p class="mx-auto mt-2.5 max-w-108 text-[13px] leading-5 text-muted">
      {children}
    </p>
  );
}

function TrustChip({
  icon,
  children,
}: {
  icon: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted">
      <span class="text-(--color-accent)">{icon}</span>
      {children}
    </span>
  );
}

function ActionRow({
  icon,
  title,
  desc,
  children,
}: {
  icon: ComponentChildren;
  title: string;
  desc: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left">
      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        {icon}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] font-medium text-text">{title}</span>
        <span class="mt-0.5 block text-[11px] text-muted">{desc}</span>
      </span>
      <span class="shrink-0">{children}</span>
    </div>
  );
}

function MiniSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-(--color-accent)" : "bg-surface-2"
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
