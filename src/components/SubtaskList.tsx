import { useState } from "preact/hooks";
import type { Subtask, Task } from "../types";
import { CheckIcon, CloseIcon, PlusIcon } from "./Icons";

/**
 * A checklist for breaking a task into smaller steps. Big, undividable tasks
 * are a common ADHD stumbling block; chunking them into concrete steps (with
 * visible progress) makes them easier to start and to keep momentum on.
 *
 * The whole list is owned by the parent task and persisted via `onChange`,
 * which replaces the array wholesale (mirroring how labels are patched).
 */
export function SubtaskList({
  task,
  onChange,
}: {
  task: Task;
  onChange: (subtasks: Subtask[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const subs = task.subtasks;
  const doneCount = subs.filter((s) => s.done).length;
  const nextId = () => (subs.length ? Math.max(...subs.map((s) => s.id)) : 0) + 1;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...subs, { id: nextId(), text, done: false }]);
    setDraft("");
  };
  const toggle = (id: number) =>
    onChange(subs.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  const remove = (id: number) => onChange(subs.filter((s) => s.id !== id));
  // Committing an empty edit removes the step, so a cleared field disappears.
  const edit = (id: number, value: string) => {
    const text = value.trim();
    if (!text) return remove(id);
    onChange(subs.map((s) => (s.id === id ? { ...s, text } : s)));
  };

  return (
    <div class="mt-4">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
          Checklist
        </p>
        {subs.length > 0 && (
          <span class="text-xs text-[var(--color-faint)]">
            {doneCount}/{subs.length}
          </span>
        )}
      </div>

      {subs.length > 0 && (
        <div class="mb-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            class="h-full rounded-full bg-[var(--color-success)] transition-[width]"
            style={{ width: `${(doneCount / subs.length) * 100}%` }}
          />
        </div>
      )}

      <div class="flex flex-col gap-0.5">
        {subs.map((s) => (
          <div key={s.id} class="group flex items-center gap-2">
            <button
              onClick={() => toggle(s.id)}
              class={`grid h-4 w-4 shrink-0 place-items-center rounded border-2 transition-colors ${
                s.done
                  ? "border-[var(--color-success)] bg-[var(--color-success)] text-white"
                  : "border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-accent)]"
              }`}
              title={s.done ? "Mark step incomplete" : "Mark step done"}
            >
              <CheckIcon width={10} height={10} stroke-width={3} />
            </button>
            <input
              key={s.id + ":" + s.text}
              defaultValue={s.text}
              onBlur={(e) => edit(s.id, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              class={`min-w-0 flex-1 bg-transparent text-sm outline-none ${
                s.done
                  ? "text-[var(--color-faint)] line-through"
                  : "text-[var(--color-text)]"
              }`}
            />
            <button
              onClick={() => remove(s.id)}
              class="shrink-0 text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
              title="Remove step"
            >
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>

      <div class="mt-1 flex items-center gap-2">
        <PlusIcon width={14} height={14} class="shrink-0 text-[var(--color-faint)]" />
        <input
          value={draft}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add a step…"
          class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)]"
        />
      </div>
    </div>
  );
}
