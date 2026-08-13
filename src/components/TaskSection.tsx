import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { useStore } from "../store";
import type { Task } from "../types";
import { TaskItem } from "./TaskItem";

type Edge = "before" | "after";

/**
 * A list of task rows that can be reordered by dragging. Drag state is local
 * to the section, so drops only ever reorder within it — dropping onto another
 * section is a no-op (that section has no active drag). The dropped task's new
 * `orderIndex` is the midpoint between its neighbors, so reordering never has
 * to renumber the whole list.
 */
export function TaskSection({
  tasks,
  reorderable,
}: {
  tasks: Task[];
  reorderable: boolean;
}) {
  const reorderTask = useStore((s) => s.reorderTask);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; edge: Edge } | null>(null);

  const clear = () => {
    setDragId(null);
    setOver(null);
  };

  const commit = () => {
    if (dragId == null || !over || dragId === over.id) return clear();
    // Position relative to the list with the dragged task removed.
    const rest = tasks.filter((t) => t.id !== dragId);
    const targetPos = rest.findIndex((t) => t.id === over.id);
    if (targetPos === -1) return clear();
    const insertAt = over.edge === "before" ? targetPos : targetPos + 1;
    const before = rest[insertAt - 1];
    const after = rest[insertAt];
    const newIndex =
      before && after
        ? (before.orderIndex + after.orderIndex) / 2
        : before
          ? before.orderIndex + 1
          : after
            ? after.orderIndex - 1
            : 0;
    reorderTask(dragId, newIndex);
    clear();
  };

  return (
    <div class="flex flex-col gap-0.5">
      {tasks.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          drag={
            reorderable
              ? {
                  reorderable: true,
                  dragging: dragId === t.id,
                  dropEdge:
                    over && over.id === t.id && dragId !== t.id
                      ? over.edge === "before"
                        ? "top"
                        : "bottom"
                      : null,
                  onDragStart: (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
                    setDragId(t.id);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                  },
                  onDragOver: (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
                    if (dragId == null || dragId === t.id) return;
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                    const r = e.currentTarget.getBoundingClientRect();
                    const edge: Edge =
                      e.clientY < r.top + r.height / 2 ? "before" : "after";
                    if (over?.id !== t.id || over.edge !== edge)
                      setOver({ id: t.id, edge });
                  },
                  onDrop: (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    commit();
                  },
                  onDragEnd: clear,
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
