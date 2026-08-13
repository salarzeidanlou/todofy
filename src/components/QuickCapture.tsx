import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { parseQuickAdd } from "../lib/nlp";
import { combineDateTime, formatDue, formatTime, today } from "../lib/dates";
import type { Label, NewTask } from "../types";
import { BellIcon, CalendarIcon, FlagIcon, Logo } from "./Icons";

const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--color-prio-1)",
  2: "var(--color-prio-2)",
  3: "var(--color-prio-3)",
  4: "var(--color-prio-4)",
};

/**
 * The floating quick-capture window. Lives in its own transparent,
 * always-on-top Tauri window that the Ctrl+Alt+A global shortcut summons. It
 * shares the SQLite backend with the main app; after adding a task it emits
 * `todo-added` so an open main window refreshes.
 */
export function QuickCapture() {
  const [title, setTitle] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const shownAt = useRef(Date.now());

  const parsed = useMemo(() => parseQuickAdd(title, labels), [title, labels]);
  const hasChips =
    !!parsed.dueDate || !!parsed.time || parsed.priority !== null || parsed.labelNames.length > 0;

  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());

  const dismiss = async () => {
    setTitle("");
    await getCurrentWindow().hide();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const finalTitle = parsed.title.trim();
    if (!finalTitle) return;

    const finalTime = parsed.time;
    // A time needs a date to live on — default to today.
    const finalDue = parsed.dueDate || (finalTime ? today() : null);

    const task: NewTask = { title: finalTitle, priority: parsed.priority ?? 4 };
    if (finalDue) task.dueDate = finalDue;
    if (finalDue && finalTime) task.remindAt = combineDateTime(finalDue, finalTime);
    if (parsed.labelIds.length) task.labelIds = parsed.labelIds;

    try {
      await api.createTask(task);
      await emit("todo-added");
    } finally {
      await dismiss();
    }
  };

  useEffect(() => {
    // Labels are needed so `#tag` tokens resolve to real labels.
    api.listLabels().then(setLabels).catch(() => {});

    const win = getCurrentWindow();
    focusInput();

    // Rust emits this each time it shows the window — reset, refetch labels
    // (in case they changed, or the initial load raced app startup), refocus.
    const unShow = win.listen("quick-show", () => {
      setTitle("");
      shownAt.current = Date.now();
      api.listLabels().then(setLabels).catch(() => {});
      focusInput();
    });
    // Dismiss when focus leaves (click-away), ignoring the transient blur
    // that can fire right as the window is being shown.
    const unFocus = win.onFocusChanged(({ payload: focused }) => {
      if (!focused && Date.now() - shownAt.current > 200) dismiss();
    });

    return () => {
      unShow.then((f) => f());
      unFocus.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class="flex h-screen w-screen flex-col items-center justify-start p-2">
      <form
        onSubmit={submit}
        class="w-full animate-fade-rise overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/60"
      >
        <div class="flex items-center gap-3 px-4 py-3.5">
          <Logo size={22} />
          <input
            ref={inputRef}
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                dismiss();
              }
            }}
            placeholder="Add a task…  “pay rent friday 5pm #home p1”"
            class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--color-faint)]"
          />
          <kbd class="shrink-0 rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-faint)]">
            ↵
          </kbd>
        </div>

        {hasChips ? (
          <div class="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2.5">
            {parsed.priority !== null && (
              <Chip color={PRIORITY_COLOR[parsed.priority]}>
                <FlagIcon width={11} height={11} />
                P{parsed.priority}
              </Chip>
            )}
            {parsed.dueDate && (
              <Chip>
                <CalendarIcon width={11} height={11} />
                {formatDue(parsed.dueDate).label}
              </Chip>
            )}
            {parsed.time && (
              <Chip>
                <BellIcon width={11} height={11} />
                {formatTime(parsed.time)}
              </Chip>
            )}
            {parsed.labelNames.map((name) => {
              const color = labels.find((l) => l.name === name)?.color;
              return (
                <Chip key={name} color={color}>
                  <span class="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  {name}
                </Chip>
              );
            })}
          </div>
        ) : (
          <div class="border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-faint)]">
            Press <b class="font-semibold text-[var(--color-muted)]">Enter</b> to add ·{" "}
            <b class="font-semibold text-[var(--color-muted)]">Esc</b> to dismiss
          </div>
        )}
      </form>
    </div>
  );
}

function Chip({ color, children }: { color?: string; children: ComponentChildren }) {
  return (
    <span
      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        color
          ? { background: color + "22", color }
          : { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
      }
    >
      {children}
    </span>
  );
}
