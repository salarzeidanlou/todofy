import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardColumn, ColumnId } from "./board";
import { indexBetween } from "./ordering";

/** Where a dragged card would land: a column, and a slot within it. */
export interface DropTarget {
  column: ColumnId;
  index: number;
}

/** Pointer travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** How close to the board's edge the pointer must get to start auto-scrolling. */
const EDGE = 72;
const EDGE_SPEED = 14;

/**
 * Two-dimensional drag for the board: a card moves within its column or across
 * to another.
 *
 * Pointer events rather than HTML5 drag-and-drop, for the same reason as the
 * list (see `TaskSection`): on WebKitGTK the native `drop` frequently never
 * fires. The whole card is the handle, so a press only becomes a drag past
 * `DRAG_THRESHOLD` — anything shorter stays a click and selects the task.
 */
export function useBoardDrag(
  columns: BoardColumn[],
  onDrop: (id: string, column: ColumnId, boardIndex: number) => void,
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);

  // Live refs so the document-level listeners always read fresh values rather
  // than the ones captured when the drag started.
  const cards = useRef(new Map<string, HTMLElement>());
  const columnEls = useRef(new Map<ColumnId, HTMLElement>());
  const scroller = useRef<HTMLElement | null>(null);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const dragIdRef = useRef<string | null>(null);
  const overRef = useRef<DropTarget | null>(null);
  const draggingRef = useRef(false);
  const autoScroll = useRef(0);
  /** Detaches the in-flight drag's document listeners; null when idle. */
  const detachRef = useRef<(() => void) | null>(null);

  const setCardRef = (id: string) => (el: HTMLElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  };

  const setColumnRef = (id: ColumnId) => (el: HTMLElement | null) => {
    if (el) columnEls.current.set(id, el);
    else columnEls.current.delete(id);
  };

  const setScrollerRef = (el: HTMLElement | null) => {
    scroller.current = el;
  };

  /** The column under the pointer, or the nearest one horizontally. */
  const columnAt = (x: number): ColumnId | null => {
    let nearest: { id: ColumnId; distance: number } | null = null;
    for (const column of columnsRef.current) {
      const el = columnEls.current.get(column.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return column.id;
      const distance = x < r.left ? r.left - x : x - r.right;
      if (!nearest || distance < nearest.distance) {
        nearest = { id: column.id, distance };
      }
    }
    return nearest?.id ?? null;
  };

  /** Which slot in `column` the pointer sits at, ignoring the dragged card. */
  const slotAt = (column: ColumnId, y: number): number => {
    const target = columnsRef.current.find((c) => c.id === column);
    if (!target) return 0;
    const others = target.tasks.filter((t) => t.id !== dragIdRef.current);
    for (let i = 0; i < others.length; i++) {
      const el = cards.current.get(others[i].id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return others.length;
  };

  const stopAutoScroll = () => {
    if (autoScroll.current) cancelAnimationFrame(autoScroll.current);
    autoScroll.current = 0;
  };

  /** Pan the board while the pointer is held near either edge. */
  const runAutoScroll = (x: number) => {
    stopAutoScroll();
    const el = scroller.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const step =
      x < r.left + EDGE ? -EDGE_SPEED : x > r.right - EDGE ? EDGE_SPEED : 0;
    if (!step) return;
    const tick = () => {
      el.scrollLeft += step;
      autoScroll.current = requestAnimationFrame(tick);
    };
    autoScroll.current = requestAnimationFrame(tick);
  };

  const commit = () => {
    const id = dragIdRef.current;
    const target = overRef.current;
    const finish = () => {
      dragIdRef.current = null;
      overRef.current = null;
      draggingRef.current = false;
      stopAutoScroll();
      setDragId(null);
      setOver(null);
    };
    if (!id || !target) return finish();

    const column = columnsRef.current.find((c) => c.id === target.column);
    if (!column) return finish();
    const others = column.tasks.filter((t) => t.id !== id);
    onDrop(
      id,
      target.column,
      indexBetween(
        others[target.index - 1]?.boardIndex,
        others[target.index]?.boardIndex,
      ),
    );
    finish();
  };

  const startDrag =
    (id: string) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // A press that somehow arrives with a drag still in flight replaces it,
      // rather than stacking a second set of document listeners.
      detachRef.current?.();
      const originX = e.clientX;
      const originY = e.clientY;
      dragIdRef.current = id;
      overRef.current = null;
      draggingRef.current = false;

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) {
          const travelled =
            Math.abs(ev.clientX - originX) + Math.abs(ev.clientY - originY);
          if (travelled < DRAG_THRESHOLD) return;
          // Only now is this a drag: commit to it and suppress text selection.
          draggingRef.current = true;
          setDragId(id);
        }
        ev.preventDefault();
        const column = columnAt(ev.clientX);
        const target = column
          ? { column, index: slotAt(column, ev.clientY) }
          : null;
        overRef.current = target;
        setOver(target);
        runAutoScroll(ev.clientX);
      };

      const detach = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        detachRef.current = null;
      };

      const onUp = () => {
        detach();
        // Swallow the click the browser fires on release, so finishing a drag
        // on a card doesn't also open it.
        if (draggingRef.current) {
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

      const onCancel = () => {
        detach();
        dragIdRef.current = null;
        overRef.current = null;
        draggingRef.current = false;
        stopAutoScroll();
        setDragId(null);
        setOver(null);
      };

      detachRef.current = detach;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      // A cancelled pointer never fires pointerup, which would leave the
      // auto-scroll loop spinning against a detached board.
      document.addEventListener("pointercancel", onCancel);
    };

  // Leaving the board mid-drag would otherwise strand the scroll loop and
  // leave the document listeners bound to an unmounted component — they are
  // only torn down on pointerup, which never arrives once the board is gone.
  useEffect(
    () => () => {
      detachRef.current?.();
      stopAutoScroll();
    },
    [],
  );

  return { dragId, over, setCardRef, setColumnRef, setScrollerRef, startDrag };
}
