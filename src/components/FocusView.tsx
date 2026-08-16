import { useEffect, useState } from "preact/hooks";
import { useStore } from "../store";
import type { PomodoroPhase, SessionLog } from "../types";
import { api } from "../lib/api";
import { clock, formatDuration, secondsSince } from "../lib/duration";
import { toLocalDate, today } from "../lib/dates";
import {
  PauseIcon,
  PlayIcon,
  RotateIcon,
  SkipIcon,
  TimerIcon,
} from "./Icons";

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

export function FocusView() {
  const {
    pomodoro,
    pomodoroStart,
    pomodoroPause,
    pomodoroReset,
    pomodoroNext,
    setPomodoroConfig,
    activeTimer,
  } = useStore();

  const [history, setHistory] = useState<SessionLog[]>([]);
  const [, setNow] = useState(Date.now());

  // Reload history whenever a session ends (activeTimer transitions to null).
  useEffect(() => {
    api.focusHistory().then(setHistory).catch(() => {});
  }, [activeTimer]);

  // Tick while the Pomodoro runs so the countdown updates.
  useEffect(() => {
    if (!pomodoro?.running) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [pomodoro?.running]);

  const p = pomodoro;
  const elapsed = p
    ? p.accumulated + (p.running && p.startAt ? secondsSince(p.startAt) : 0)
    : 0;
  const remaining = p ? p.target - elapsed : 0;
  const overtime = remaining < 0;

  return (
    <main class="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="shrink-0 px-8 pt-8 pb-4">
        <h2 class="text-2xl font-semibold tracking-tight">Focus</h2>
        <p class="mt-0.5 text-sm text-[var(--color-muted)]">
          Run a Pomodoro, tune its lengths, and review your focus history
        </p>
      </header>

      <div class="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-8">
        {/* Pomodoro */}
        {p && (
          <section class="mb-6 flex flex-col items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8">
            <span
              class={`rounded-full px-3 py-1 text-xs font-medium ${
                p.phase === "focus"
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-success)]"
              }`}
            >
              {PHASE_LABEL[p.phase]}
            </span>

            <span
              class={`font-mono text-6xl font-semibold tabular-nums ${
                overtime ? "text-[var(--color-warning)]" : "text-[var(--color-text)]"
              }`}
            >
              {clock(remaining)}
            </span>

            <p class="text-xs text-[var(--color-faint)]">
              {p.completedFocus} focus session{p.completedFocus === 1 ? "" : "s"} completed
            </p>

            <div class="flex items-center gap-3">
              <button
                onClick={pomodoroReset}
                title="Reset phase"
                class="grid h-11 w-11 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                <RotateIcon width={18} height={18} />
              </button>
              <button
                onClick={p.running ? pomodoroPause : pomodoroStart}
                class="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)]"
                title={p.running ? "Pause" : "Start"}
              >
                {p.running ? (
                  <PauseIcon width={24} height={24} />
                ) : (
                  <PlayIcon width={24} height={24} />
                )}
              </button>
              <button
                onClick={pomodoroNext}
                title="Skip to next phase"
                class="grid h-11 w-11 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                <SkipIcon width={18} height={18} />
              </button>
            </div>
          </section>
        )}

        {/* Settings */}
        {p && (
          <section class="mb-6">
            <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
              Pomodoro lengths
            </h3>
            <div class="grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 sm:grid-cols-4">
              <NumberField
                label="Focus"
                value={p.focusMin}
                onCommit={(v) => setPomodoroConfig(v, p.shortMin, p.longMin, p.longEvery)}
              />
              <NumberField
                label="Short break"
                value={p.shortMin}
                onCommit={(v) => setPomodoroConfig(p.focusMin, v, p.longMin, p.longEvery)}
              />
              <NumberField
                label="Long break"
                value={p.longMin}
                onCommit={(v) => setPomodoroConfig(p.focusMin, p.shortMin, v, p.longEvery)}
              />
              <NumberField
                label="Long every"
                value={p.longEvery}
                onCommit={(v) => setPomodoroConfig(p.focusMin, p.shortMin, p.longMin, v)}
              />
            </div>
          </section>
        )}

        {/* History */}
        <History sessions={history} />
      </div>
    </main>
  );
}

function History({ sessions }: { sessions: SessionLog[] }) {
  const t = today();
  const weekAgo = toLocalDate(new Date(Date.now() - 6 * 86400000));
  const todayTotal = sum(sessions.filter((s) => toLocalDate(new Date(s.startAt)) === t));
  const weekTotal = sum(sessions.filter((s) => toLocalDate(new Date(s.startAt)) >= weekAgo));
  const allTotal = sum(sessions);

  // Group by local day, newest first (the list already arrives sorted desc).
  const groups: { day: string; items: SessionLog[] }[] = [];
  for (const s of sessions) {
    const day = toLocalDate(new Date(s.startAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(s);
    else groups.push({ day, items: [s] });
  }

  return (
    <section>
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        History
      </h3>

      <div class="mb-3 grid grid-cols-3 gap-3">
        <Stat label="Today" value={formatDuration(todayTotal)} />
        <Stat label="This week" value={formatDuration(weekTotal)} />
        <Stat label="Tracked total" value={formatDuration(allTotal)} />
      </div>

      {sessions.length === 0 ? (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
          No focus sessions yet. Press play on a task to start tracking.
        </div>
      ) : (
        <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {groups.map((g) => (
            <div key={g.day}>
              <div class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-1.5">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                  {dayLabel(g.day)}
                </span>
                <span class="text-[11px] text-[var(--color-faint)]">
                  {formatDuration(sum(g.items))}
                </span>
              </div>
              {g.items.map((s) => (
                <div
                  key={s.id}
                  class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0"
                >
                  <TimerIcon width={14} height={14} class="shrink-0 text-[var(--color-faint)]" />
                  <span class="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">
                    {s.title}
                  </span>
                  <span class="shrink-0 text-xs text-[var(--color-muted)]">
                    {timeRange(s.startAt, s.endAt)}
                  </span>
                  <span class="shrink-0 font-mono text-xs tabular-nums text-[var(--color-muted)]">
                    {formatDuration(s.seconds)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-center">
      <p class="text-lg font-semibold tabular-nums text-[var(--color-text)]">{value}</p>
      <p class="mt-0.5 text-[11px] uppercase tracking-wider text-[var(--color-faint)]">
        {label}
      </p>
    </div>
  );
}

/** Small labelled number input that commits on blur / Enter. */
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Math.max(1, Math.round(Number(text) || value));
    if (n !== value) onCommit(n);
    setText(String(n));
  };

  return (
    <label class="flex flex-col gap-1">
      <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
        {label}
      </span>
      <input
        type="number"
        min={1}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--color-accent)]"
      />
    </label>
  );
}

function sum(sessions: SessionLog[]): number {
  return sessions.reduce((acc, s) => acc + s.seconds, 0);
}

function dayLabel(day: string): string {
  const t = today();
  if (day === t) return "Today";
  if (day === toLocalDate(new Date(Date.now() - 86400000))) return "Yesterday";
  return new Date(day + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
