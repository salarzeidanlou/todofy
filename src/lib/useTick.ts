import { useEffect, useState } from "preact/hooks";

/**
 * Re-render once a second while `active`, for elapsed-time readouts.
 *
 * Timers are anchored to a start instant, so the value on screen is derived at
 * render time and needs nudging. Passing `false` tears the interval down, so
 * the many untracked task rows cost nothing.
 */
export function useTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}
