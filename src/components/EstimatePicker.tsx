import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatMinutes, parseMinutes } from "../lib/duration";
import { TimerIcon } from "./Icons";
import { Portal } from "./Portal";

/** Common estimates, in minutes. */
const PRESETS = [15, 30, 45, 60, 90, 120];
const POPOVER_W = 208;
const MARGIN = 8;

interface Props {
  value: number | null;
  onChange: (minutes: number | null) => void;
  placeholder?: string;
  placement?: "top" | "bottom";
}

/**
 * Presets cover the common cases; the text box accepts free-form input
 * ("1h30", "90", "1.5h") and commits on Enter or blur.
 */
export function EstimatePicker({
  value,
  onChange,
  placeholder = "Estimate",
  placement = "bottom",
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openPicker = () => {
    setDraft(value ? formatMinutes(value) : "");
    const r = btnRef.current!.getBoundingClientRect();
    // Rough initial spot; corrected once measured in the layout effect below.
    setPos({
      top: placement === "top" ? r.top - 4 : r.bottom + 4,
      left: Math.max(MARGIN, Math.min(r.right - POPOVER_W, window.innerWidth - POPOVER_W - MARGIN)),
    });
    setOpen(true);
  };

  // Once rendered, measure the real popover size and keep it fully on-screen,
  // preferring the requested side but flipping (and clamping) when it won't fit.
  useLayoutEffect(() => {
    if (!open || !ref.current || !btnRef.current) return;
    const trigger = btnRef.current.getBoundingClientRect();
    const { offsetHeight: h, offsetWidth: w } = ref.current;
    let top: number;
    if (placement === "top") {
      const above = trigger.top - 4 - h;
      top = above >= MARGIN ? above : trigger.bottom + 4;
    } else {
      const below = trigger.bottom + 4;
      top =
        below + h <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, trigger.top - 4 - h);
    }
    const left = Math.max(
      MARGIN,
      Math.min(trigger.right - w, window.innerWidth - w - MARGIN),
    );
    setPos({ top, left });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (minutes: number | null) => {
    onChange(minutes);
    setOpen(false);
  };

  /** Commit whatever is in the text box, ignoring input that parses to nothing. */
  const commitDraft = () => {
    const parsed = parseMinutes(draft);
    if (parsed !== null) pick(parsed);
    else if (draft.trim() === "") pick(null);
    else setDraft(value ? formatMinutes(value) : "");
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        class={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)] ${
          value ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"
        }`}
        title="Estimated time for this task"
      >
        <TimerIcon width={14} height={14} />
        {value ? formatMinutes(value) : placeholder}
      </button>

      {open && (
        <Portal>
        <div
          ref={ref}
          style={{
            position: "fixed",
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            width: `${POPOVER_W}px`,
          }}
          class="z-[150] animate-fade-rise rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-2.5 shadow-2xl shadow-black/50"
        >
          <div class="grid grid-cols-3 gap-1">
            {PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => pick(minutes)}
                class={`rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  value === minutes
                    ? "bg-[var(--color-accent)] text-white"
                    : "bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {formatMinutes(minutes)}
              </button>
            ))}
          </div>

          <div class="mt-2 border-t border-[var(--color-border)] pt-2">
            <input
              value={draft}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Kept off the surrounding task form, same as the time field.
                  e.preventDefault();
                  e.stopPropagation();
                  commitDraft();
                }
              }}
              onBlur={commitDraft}
              placeholder="e.g. 1h 30m"
              aria-label="Custom estimate"
              class="w-full rounded-md bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {value !== null && (
            <button
              type="button"
              onClick={() => pick(null)}
              class="mt-2 w-full rounded-md border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-faint)] hover:text-[var(--color-danger)]"
            >
              Clear estimate
            </button>
          )}
        </div>
        </Portal>
      )}
    </>
  );
}
