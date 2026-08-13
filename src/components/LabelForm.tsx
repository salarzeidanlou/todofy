import { useState } from "preact/hooks";
import { CheckIcon } from "./Icons";

export const PALETTE = [
  "#f2555a", // red
  "#f2795a", // orange-red
  "#f2b155", // orange
  "#f2d55a", // yellow
  "#a8d15a", // lime
  "#4fd18b", // green
  "#38d1b1", // teal
  "#38bdf8", // sky
  "#5a9df2", // blue
  "#6c7cff", // indigo
  "#8c6cff", // violet
  "#c97bff", // purple
  "#f26cc9", // pink
  "#f26c8f", // rose
  "#a3aab8", // slate
  "#6b7280", // graphite
];

/** Normalize a 3- or 6-digit hex string (with or without `#`) to `#rrggbb`. */
function normalizeHex(value: string): string | null {
  const s = value.trim();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/**
 * Shared inline editor for creating and renaming labels: a preset swatch
 * grid plus a custom hex input, both custom-built (no native
 * `<input type="color">`, which WebKitGTK renders unthemed).
 */
export function LabelForm({
  initialName = "",
  initialColor = PALETTE[0],
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  initialColor?: string;
  onSubmit: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor.replace("#", ""));

  const pickPreset = (c: string) => {
    setColor(c);
    setHexInput(c.replace("#", ""));
  };

  const editHex = (value: string) => {
    const cleaned = value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    setHexInput(cleaned);
    const hex = normalizeHex(cleaned);
    if (hex) setColor(hex);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim(), color);
      }}
      class="flex animate-fade-rise flex-col gap-3.5 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-3.5 shadow-lg shadow-black/30"
    >
      <input
        autoFocus
        value={name}
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Label name"
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--color-accent)]"
      />

      <div class="flex flex-col gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          Color
        </span>

        <div class="grid grid-cols-8 gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pickPreset(c)}
              title={c}
              class="grid h-6 w-6 place-items-center rounded-full transition-transform duration-150 hover:scale-110"
              style={{
                background: c,
                boxShadow:
                  color === c
                    ? `0 0 0 2px var(--color-elevated), 0 0 0 4px ${c}`
                    : undefined,
              }}
            >
              {color === c && (
                <CheckIcon
                  width={11}
                  height={11}
                  stroke-width={3}
                  class="text-white"
                />
              )}
            </button>
          ))}
        </div>

        <div class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 transition-colors focus-within:border-[var(--color-accent)]">
          <span
            class="h-6 w-6 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)]"
            style={{ background: color }}
          />
          <span class="text-sm text-[var(--color-faint)]">#</span>
          <input
            value={hexInput}
            onInput={(e) => editHex(e.currentTarget.value)}
            onBlur={() => setHexInput(color.replace("#", ""))}
            placeholder="6c7cff"
            maxLength={6}
            class="w-full bg-transparent text-sm font-mono uppercase tracking-wide text-[var(--color-text)] outline-none placeholder:normal-case placeholder:text-[var(--color-faint)]"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          class="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[var(--color-accent-hover)] hover:shadow-md disabled:opacity-40 disabled:shadow-none"
        >
          Save label
        </button>
      </div>
    </form>
  );
}
