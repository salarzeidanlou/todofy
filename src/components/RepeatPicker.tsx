import { useEffect, useRef, useState } from "preact/hooks";
import type { RepeatRule } from "../types";
import { REPEAT_OPTIONS, repeatLabel } from "../lib/repeat";
import { RepeatIcon } from "./Icons";

interface Props {
  value: RepeatRule | null;
  onChange: (value: RepeatRule | null) => void;
  /** Show the current rule's label next to the icon (used in compact rows). */
  showLabel?: boolean;
  placement?: "top" | "bottom";
}

/** Themed recurrence dropdown — a native <select> popup can't be styled. */
export function RepeatPicker({ value, onChange, showLabel = false, placement = "bottom" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        title="Repeat"
        class={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)] ${
          value ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
        }`}
      >
        <RepeatIcon width={14} height={14} />
        {showLabel && <span>{repeatLabel(value)}</span>}
      </button>

      {open && (
        <div class={`absolute right-0 z-50 w-44 animate-fade-rise rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-1 shadow-xl shadow-black/40 ${placement === "top" ? "bottom-full mb-2" : "top-full mt-1"}`}>
          {REPEAT_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? "none"}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              class={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--color-surface-2)] ${
                opt.value === value
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              {opt.label}
              {opt.value === value && (
                <span class="ml-auto text-[var(--color-accent)]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
