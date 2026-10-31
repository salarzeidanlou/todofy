import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import { priorityTag, PRIORITY_VALUES, profileFor } from "../lib/priority";
import { FlagIcon } from "./Icons";

interface Props {
  value: number;
  onChange: (value: number) => void;
  placement?: "top" | "bottom";
}

/** Themed replacement for a native <select> — its popup can't be styled. */
export function PriorityPicker({
  value,
  onChange,
  placement = "bottom",
}: Props) {
  const profiles = useStore((s) => s.priorityProfiles);
  const setView = useStore((s) => s.setView);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = profileFor(value, profiles);

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
        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface-2"
        title="Priority"
      >
        <FlagIcon width={14} height={14} style={{ color: current.color }} />
        {priorityTag(current.priority, profiles)}
      </button>

      {open && (
        <div
          class={`absolute right-0 z-50 w-40 animate-fade-rise rounded-lg border border-border-strong bg-elevated p-1 shadow-xl shadow-black/40 ${placement === "top" ? "bottom-full mb-2" : "top-full mt-1"}`}
        >
          {PRIORITY_VALUES.map((priority) => {
            const profile = profileFor(priority, profiles);
            return (
              <button
                key={priority}
                type="button"
                onClick={() => {
                  onChange(priority);
                  setOpen(false);
                }}
                class={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-2 ${
                  priority === current.priority ? "text-text" : "text-muted"
                }`}
              >
                <FlagIcon
                  width={14}
                  height={14}
                  style={{ color: profile.color }}
                />
                <span class="truncate">{profile.name}</span>
                {priority === current.priority && (
                  <span class="ml-auto text-(--color-accent)">✓</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setView({ kind: "settings" });
            }}
            class="mt-1 flex w-full items-center rounded-md border-t border-border px-2 py-1.5 text-xs text-faint transition-colors hover:bg-surface-2 hover:text-muted"
          >
            Rename or recolor…
          </button>
        </div>
      )}
    </div>
  );
}
