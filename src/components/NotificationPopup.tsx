import { useEffect, useRef, useState } from "preact/hooks";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { BellIcon, CloseIcon } from "./Icons";

interface NotifyPayload {
  nonce: number;
  title: string;
  body: string;
  task_id: string | null;
}

const AUTO_DISMISS_MS = 6000;

/**
 * The corner notification popup, in its own transparent, always-on-top Tauri
 * window. The backend positions it and pushes the content; this renders the
 * card and dismisses after a timeout (paused while hovered).
 */
export function NotificationPopup() {
  const [note, setNote] = useState<NotifyPayload | null>(null);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const clearTimer = () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  const startTimer = () => {
    clearTimer();
    setPaused(false);
    setCycle((c) => c + 1);
    timer.current = window.setTimeout(dismiss, AUTO_DISMISS_MS);
  };

  const pause = () => {
    clearTimer();
    setPaused(true);
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
    // Catch a notification shown before this webview finished loading.
    invoke<NotifyPayload | null>("notify_popup_pending")
      .then((pending) => {
        if (pending) {
          setNote(pending);
          startTimer();
        }
      })
      .catch(() => {});
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
        onMouseEnter={pause}
        onMouseLeave={startTimer}
        onClick={open}
        class="group relative flex w-full animate-slide-left cursor-pointer overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/50 ring-1 ring-white/5"
      >
        <div class="flex flex-1 items-start gap-3 p-3.5">
          <span class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)]/25">
            <BellIcon width={19} height={19} />
          </span>
          <div class="min-w-0 flex-1 pr-5">
            <p class="truncate text-sm font-semibold text-[var(--color-text)]">
              {note.title}
            </p>
            <p class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">
              {note.body}
            </p>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          title="Dismiss"
          class="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-lg text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] group-hover:opacity-100"
        >
          <CloseIcon width={14} height={14} />
        </button>

        <span
          key={cycle}
          style={{
            animationDuration: `${AUTO_DISMISS_MS}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
          class="animate-progress absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-hover)]"
        />
      </div>
    </div>
  );
}
