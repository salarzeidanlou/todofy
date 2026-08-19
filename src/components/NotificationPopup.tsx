import { useEffect, useRef, useState } from "preact/hooks";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { BellIcon, CloseIcon } from "./Icons";

/** Payload pushed from the Rust `popup::show` (serde snake_case). */
interface NotifyPayload {
  nonce: number;
  title: string;
  body: string;
  task_id: number | null;
}

/** How long a notification stays before it auto-dismisses. */
const AUTO_DISMISS_MS = 6000;

/**
 * The corner notification popup. Lives in its own transparent, always-on-top,
 * non-focusing Tauri window (`notification`). The backend positions the window
 * in the chosen screen corner and emits `notify-show`; this renders the card and
 * dismisses itself after a timeout (paused while hovered).
 */
export function NotificationPopup() {
  const [note, setNote] = useState<NotifyPayload | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const clearTimer = () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  const startTimer = () => {
    clearTimer();
    timer.current = window.setTimeout(dismiss, AUTO_DISMISS_MS);
  };

  const dismiss = () => {
    clearTimer();
    setNote(null);
    invoke("notify_popup_dismiss").catch(() => {});
  };

  const open = () => {
    clearTimer();
    const id = note?.task_id ?? null;
    setNote(null);
    invoke("notify_popup_open", { taskId: id }).catch(() => {});
  };

  useEffect(() => {
    const unlisten = listen<NotifyPayload>("notify-show", (e) => {
      setNote(e.payload);
      startTimer();
    });
    return () => {
      unlisten.then((off) => off());
      clearTimer();
    };
  }, []);

  if (!note) return null;

  return (
    <div class="flex h-screen w-screen items-stretch p-2">
      <div
        key={note.nonce}
        onMouseEnter={clearTimer}
        onMouseLeave={startTimer}
        onClick={open}
        class="group flex w-full animate-slide-left cursor-pointer items-start gap-3 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-3.5 shadow-xl shadow-black/40"
      >
        <span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <BellIcon width={18} height={18} />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-[var(--color-text)]">
            {note.title}
          </p>
          <p class="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">
            {note.body}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          title="Dismiss"
          class="shrink-0 rounded-lg p-1 text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] group-hover:opacity-100"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
