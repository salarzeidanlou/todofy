import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { parseQuickAdd } from "../lib/nlp";
import { repeatLabel } from "../lib/repeat";
import { combineDateTime, formatDue, formatTime, today } from "../lib/dates";
import type { Label, NewTask } from "../types";
import { BellIcon, CalendarIcon, FlagIcon, Logo, RepeatIcon } from "./Icons";

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
    !!parsed.dueDate ||
    !!parsed.time ||
    parsed.priority !== null ||
    parsed.repeat !== null ||
    parsed.labelNames.length > 0;

  const focusInput = () =>
    requestAnimationFrame(() => inputRef.current?.focus());

  const dismiss = async () => {
    setTitle("");
    await getCurrentWindow().hide();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const finalTitle = parsed.title.trim();
    if (!finalTitle) return;

    const finalTime = parsed.time;
    // A time or a recurrence needs a date to anchor to — default to today.
    const finalDue =
      parsed.dueDate || (finalTime || parsed.repeat ? today() : null);

    const task: NewTask = { title: finalTitle, priority: parsed.priority ?? 4 };
    if (finalDue) task.dueDate = finalDue;
    if (finalDue && finalTime)
      task.remindAt = combineDateTime(finalDue, finalTime);
    if (parsed.repeat) task.repeat = parsed.repeat;
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
    api
      .listLabels()
      .then(setLabels)
      .catch(() => {});

    const win = getCurrentWindow();
    focusInput();

    // Rust emits this each time it shows the window — reset, refetch labels
    // (in case they changed, or the initial load raced app startup), refocus.
    const unShow = win.listen("quick-show", () => {
      setTitle("");
      shownAt.current = Date.now();
      api
        .listLabels()
        .then(setLabels)
        .catch(() => {});
      focusInput();
    });
    // Focus the input as soon as the window actually gains OS-level focus —
    // more reliable than a fixed delay, since `set_focus()` on the Rust side
    // can land after this component has already mounted. Dismiss on
    // click-away, ignoring the transient blur that can fire right as the
    // window is being shown.
    const unFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        focusInput();
      } else if (Date.now() - shownAt.current > 200) {
        dismiss();
      }
    });

    return () => {
      unShow.then((f) => f());
      unFocus.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class="quick-capture-stage">
      <form onSubmit={submit} class="quick-capture-card animate-fade-rise">
        <header class="quick-capture-header">
          <div>
            <Logo size={20} />
            <span>Quick capture</span>
          </div>
          <span>todofy</span>
        </header>
        <div class="quick-capture-input-row">
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
            placeholder="What needs doing?  Try “pay rent Friday 5pm”"
            class="quick-capture-input"
          />
          <button
            type="submit"
            disabled={!parsed.title.trim()}
            class="quick-capture-submit"
          >
            Add task <kbd>↵</kbd>
          </button>
        </div>

        {hasChips ? (
          <div class="quick-capture-footer">
            {parsed.priority !== null && (
              <Chip color={PRIORITY_COLOR[parsed.priority]}>
                <FlagIcon width={11} height={11} />P{parsed.priority}
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
            {parsed.repeat && (
              <Chip>
                <RepeatIcon width={11} height={11} />
                {repeatLabel(parsed.repeat)}
              </Chip>
            )}
            {parsed.labelNames.map((name) => {
              const color = labels.find((l) => l.name === name)?.color;
              return (
                <Chip key={name} color={color}>
                  <span
                    class="h-1.5 w-1.5 rounded-full"
                    style={{ background: color }}
                  />
                  {name}
                </Chip>
              );
            })}
          </div>
        ) : (
          <div class="quick-capture-footer">
            Add a date, time, <b>#label</b>, <b>p1</b>, or <b>every week</b> in
            plain language
            <span>
              <kbd>Esc</kbd> dismiss
            </span>
          </div>
        )}
      </form>
    </div>
  );
}

function Chip({
  color,
  children,
}: {
  color?: string;
  children: ComponentChildren;
}) {
  return (
    <span
      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        color
          ? { background: color + "22", color }
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
