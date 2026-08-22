import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";

const COLORS = ["#6c7cff", "#4fd18b", "#f2b155", "#f2555a", "#7d8bff"];

interface Piece {
  id: number;
  color: string;
  dx: string;
  dy: string;
  rot: string;
}

/**
 * A brief confetti burst when a task is completed — a small dopamine reward to
 * reinforce follow-through. Honors the "celebrate" preference (gated upstream
 * in the store) and the OS reduced-motion setting (checked here).
 */
export function Celebration() {
  const at = useStore((s) => s.celebrationAt);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (at == null || at === seen.current) return;
    seen.current = at;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const next: Piece[] = Array.from({ length: 16 }, (_, i) => ({
      id: at + i,
      color: COLORS[i % COLORS.length],
      dx: `${Math.round((Math.random() - 0.5) * 320)}px`,
      dy: `${Math.round(60 + Math.random() * 220)}px`,
      rot: `${Math.round((Math.random() - 0.5) * 720)}deg`,
    }));
    setPieces(next);
    const timer = setTimeout(() => setPieces([]), 1000);
    return () => clearTimeout(timer);
  }, [at]);

  if (pieces.length === 0) return null;

  return (
    <div class="pointer-events-none absolute inset-0 z-[60] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          class="animate-confetti absolute left-1/2 top-1/4 h-2 w-2 rounded-[1px]"
          style={{
            background: p.color,
            // Consumed by the `confetti` keyframes in global.css.
            "--dx": p.dx,
            "--dy": p.dy,
            "--rot": p.rot,
          } as any}
        />
      ))}
    </div>
  );
}
