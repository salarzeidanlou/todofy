import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import type { Task } from "../types";
import { TaskItem } from "./TaskItem";

type Edge = "before" | "after";

/**
 * A list of task rows that can be reordered by dragging the grip handle.
 *
 * We drive this with pointer events rather than the HTML5 drag-and-drop API:
 * native DnD (`dragstart`/`dragover`/`drop`) is unreliable on WebKitGTK — the
 * drag visual starts but `drop` frequently never fires — so dropping was a
 * no-op inside the Tauri window. Pointer events behave consistently there.
 *
 * Drag state is local to the section, so reordering only ever happens within
 * it. The dropped task's new `orderIndex` is the midpoint between its
 * neighbours, so a reorder never has to renumber the whole list.
 */
export function TaskSection({
  tasks,
  reorderable,
}: {
  tasks: Task[];
  reorderable: boolean;
}) {
  const reorderTask = useStore((s) => s.reorderTask);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; edge: Edge } | null>(null);

  // Live refs so the document-level pointer listeners always read fresh values
  // instead of the values captured when the drag started.
  const rows = useRef(new Map<string, HTMLElement>());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const dragIdRef = useRef<string | null>(null);
  const overRef = useRef<{ id: string; edge: Edge } | null>(null);
  const movedRef = useRef(false);

  const setRow = (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  const commit = () => {
    const dId = dragIdRef.current;
    const ov = overRef.current;
    const finish = () => {
      dragIdRef.current = null;
      overRef.current = null;
      setDragId(null);
      setOver(null);
    };
    if (dId === null || !ov || dId === ov.id) return finish();

    // Position relative to the list with the dragged task removed.
    const rest = tasksRef.current.filter((t) => t.id !== dId);
    const targetPos = rest.findIndex((t) => t.id === ov.id);
    if (targetPos === -1) return finish();
    const insertAt = ov.edge === "before" ? targetPos : targetPos + 1;
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
    reorderTask(dId, newIndex);
    finish();
  };

  const startDrag =
    (id: string) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      if (!reorderable || e.button !== 0) return;
      // Stop the row's onClick (task selection) from firing on release, and
      // suppress text selection while dragging.
      e.preventDefault();
      e.stopPropagation();

      dragIdRef.current = id;
      overRef.current = null;
      movedRef.current = false;
      setDragId(id);
      setOver(null);

      const onMove = (ev: PointerEvent) => {
        movedRef.current = true;
        // Find the insertion point by comparing the pointer against each other
        // row's midpoint. Falls through to "after the last row" when the
        // pointer is below every candidate.
        let target: { id: string; edge: Edge } | null = null;
        const others = tasksRef.current.filter(
          (t) => t.id !== dragIdRef.current,
        );
        for (const t of others) {
          const el = rows.current.get(t.id);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            target = { id: t.id, edge: "before" };
            break;
          }
        }
        if (!target && others.length) {
          target = { id: others[others.length - 1].id, edge: "after" };
        }
        overRef.current = target;
        setOver(target);
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        // If a real drag happened, swallow the click that the browser fires on
        // release so it doesn't open the task detail panel.
        if (movedRef.current) {
          const cancelClick = (ce: MouseEvent) => {
            ce.stopPropagation();
            ce.preventDefault();
          };
          document.addEventListener("click", cancelClick, {
            capture: true,
            once: true,
          });
          setTimeout(
            () =>
              document.removeEventListener("click", cancelClick, {
                capture: true,
              }),
            120,
          );
        }
        commit();
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
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
                  rowRef: setRow(t.id),
                  onHandlePointerDown: startDrag(t.id),
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
