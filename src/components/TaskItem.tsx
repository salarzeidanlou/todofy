import type { JSX } from "preact";
import { useStore } from "../store";
import { formatDue, formatReminder, isPast } from "../lib/dates";
import type { Task } from "../types";
import {
  BellIcon,
  CheckCircleIcon,
  CheckIcon,
  FlagIcon,
  GripIcon,
  HourglassIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  RepeatIcon,
  StopIcon,
  TimerIcon,
  TrashIcon,
} from "./Icons";
import { repeatLabel } from "../lib/repeat";
import { formatDuration, formatMinutes } from "../lib/duration";
import { overEstimateBy, trackedElapsed, trackingState } from "../lib/tracking";
import { useTick } from "../lib/useTick";

const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--color-prio-1)",
  2: "var(--color-prio-2)",
  3: "var(--color-prio-3)",
  4: "var(--color-prio-4)",
};

const DUE_TONE: Record<string, string> = {
  overdue: "is-overdue",
  today: "is-today",
  soon: "is-soon",
  future: "is-future",
};

interface DragProps {
  reorderable?: boolean;
  dragging?: boolean;
  dropEdge?: "top" | "bottom" | null;
  rowRef?: (element: HTMLElement | null) => void;
  onHandlePointerDown?: (event: JSX.TargetedPointerEvent<HTMLElement>) => void;
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
    pauseTaskTimer,
    resumeTaskTimer,
    stopTaskTimer,
  } = useStore();
  const done = task.status === "done";
  const selected = selectedId === task.id;
  const taskLabels = labels.filter((label) => task.labelIds.includes(label.id));
  // A completed task is never late, so its reminder no longer colours the date.
  const lateReminder = !done && isPast(task.remindAt);
  const due = task.dueDate ? formatDue(task.dueDate, done ? null : task.remindAt) : null;
  const subtaskTotal = task.subtasks.length;
  const subtaskDone = task.subtasks.filter((subtask) => subtask.done).length;
  const tracking = trackingState(task.id, activeTimer);
  // A paused clock doesn't move, so there's nothing to re-render for.
  useTick(tracking === "running");
  const elapsed = trackedElapsed(task, activeTimer);
  const over = overEstimateBy(task, elapsed);

  return (
    <article
      ref={drag?.rowRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => select(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(task.id);
        }
      }}
      class={`task-row ${selected ? "is-selected" : ""} ${done ? "is-done" : ""} ${drag?.dragging ? "is-dragging" : ""} ${tracking !== "off" ? "is-tracked" : ""}`}
    >
      {drag?.dropEdge && <span class={`drop-indicator is-${drag.dropEdge}`} />}
      {drag?.reorderable && (
        <span
          onPointerDown={drag.onHandlePointerDown}
          onClick={(event) => event.stopPropagation()}
          class="task-drag-handle"
          title="Drag to reorder"
        >
          <GripIcon width={16} height={16} />
        </span>
      )}

      <button
        type="button"
        class="task-complete"
        style={!done ? { borderColor: PRIORITY_COLOR[task.priority] } : undefined}
        title={done ? "Mark active" : "Complete"}
        onClick={(event) => {
          event.stopPropagation();
          toggleTask(task.id, !done);
        }}
      >
        {done && <CheckIcon width={12} height={12} stroke-width={3} />}
      </button>

      <div class="task-row-title">
        <p>{task.title}</p>
        {subtaskTotal > 0 && (
          <span title={`${subtaskDone} of ${subtaskTotal} steps done`}>
            <CheckCircleIcon width={13} height={13} />
            {subtaskDone}/{subtaskTotal}
          </span>
        )}
      </div>

      <div class="task-row-meta">
        {task.priority < 4 && (
          <span style={{ color: PRIORITY_COLOR[task.priority] }}>
            <FlagIcon width={13} height={13} />P{task.priority}
          </span>
        )}
        {due && <span class={DUE_TONE[due.tone]}>{due.label}</span>}
        {task.remindAt && (
          <span
            class={lateReminder ? "is-overdue" : ""}
            title={
              lateReminder
                ? `Reminder passed — ${formatReminder(task.remindAt)}`
                : formatReminder(task.remindAt)
            }
          >
            <BellIcon width={13} height={13} />{formatReminder(task.remindAt)}
          </span>
        )}
        {task.repeat && (
          <span title={`Repeats ${repeatLabel(task.repeat).toLowerCase()}`}>
            <RepeatIcon width={13} height={13} />{repeatLabel(task.repeat)}
          </span>
        )}
        {task.estimateMinutes !== null && (
          <span title={`Estimated ${formatMinutes(task.estimateMinutes)}`}>
            <HourglassIcon width={13} height={13} />{formatMinutes(task.estimateMinutes)}
          </span>
        )}
        {elapsed > 0 && (
          <span
            class={
              over > 0
                ? "is-over"
                : tracking === "running"
                  ? "is-tracking"
                  : tracking === "paused"
                    ? "is-held"
                    : ""
            }
            title={
              over > 0
                ? `${formatDuration(over)} over the ${formatMinutes(task.estimateMinutes ?? 0)} estimate`
                : tracking === "running"
                  ? "Tracking now"
                  : tracking === "paused"
                    ? "Paused — the clock is held"
                    : "Time tracked on this task"
            }
          >
            <TimerIcon width={13} height={13} />{formatDuration(elapsed)}
            {over > 0 ? ` (+${formatDuration(over)})` : tracking === "paused" ? " paused" : ""}
          </span>
        )}
        {taskLabels.map((label) => (
          <span key={label.id} class="task-label" style={{ color: label.color }}>
            <i style={{ background: label.color }} />{label.name}
          </span>
        ))}
      </div>

      <div class="task-row-actions">
        {!done && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (tracking === "off") startTaskTimer(task.id);
              else if (tracking === "running") pauseTaskTimer();
              else resumeTaskTimer();
            }}
            class={tracking === "running" ? "is-running" : tracking === "paused" ? "is-held" : ""}
            title={
              tracking === "running"
                ? "Pause tracking"
                : tracking === "paused"
                  ? "Resume tracking"
                  : "Start tracking time"
            }
          >
            {tracking === "running" ? (
              <PauseIcon width={15} height={15} />
            ) : (
              <PlayIcon width={15} height={15} />
            )}
          </button>
        )}
        {!done && tracking !== "off" && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              stopTaskTimer();
            }}
            class="is-running"
            title="Stop tracking and bank the time"
          >
            <StopIcon width={15} height={15} />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            patchTask({ id: task.id, pinned: !task.pinned });
          }}
          class={task.pinned ? "is-pinned" : ""}
          title={task.pinned ? "Unpin" : "Pin to top"}
        >
          <PinIcon width={15} height={15} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            requestConfirm({
              title: "Delete task?",
              message: `“${task.title}” will be permanently deleted.`,
              confirmLabel: "Delete",
              danger: true,
              onConfirm: () => removeTask(task.id),
            });
          }}
          title="Delete"
        >
          <TrashIcon width={15} height={15} />
        </button>
      </div>
    </article>
  );
}
