import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { DONE_COLUMN } from "./board";

/** Pointer-based column ordering works in WebKitGTK, where native DnD is unreliable. */
export function useColumnReorder(ids: string[], onReorder: (ids: string[]) => void) {
  const [overId, setOverId] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const current = useRef(ids);
  current.current = ids;
  const callback = useRef(onReorder);
  callback.current = onReorder;
  const detach = useRef<(() => void) | null>(null);
  const setRowRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el); else rows.current.delete(id);
  };
  const start = (id: string) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || id === DONE_COLUMN) return;
    event.preventDefault();
    detach.current?.();
    const origin = event.clientY;
    let target: string | null = null;
    let after = false;
    const finish = () => { detach.current?.(); setOverId(null); };
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientY - origin) < 4 && !target) return;
      e.preventDefault();
      const candidates = current.current.filter((key) => key !== id && key !== DONE_COLUMN);
      let nearest: { id: string; distance: number; center: number } | null = null;
      for (const key of candidates) {
        const rect = rows.current.get(key)?.getBoundingClientRect();
        if (!rect) continue;
        const center = rect.top + rect.height / 2;
        const distance = Math.abs(e.clientY - center);
        if (!nearest || distance < nearest.distance) nearest = { id: key, distance, center };
      }
      target = nearest?.id ?? null;
      after = !!nearest && e.clientY >= nearest.center;
      setOverId(target);
    };
    const up = () => {
      if (target && current.current.includes(id) && current.current.includes(target)) {
        const next = current.current.filter((key) => key !== id);
        next.splice(next.indexOf(target) + Number(after), 0, id);
        if (next.some((key, i) => key !== current.current[i])) callback.current(next);
      }
      finish();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", finish);
    detach.current = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", finish);
      detach.current = null;
    };
  };
  useEffect(() => () => detach.current?.(), []);
  return { start, setRowRef, overId };
}
