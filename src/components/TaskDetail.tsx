import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import { combineDateTime, timeOf, today } from "../lib/dates";
import type { RepeatRule } from "../types";
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  FlagIcon,
  NoteIcon,
  PinIcon,
  PlayIcon,
  RepeatIcon,
  StopIcon,
  TimerIcon,
  TrashIcon,
} from "./Icons";
import { DatePicker } from "./DatePicker";
import { RepeatPicker } from "./RepeatPicker";
import { formatDuration } from "../lib/duration";

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { value: 1, label: "P1", color: "var(--color-prio-1)" },
  { value: 2, label: "P2", color: "var(--color-prio-2)" },
  { value: 3, label: "P3", color: "var(--color-prio-3)" },
  { value: 4, label: "P4", color: "var(--color-prio-4)" },
];

export function TaskDetail() {
  const {
    tasks,
    labels,
    selectedId,
    select,
    patchTask,
    removeTask,
    toggleTask,
    snoozeTask,
    requestConfirm,
    activeTimer,
    startTaskTimer,
    stopTaskTimer,
  } = useStore();
  const task = tasks.find((t) => t.id === selectedId);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? "");
    }
    // Re-sync local edit state only when switching tasks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // Keep the title textarea sized to its content.
  useEffect(() => {
    if (titleRef.current) grow(titleRef.current);
  }, [title]);

  if (!task) return null;
  const done = task.status === "done";
  const tracking = activeTimer?.taskId === task.id;

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== task.title) patchTask({ id: task.id, title: t });
    else if (!t) setTitle(task.title);
  };
  const saveNotes = () => {
    if (notes !== (task.notes ?? ""))
      patchTask({ id: task.id, notes: notes || null });
  };
  const toggleLabel = (lid: number) => {
    const has = task.labelIds.includes(lid);
    const next = has
      ? task.labelIds.filter((x) => x !== lid)
      : [...task.labelIds, lid];
    patchTask({ id: task.id, labelIds: next });
  };
  // Schedule = a due date plus an optional reminder time on that date.
  const onDate = (v: string | null) => {
    if (!v) return patchTask({ id: task.id, dueDate: null, remindAt: null });
    const rt = task.remindAt ? combineDateTime(v, timeOf(task.remindAt)) : null;
    patchTask({ id: task.id, dueDate: v, remindAt: rt });
  };
  const onTime = (t: string | null) => {
    const base = task.dueDate ?? today();
    patchTask({
      id: task.id,
      dueDate: base,
      remindAt: t ? combineDateTime(base, t) : null,
    });
  };
  // A recurrence needs a due date to advance from; anchor to today if unset.
  const onRepeat = (rule: RepeatRule | null) =>
    patchTask(
      rule && !task.dueDate
        ? { id: task.id, repeat: rule, dueDate: today() }
        : { id: task.id, repeat: rule },
    );

  return (
    <aside class="absolute inset-y-0 right-0 z-40 flex w-[340px] animate-slide-left flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl shadow-black/20">
      {/* Header */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <button
          onClick={() => toggleTask(task.id, !done)}
          class={`group flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            done
              ? "text-[var(--color-success)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <span
            class={`grid h-4 w-4 place-items-center rounded-full border-2 transition-colors ${
              done
                ? "border-[var(--color-success)] bg-[var(--color-success)] text-white"
                : "border-current text-current opacity-60 group-hover:opacity-100"
            }`}
          >
            <CheckIcon width={10} height={10} stroke-width={3} />
          </span>
          {done ? "Completed" : "Mark complete"}
        </button>
        <div class="flex items-center gap-1">
          <button
            onClick={() => patchTask({ id: task.id, pinned: !task.pinned })}
            class={`rounded-md p-1.5 transition-colors ${
              task.pinned
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            }`}
            title={task.pinned ? "Unpin" : "Pin to top"}
          >
            <PinIcon width={16} height={16} />
          </button>
          <button
            onClick={() => select(null)}
            class="rounded-md p-1 text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            title="Close"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-4">
        {/* Title */}
        <textarea
          id="detail-title"
          ref={titleRef}
          value={title}
          rows={1}
          onInput={(e) => {
            setTitle(e.currentTarget.value);
            grow(e.currentTarget);
          }}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
          class={`w-full resize-none overflow-hidden bg-transparent text-lg font-semibold leading-snug outline-none ${
            done ? "text-[var(--color-faint)] line-through" : ""
          }`}
        />

        {/* Notes */}
        <div class="mt-2 flex gap-2">
          <NoteIcon
            width={16}
            height={16}
            class="mt-1 shrink-0 text-[var(--color-faint)]"
          />
          <textarea
            value={notes}
            rows={3}
            onInput={(e) => setNotes(e.currentTarget.value)}
            onBlur={saveNotes}
            placeholder="Add notes…"
            class="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--color-muted)] outline-none placeholder:text-[var(--color-faint)]"
          />
        </div>

        <hr class="my-4 border-[var(--color-border)]" />

        {/* Schedule (date + reminder time) */}
        <Field icon={<CalendarIcon width={16} height={16} />} label="Schedule">
          <DatePicker
            value={task.dueDate}
            onChange={onDate}
            time={timeOf(task.remindAt)}
            onTimeChange={onTime}
            reminderAt={task.remindAt}
            onSnooze={(min) => snoozeTask(task.id, min)}
          />
        </Field>

        {/* Repeat */}
        <Field icon={<RepeatIcon width={16} height={16} />} label="Repeat">
          <RepeatPicker value={task.repeat} onChange={onRepeat} showLabel />
        </Field>

        {/* Priority */}
        <Field icon={<FlagIcon width={16} height={16} />} label="Priority">
          <div class="flex gap-1">
            {PRIORITIES.map((p) => {
              const active = task.priority === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() => patchTask({ id: task.id, priority: p.value })}
                  class={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "text-white"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
                  }`}
                  style={active ? { background: p.color } : undefined}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Focus time */}
        <Field icon={<TimerIcon width={16} height={16} />} label="Focus">
          <div class="flex items-center gap-2">
            <button
              onClick={() => (tracking ? stopTaskTimer() : startTaskTimer(task.id))}
              class={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                tracking
                  ? "bg-[var(--color-danger)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {tracking ? (
                <StopIcon width={12} height={12} />
              ) : (
                <PlayIcon width={12} height={12} />
              )}
              {tracking ? "Stop" : "Start"}
            </button>
            <span class="text-xs text-[var(--color-faint)]">
              {task.trackedSeconds > 0
                ? `${formatDuration(task.trackedSeconds)} focused`
                : "Not tracked yet"}
            </span>
          </div>
        </Field>

        {/* Labels */}
        <div class="mt-4">
          <p class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
            Labels
          </p>
          {labels.length === 0 ? (
            <p class="text-xs text-[var(--color-faint)]">
              Create labels in the sidebar first.
            </p>
          ) : (
            <div class="flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const active = task.labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l.id)}
                    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors"
                    style={{
                      borderColor: active ? l.color : "var(--color-border)",
                      background: active ? l.color + "22" : "transparent",
                      color: active ? l.color : "var(--color-muted)",
                    }}
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      style={{ background: l.color }}
                    />
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div class="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
        <span class="text-xs text-[var(--color-faint)]">
          Created {new Date(task.createdAt).toLocaleDateString()}
        </span>
        <button
          onClick={() =>
            requestConfirm({
              title: "Delete task?",
              message: `“${task.title}” will be permanently deleted.`,
              confirmLabel: "Delete",
              danger: true,
              onConfirm: () => removeTask(task.id),
            })
          }
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
        >
          <TrashIcon width={14} height={14} />
          Delete
        </button>
      </div>
    </aside>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: ComponentChildren;
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="mb-3 flex items-center gap-3">
      <span class="flex w-24 shrink-0 items-center gap-2 text-sm text-[var(--color-muted)]">
        <span class="text-[var(--color-faint)]">{icon}</span>
        {label}
      </span>
      {children}
    </div>
  );
}
