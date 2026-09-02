import type { JSX } from "preact";
import { useStore } from "../store";
import { formatDue, formatReminder } from "../lib/dates";
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
import { repeatLabel } from "../lib/repeat";
import { formatDuration } from "../lib/duration";

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
    stopTaskTimer,
  } = useStore();
  const done = task.status === "done";
  const selected = selectedId === task.id;
  const taskLabels = labels.filter((label) => task.labelIds.includes(label.id));
  const due = task.dueDate ? formatDue(task.dueDate) : null;
  const subtaskTotal = task.subtasks.length;
  const subtaskDone = task.subtasks.filter((subtask) => subtask.done).length;
  const tracking = activeTimer?.taskId === task.id;

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
      class={`task-row ${selected ? "is-selected" : ""} ${done ? "is-done" : ""} ${drag?.dragging ? "is-dragging" : ""}`}
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
          <span title={formatReminder(task.remindAt)}>
            <BellIcon width={13} height={13} />{formatReminder(task.remindAt)}
          </span>
        )}
        {task.repeat && (
          <span title={`Repeats ${repeatLabel(task.repeat).toLowerCase()}`}>
            <RepeatIcon width={13} height={13} />{repeatLabel(task.repeat)}
          </span>
        )}
        {task.trackedSeconds > 0 && (
          <span title="Time focused on this task">
            <TimerIcon width={13} height={13} />{formatDuration(task.trackedSeconds)}
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
              tracking ? stopTaskTimer() : startTaskTimer(task.id);
            }}
            class={tracking ? "is-running" : ""}
            title={tracking ? "Stop tracking time" : "Start tracking time"}
          >
            {tracking ? <StopIcon width={15} height={15} /> : <PlayIcon width={15} height={15} />}
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
