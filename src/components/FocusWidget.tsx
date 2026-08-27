import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import type { PomodoroPhase } from "../types";
import { clock, formatDuration, secondsSince } from "../lib/duration";
import {
  CloseIcon,
  ExpandIcon,
  PauseIcon,
  PlayIcon,
  RotateIcon,
  SkipIcon,
  StopIcon,
} from "./Icons";

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

export function FocusWidget() {
  const {
    showFocus,
    toggleFocus,
    pomodoro,
    activeTimer,
    pomodoroStart,
    pomodoroPause,
    pomodoroReset,
    pomodoroNext,
    select,
    setView,
    stopTaskTimer,
  } = useStore();

  // Re-render every second so the countdowns tick.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const running = pomodoro?.running || !!activeTimer;
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [pomodoro?.running, activeTimer]);

  // Click anywhere outside the card closes it, same as the ✕ button.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showFocus) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-focus-toggle]")) return;
      toggleFocus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showFocus, toggleFocus]);

  if (!showFocus) return null;

  const p = pomodoro;
  const elapsed = p
    ? p.accumulated + (p.running && p.startAt ? secondsSince(p.startAt) : 0)
    : 0;
  const remaining = p ? p.target - elapsed : 0;
  const overtime = remaining < 0;
  const activeElapsed = activeTimer ? secondsSince(activeTimer.startAt) : 0;

  return (
    <div
      ref={rootRef}
      class="fixed bottom-4 left-4 z-50 w-72 animate-fade-rise overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/50"
    >
      {/* Header */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          Focus
        </span>
        <div class="flex items-center gap-1">
          <button
            onClick={() => setView({ kind: "focus" })}
            class="text-[var(--color-faint)] hover:text-[var(--color-text)]"
            title="Open focus screen"
          >
            <ExpandIcon width={15} height={15} />
          </button>
          <button
            onClick={toggleFocus}
            class="text-[var(--color-faint)] hover:text-[var(--color-text)]"
            title="Hide"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {/* Pomodoro */}
      {p && (
        <div class="flex flex-col items-center gap-3 px-4 py-4">
          <span
            class={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              p.phase === "focus"
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "bg-[var(--color-surface-2)] text-[var(--color-success)]"
            }`}
          >
            {PHASE_LABEL[p.phase]}
          </span>

          <span
            class={`font-mono text-4xl font-semibold tabular-nums ${
              overtime ? "text-[var(--color-warning)]" : "text-[var(--color-text)]"
            }`}
          >
            {clock(remaining)}
          </span>

          {p.completedFocus > 0 && (
            <span class="text-[11px] text-[var(--color-faint)]">
              {p.completedFocus} focus session{p.completedFocus === 1 ? "" : "s"} done
            </span>
          )}

          <div class="flex items-center gap-2">
            <button
              onClick={pomodoroReset}
              title="Reset phase"
              class="grid h-9 w-9 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <RotateIcon width={16} height={16} />
            </button>
            <button
              onClick={p.running ? pomodoroPause : pomodoroStart}
              title={p.running ? "Pause" : "Start"}
              class="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              {p.running ? (
                <PauseIcon width={20} height={20} />
              ) : (
                <PlayIcon width={20} height={20} />
              )}
            </button>
            <button
              onClick={pomodoroNext}
              title="Skip to next phase"
              class="grid h-9 w-9 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <SkipIcon width={16} height={16} />
            </button>
          </div>
        </div>
      )}

      {/* Active task stopwatch */}
      {activeTimer && (
        <div class="flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <span class="relative flex h-2.5 w-2.5 shrink-0">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-danger)] opacity-70" />
            <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]" />
          </span>
          <button
            onClick={() => select(activeTimer.taskId)}
            class="min-w-0 flex-1 text-left"
            title="Open task"
          >
            <p class="truncate text-sm text-[var(--color-text)]">{activeTimer.title}</p>
            <p class="font-mono text-xs tabular-nums text-[var(--color-muted)]">
              {formatDuration(activeElapsed)}
            </p>
          </button>
          <button
            onClick={stopTaskTimer}
            title="Stop tracking"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-danger)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <StopIcon width={18} height={18} />
          </button>
        </div>
      )}
    </div>
  );
}
