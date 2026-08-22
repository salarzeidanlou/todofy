import type { JSX } from "preact";
import { useStore } from "../store";
import { formatDue } from "../lib/dates";
import type { Task } from "../types";
import {
  BellIcon,
  CheckCircleIcon,
  CheckIcon,
  FlagIcon,
  GripIcon,
  PinIcon,
  PlayIcon,
  RepeatIcon,
  StopIcon,
  TimerIcon,
  TrashIcon,
} from "./Icons";
import { formatReminder } from "../lib/dates";
import { repeatLabel } from "../lib/repeat";
import { formatDuration } from "../lib/duration";

const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--color-prio-1)",
  2: "var(--color-prio-2)",
  3: "var(--color-prio-3)",
  4: "var(--color-prio-4)",
};

const DUE_TONE: Record<string, string> = {
  overdue: "text-[var(--color-danger)]",
  today: "text-[var(--color-success)]",
  soon: "text-[var(--color-accent)]",
  future: "text-[var(--color-muted)]",
};

interface DragProps {
  reorderable?: boolean;
  dragging?: boolean;
  dropEdge?: "top" | "bottom" | null;
  rowRef?: (el: HTMLElement | null) => void;
  onHandlePointerDown?: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
}

export function TaskItem({ task, drag }: { task: Task; drag?: DragProps }) {
  const {
    labels,
    toggleTask,
    removeTask,
    patchTask,
    select,
    selectedId,
    requestConfirm,
    activeTimer,
    startTaskTimer,
    stopTaskTimer,
  } = useStore();
  const done = task.status === "done";
  const selected = selectedId === task.id;
  const taskLabels = labels.filter((l) => task.labelIds.includes(l.id));
  const due = task.dueDate ? formatDue(task.dueDate) : null;
  const overdue = !done && due?.tone === "overdue";
  const hasReminder = !!task.remindAt;
  const repeats = !!task.repeat;
  const subtaskTotal = task.subtasks.length;
  const subtaskDone = task.subtasks.filter((s) => s.done).length;
  const allSubtasksDone = subtaskTotal > 0 && subtaskDone === subtaskTotal;
  const tracking = activeTimer?.taskId === task.id;
  const reorderable = !!drag?.reorderable;

  return (
    <div
      ref={drag?.rowRef}
      onClick={() => select(task.id)}
      class={`group relative flex animate-fade-rise cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        selected
          ? "border-[var(--color-border-strong)] bg-[var(--color-surface)]"
          : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]"
      } ${drag?.dragging ? "opacity-40" : ""}`}
    >
      {overdue && (
        <span
          class="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[var(--color-danger)]"
          title="Overdue"
        />
      )}
      {drag?.dropEdge === "top" && (
        <span class="pointer-events-none absolute -top-[3px] left-2 right-2 h-0.5 rounded-full bg-[var(--color-accent)]" />
      )}
      {drag?.dropEdge === "bottom" && (
        <span class="pointer-events-none absolute -bottom-[3px] left-2 right-2 h-0.5 rounded-full bg-[var(--color-accent)]" />
      )}
      {reorderable && (
        <span
          onPointerDown={drag?.onHandlePointerDown}
          onClick={(e) => e.stopPropagation()}
          class="mt-0.5 -ml-1 shrink-0 touch-none cursor-grab text-[var(--color-faint)] opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
          title="Drag to reorder"
        >
          <GripIcon width={14} height={14} />
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTask(task.id, !done);
        }}
        class={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors ${
          done
            ? "border-[var(--color-success)] bg-[var(--color-success)] text-white"
            : "text-transparent hover:border-[var(--color-accent)]"
        }`}
        style={!done ? { borderColor: PRIORITY_COLOR[task.priority] } : undefined}
        title={done ? "Mark active" : "Complete"}
      >
        <CheckIcon width={12} height={12} stroke-width={3} />
      </button>

      <div class="min-w-0 flex-1">
        <p
          class={`text-sm leading-snug ${
            done
              ? "text-[var(--color-faint)] line-through"
              : "text-[var(--color-text)]"
          }`}
        >
          {task.title}
        </p>
        {(due || hasReminder || repeats || subtaskTotal > 0 || task.trackedSeconds > 0 || task.priority < 4 || taskLabels.length > 0) && (
          <div class="mt-1 flex flex-wrap items-center gap-2">
            {subtaskTotal > 0 && (
              <span
                class={`inline-flex items-center gap-1 text-xs ${
                  allSubtasksDone
                    ? "text-[var(--color-success)]"
                    : "text-[var(--color-faint)]"
                }`}
                title={`${subtaskDone} of ${subtaskTotal} steps done`}
              >
                <CheckCircleIcon width={12} height={12} />
                {subtaskDone}/{subtaskTotal}
              </span>
            )}
            {task.priority < 4 && (
              <span
                class="inline-flex items-center gap-0.5 text-xs font-medium"
                style={{ color: PRIORITY_COLOR[task.priority] }}
                title={`Priority ${task.priority}`}
              >
                <FlagIcon width={12} height={12} />
                P{task.priority}
              </span>
            )}
            {due && (
              <span class={`text-xs font-medium ${DUE_TONE[due.tone]}`}>
                {due.label}
              </span>
            )}
            {hasReminder && (
              <span
                class="inline-flex items-center gap-1 text-xs text-[var(--color-faint)]"
                title={formatReminder(task.remindAt!)}
              >
                <BellIcon width={12} height={12} />
                {formatReminder(task.remindAt!)}
              </span>
            )}
            {repeats && (
              <span
                class="inline-flex items-center gap-1 text-xs text-[var(--color-faint)]"
                title={`Repeats ${repeatLabel(task.repeat).toLowerCase()}`}
              >
                <RepeatIcon width={12} height={12} />
                {repeatLabel(task.repeat)}
              </span>
            )}
            {task.trackedSeconds > 0 && (
              <span
                class="inline-flex items-center gap-1 text-xs text-[var(--color-faint)]"
                title="Time focused on this task"
              >
                <TimerIcon width={12} height={12} />
                {formatDuration(task.trackedSeconds)}
              </span>
            )}
            {taskLabels.map((l) => (
              <span
                key={l.id}
                class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]"
                style={{ background: l.color + "22", color: l.color }}
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  style={{ background: l.color }}
                />
                {l.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {!done && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            tracking ? stopTaskTimer() : startTaskTimer(task.id);
          }}
          class={`mt-0.5 shrink-0 transition-opacity ${
            tracking
              ? "text-[var(--color-danger)] opacity-100"
              : "text-[var(--color-faint)] opacity-0 hover:text-[var(--color-accent)] group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
          title={tracking ? "Stop tracking time" : "Start tracking time"}
        >
          {tracking ? <StopIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
        </button>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          patchTask({ id: task.id, pinned: !task.pinned });
        }}
        class={`mt-0.5 shrink-0 transition-opacity ${
          task.pinned
            ? "text-[var(--color-accent)] opacity-100"
            : "text-[var(--color-faint)] opacity-0 hover:text-[var(--color-text)] group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
        title={task.pinned ? "Unpin" : "Pin to top"}
      >
        <PinIcon width={14} height={14} />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          requestConfirm({
            title: "Delete task?",
            message: `“${task.title}” will be permanently deleted.`,
            confirmLabel: "Delete",
            danger: true,
            onConfirm: () => removeTask(task.id),
          });
        }}
        class="mt-0.5 text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100 group-focus-within:opacity-100"
        title="Delete"
      >
        <TrashIcon width={16} height={16} />
      </button>
    </div>
  );
}
