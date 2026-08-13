import { useEffect, useRef, useState } from "preact/hooks";
import { FlagIcon } from "./Icons";

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { value: 1, label: "Priority 1", color: "var(--color-prio-1)" },
  { value: 2, label: "Priority 2", color: "var(--color-prio-2)" },
  { value: 3, label: "Priority 3", color: "var(--color-prio-3)" },
  { value: 4, label: "Priority 4", color: "var(--color-prio-4)" },
];

interface Props {
  value: number;
  onChange: (value: number) => void;
}

/** Themed replacement for a native <select> — its popup can't be styled. */
export function PriorityPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[3];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} class="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
        title="Priority"
      >
        <FlagIcon width={14} height={14} style={{ color: current.color }} />
        P{current.value}
      </button>

      {open && (
        <div class="absolute right-0 z-50 mt-1 w-40 animate-fade-rise rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-1 shadow-xl shadow-black/40">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                onChange(p.value);
                setOpen(false);
              }}
              class={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--color-surface-2)] ${
                p.value === value
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              <FlagIcon width={14} height={14} style={{ color: p.color }} />
              {p.label}
              {p.value === value && (
                <span class="ml-auto text-[var(--color-accent)]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
