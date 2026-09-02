import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useStore } from "../store";
import { combineDateTime, formatDue, timeOf, today } from "../lib/dates";
import type { RepeatRule, Subtask } from "../types";
import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
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
import { SubtaskList } from "./SubtaskList";
import { formatDuration } from "../lib/duration";

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { value: 1, label: "P1", color: "var(--color-prio-1)" },
  { value: 2, label: "P2", color: "var(--color-prio-2)" },
  { value: 3, label: "P3", color: "var(--color-prio-3)" },
  { value: 4, label: "P4", color: "var(--color-prio-4)" },
];

export function TaskDetail({ taskId }: { taskId?: string }) {
  const {
    tasks,
    labels,
    selectedId,
    patchTask,
    removeTask,
    toggleTask,
    snoozeTask,
    requestConfirm,
    activeTimer,
    startTaskTimer,
    stopTaskTimer,
  } = useStore();
  const task = tasks.find((item) => item.id === (taskId ?? selectedId));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setExpanded(false);
  }, [task?.id]);

  if (!task) return null;
  const done = task.status === "done";
  const tracking = activeTimer?.taskId === task.id;
  const nextStep = task.subtasks.find((subtask) => !subtask.done);
  const completedSteps = task.subtasks.filter((subtask) => subtask.done).length;
  const due = task.dueDate ? formatDue(task.dueDate) : null;

  const saveTitle = () => {
    const value = title.trim();
    if (value && value !== task.title) patchTask({ id: task.id, title: value });
    else if (!value) setTitle(task.title);
  };
  const saveNotes = () => {
    if (notes !== (task.notes ?? "")) patchTask({ id: task.id, notes: notes || null });
  };
  const onDate = (value: string | null) => {
    if (!value) return patchTask({ id: task.id, dueDate: null, remindAt: null });
    patchTask({
      id: task.id,
      dueDate: value,
      remindAt: task.remindAt ? combineDateTime(value, timeOf(task.remindAt)) : null,
    });
  };
  const onTime = (value: string | null) => {
    const base = task.dueDate ?? today();
    patchTask({
      id: task.id,
      dueDate: base,
      remindAt: value ? combineDateTime(base, value) : null,
    });
  };
  const onRepeat = (rule: RepeatRule | null) =>
    patchTask(
      rule && !task.dueDate
        ? { id: task.id, repeat: rule, dueDate: today() }
        : { id: task.id, repeat: rule },
    );
  const onSubtasks = (subtasks: Subtask[]) => patchTask({ id: task.id, subtasks });
  const toggleNextStep = () => {
    if (!nextStep) return;
    onSubtasks(
      task.subtasks.map((subtask) =>
        subtask.id === nextStep.id ? { ...subtask, done: true } : subtask,
      ),
    );
  };

  return (
    <section class={`next-up-card ${done ? "is-done" : ""}`}>
      <div class="next-up-accent" style={{ background: PRIORITIES[task.priority - 1].color }} />
      <div class="next-up-body">
        <div class="next-up-header">
          <button
            type="button"
            class="next-up-complete"
            onClick={() => toggleTask(task.id, !done)}
            style={!done ? { borderColor: PRIORITIES[task.priority - 1].color } : undefined}
            title={done ? "Mark active" : "Complete"}
          >
            {done && <CheckIcon width={14} height={14} stroke-width={3} />}
          </button>
          <div class="next-up-copy">
            <input
              id="detail-title"
              value={title}
              onInput={(event) => setTitle(event.currentTarget.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              aria-label="Task title"
            />
            <div class="inline-note">
              <NoteIcon width={15} height={15} />
              <input
                value={notes}
                onInput={(event) => setNotes(event.currentTarget.value)}
                onBlur={saveNotes}
                placeholder="Add a short note…"
                aria-label="Task notes"
              />
            </div>
          </div>
          <button
            type="button"
            class={`begin-session ${tracking ? "is-running" : ""}`}
            onClick={() => (tracking ? stopTaskTimer() : startTaskTimer(task.id))}
          >
            {tracking ? <StopIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
            {tracking ? "Stop focus" : "Begin 15 min"}
          </button>
        </div>

        <div class="next-up-meta">
          <span style={{ color: PRIORITIES[task.priority - 1].color }}>
            <FlagIcon width={14} height={14} />P{task.priority}
          </span>
          {due && <span class={due.tone}><CalendarIcon width={14} height={14} />{due.label}</span>}
          {task.remindAt && <span><TimerIcon width={14} height={14} />{timeOf(task.remindAt)}</span>}
          {task.trackedSeconds > 0 && (
            <span><TimerIcon width={14} height={14} />{formatDuration(task.trackedSeconds)} focused</span>
          )}
          {labels
            .filter((label) => task.labelIds.includes(label.id))
            .map((label) => (
              <span key={label.id} style={{ color: label.color }}>
                <i style={{ background: label.color }} />{label.name}
              </span>
            ))}
          <button
            type="button"
            class={task.pinned ? "is-pinned" : ""}
            onClick={() => patchTask({ id: task.id, pinned: !task.pinned })}
          >
            <PinIcon width={14} height={14} />{task.pinned ? "Pinned" : "Pin"}
          </button>
        </div>

        <div class="next-step-row">
          <div>
            <p>Next step</p>
            {nextStep ? (
              <button type="button" onClick={toggleNextStep}>
                <span><CheckIcon width={12} height={12} /></span>
                {nextStep.text}
              </button>
            ) : (
              <small>{task.subtasks.length ? "All checklist steps are complete." : "Add a first step to make this easier to start."}</small>
            )}
          </div>
          {task.subtasks.length > 0 && (
            <span>{completedSteps}/{task.subtasks.length} complete</span>
          )}
          <button
            type="button"
            class="more-details"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "Less" : "More details"}
            <ChevronRightIcon width={14} height={14} class={expanded ? "rotate-90" : ""} />
          </button>
        </div>

        {expanded && (
          <div class="expanded-task-details">
            <SubtaskList task={task} onChange={onSubtasks} />
            <div class="detail-fields">
              <DetailField icon={<CalendarIcon width={16} height={16} />} label="Schedule">
                <DatePicker
                  value={task.dueDate}
                  onChange={onDate}
                  time={timeOf(task.remindAt)}
                  onTimeChange={onTime}
                  reminderAt={task.remindAt}
                  onSnooze={(minutes) => snoozeTask(task.id, minutes)}
                />
              </DetailField>
              <DetailField icon={<RepeatIcon width={16} height={16} />} label="Repeat">
                <RepeatPicker value={task.repeat} onChange={onRepeat} showLabel />
              </DetailField>
              <DetailField icon={<FlagIcon width={16} height={16} />} label="Priority">
                <div class="priority-inline">
                  {PRIORITIES.map((priority) => (
                    <button
                      type="button"
                      key={priority.value}
                      onClick={() => patchTask({ id: task.id, priority: priority.value })}
                      class={task.priority === priority.value ? "is-active" : ""}
                      style={task.priority === priority.value ? { background: priority.color } : undefined}
                    >
                      {priority.label}
                    </button>
                  ))}
                </div>
              </DetailField>
            </div>
            <div class="detail-labels">
              <p>Labels</p>
              {labels.map((label) => {
                const active = task.labelIds.includes(label.id);
                return (
                  <button
                    type="button"
                    key={label.id}
                    onClick={() =>
                      patchTask({
                        id: task.id,
                        labelIds: active
                          ? task.labelIds.filter((id) => id !== label.id)
                          : [...task.labelIds, label.id],
                      })
                    }
                    class={active ? "is-active" : ""}
                    style={{ color: label.color }}
                  >
                    <i style={{ background: label.color }} />{label.name}
                  </button>
                );
              })}
            </div>
            <div class="detail-footer">
              <small>Created {new Date(task.createdAt).toLocaleDateString()}</small>
              <button
                type="button"
                onClick={() =>
                  requestConfirm({
                    title: "Delete task?",
                    message: `“${task.title}” will be permanently deleted.`,
                    confirmLabel: "Delete",
                    danger: true,
                    onConfirm: () => removeTask(task.id),
                  })
                }
              >
                <TrashIcon width={14} height={14} />Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DetailField({
  icon,
  label,
  children,
}: {
  icon: ComponentChildren;
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="detail-field">
      <span>{icon}{label}</span>
      {children}
    </div>
  );
}
