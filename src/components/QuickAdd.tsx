import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useStore } from "../store";
import {
  combineDateTime,
  formatDue,
  formatTime,
  toLocalDate,
  today,
} from "../lib/dates";
import { parseQuickAdd } from "../lib/nlp";
import type { NewTask, ViewId } from "../types";
import { BellIcon, CalendarIcon, FlagIcon, PlusIcon } from "./Icons";
import { DatePicker } from "./DatePicker";
import { PriorityPicker } from "./PriorityPicker";

const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--color-prio-1)",
  2: "var(--color-prio-2)",
  3: "var(--color-prio-3)",
  4: "var(--color-prio-4)",
};

/** Default due date so a new task lands in the view you're looking at. */
function defaultDue(view: ViewId): string {
  if (view.kind === "today") return today();
  if (view.kind === "upcoming") return toLocalDate(new Date(Date.now() + 86400000));
  return "";
}

export function QuickAdd() {
  const { view, labels, addTask } = useStore();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => defaultDue(view));
  const [time, setTime] = useState<string | null>(null);
  const [priority, setPriority] = useState(4);
  const [focused, setFocused] = useState(false);

  // When you switch views, pre-fill the date so the task shows up there.
  useEffect(() => setDue(defaultDue(view)), [view]);

  // Live natural-language parse for the preview chips ("friday 5pm", "#home"…).
  const parsed = useMemo(() => parseQuickAdd(title, labels), [title, labels]);
  const hasChips =
    !!parsed.dueDate || !!parsed.time || parsed.priority !== null || parsed.labelNames.length > 0;

  const submit = async (e: Event) => {
    e.preventDefault();
    // Natural-language tokens win over the manual pickers when present.
    const finalTitle = parsed.title.trim();
    if (!finalTitle) return;

    const finalTime = parsed.time ?? time;
    const dateFromInput = parsed.dueDate ?? due;
    // A time needs a date to live on — default to today.
    const finalDue = dateFromInput || (finalTime ? today() : "");

    const task: NewTask = { title: finalTitle, priority: parsed.priority ?? priority };
    if (finalDue) task.dueDate = finalDue;
    // A time turns into a reminder the scheduler will notify on.
    if (finalDue && finalTime) task.remindAt = combineDateTime(finalDue, finalTime);

    const labelIds = new Set(parsed.labelIds);
    if (view.kind === "label") labelIds.add(view.labelId);
    if (labelIds.size) task.labelIds = [...labelIds];

    await addTask(task);
    setTitle("");
    setDue(defaultDue(view));
    setTime(null);
    setPriority(4);
  };

  return (
    <form
      onSubmit={submit}
      class={`flex flex-col rounded-xl border bg-[var(--color-surface)] px-3 py-2.5 transition-colors ${
        focused ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
      }`}
    >
      <div class="flex items-center gap-2">
        <PlusIcon width={18} height={18} class="text-[var(--color-faint)]" />
        <input
          id="quick-add-input"
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Add a task…  try “pay rent friday 5pm”"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)]"
        />
        <PriorityPicker value={priority} onChange={setPriority} />
        <DatePicker
          value={due || null}
          onChange={(v) => setDue(v ?? "")}
          time={time}
          onTimeChange={setTime}
        />
        <button
          type="submit"
          disabled={!parsed.title.trim()}
          class="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {hasChips && (
        <div class="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
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
      )}
    </form>
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
          : { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
      }
    >
      {children}
    </span>
  );
}
