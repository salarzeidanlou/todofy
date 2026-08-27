import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface MenuItem {
  label: string;
  onClick: () => void;
  hint?: string;
  danger?: boolean;
}

type Entry = MenuItem | "divider";

/** App-specific actions appended below the editing items, per window. */
type AppItems = () => MenuItem[];

/**
 * todofy's own right-click menu, replacing the webview's browser menu (Back /
 * Forward / Reload / Inspect Element). Mount one per window; it captures every
 * `contextmenu`, offers context-aware Cut / Copy / Paste / Select all on text,
 * and any app actions the window passes in.
 */
export function ContextMenu({ appItems }: { appItems?: AppItems }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: Entry[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const items = buildItems(e.target, appItems?.() ?? []);
      setMenu(items.length ? { x: e.clientX, y: e.clientY, items } : null);
    };
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);

    document.addEventListener("contextmenu", onContext);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [appItems]);

  // Keep the menu fully on screen, measured after it renders.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const gap = 6;
    const left = Math.min(menu.x, window.innerWidth - r.width - gap);
    const top = Math.min(menu.y, window.innerHeight - r.height - gap);
    setPos({ left: Math.max(gap, left), top: Math.max(gap, top) });
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      style={{
        left: pos ? pos.left : menu.x,
        top: pos ? pos.top : menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
      class="fixed z-[200] min-w-[190px] animate-fade-rise overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-1 shadow-2xl shadow-black/50"
    >
      {menu.items.map((item, i) =>
        item === "divider" ? (
          <div key={i} class="my-1 h-px bg-[var(--color-border)]" />
        ) : (
          <button
            key={i}
            onClick={() => {
              setMenu(null);
              item.onClick();
            }}
            class={`flex w-full items-center justify-between gap-6 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
              item.danger
                ? "text-[var(--color-danger)] hover:bg-[var(--color-danger)]/12"
                : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <span>{item.label}</span>
            {item.hint && (
              <span class="text-xs text-[var(--color-faint)]">{item.hint}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

function buildItems(target: EventTarget | null, appItems: MenuItem[]): Entry[] {
  const items: Entry[] = [];
  const field = fieldOf(target);
  const selected = field
    ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
    : window.getSelection()?.toString() ?? "";

  if (field && selected)
    items.push({
      label: "Cut",
      hint: "Ctrl+X",
      onClick: () => {
        writeClipboard(selected);
        replaceSelection(field, "");
      },
    });
  if (selected)
    items.push({ label: "Copy", hint: "Ctrl+C", onClick: () => writeClipboard(selected) });
  if (field)
    items.push({
      label: "Paste",
      hint: "Ctrl+V",
      onClick: async () => replaceSelection(field, await readClipboard()),
    });
  if (field)
    items.push({ label: "Select all", hint: "Ctrl+A", onClick: () => field.select() });

  if (appItems.length) {
    if (items.length) items.push("divider");
    items.push(...appItems);
  }
  return items;
}

function fieldOf(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  const el = target instanceof HTMLElement ? target.closest("input, textarea") : null;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable — ignore */
  }
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

/** Replace the field's current selection with `text` and fire an input event so
 *  a controlled Preact input picks up the change. */
function replaceSelection(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + text + field.value.slice(end);
  const caret = start + text.length;
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
}
