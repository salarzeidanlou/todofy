import { useStore } from "../store";
import { CloseIcon } from "./Icons";

/** One row's worth of keys + description. Keys render as <kbd> chips. */
type Shortcut = { keys: string[]; desc: string };

const NAVIGATION: Shortcut[] = [
  { keys: ["J"], desc: "Next task" },
  { keys: ["K"], desc: "Previous task" },
  { keys: ["↑", "↓"], desc: "Move selection" },
  { keys: ["Shift", "J"], desc: "Open Journal" },
  { keys: ["Esc"], desc: "Close panel / this help" },
];

const ACTIONS: Shortcut[] = [
  { keys: ["N"], desc: "New task / journal entry (focus composer)" },
  { keys: ["E"], desc: "Edit selected task" },
  { keys: ["C"], desc: "Complete / un-complete selected" },
  { keys: ["P"], desc: "Pin / unpin selected" },
  { keys: ["Del"], desc: "Delete selected" },
];

const GLOBAL: Shortcut[] = [
  { keys: ["Ctrl", "Alt", "A"], desc: "Quick-capture from any app" },
  { keys: ["?"], desc: "Show this cheat-sheet" },
];

export function ShortcutsOverlay() {
  const show = useStore((s) => s.showShortcuts);
  const close = useStore((s) => s.toggleShortcuts);
  if (!show) return null;

  return (
    <div
      onClick={() => close(false)}
      class="absolute inset-0 z-50 grid animate-fade-rise place-items-center bg-black/40 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        class="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl shadow-black/30"
      >
        <div class="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5">
          <h2 class="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={() => close(false)}
            class="rounded-md p-1 text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            title="Close"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
          <Group title="Navigation" rows={NAVIGATION} />
          <Group title="Selected task" rows={ACTIONS} />
          <Group title="Global" rows={GLOBAL} />
        </div>
      </div>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Shortcut[] }) {
  return (
    <div class="mb-4 last:mb-0">
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        {title}
      </p>
      <div class="flex flex-col">
        {rows.map((r) => (
          <div
            key={r.desc}
            class="flex items-center justify-between gap-4 py-1.5"
          >
            <span class="text-sm text-[var(--color-muted)]">{r.desc}</span>
            <span class="flex shrink-0 items-center gap-1">
              {r.keys.map((k) => (
                <kbd
                  key={k}
                  class="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-muted)]"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
