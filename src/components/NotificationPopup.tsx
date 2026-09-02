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
  const [note, setNote] = useState<NotifyPayload | null>(() => null);
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
    <div class="notification-stage">
      <div
        key={note.nonce}
        onMouseEnter={pause}
        onMouseLeave={startTimer}
        onClick={open}
        class="notification-card group animate-slide-left"
      >
        <div class="notification-accent" />
        <div class="notification-content">
          <span class="notification-icon">
            <BellIcon width={19} height={19} />
          </span>
          <div class="notification-copy">
            <div class="notification-eyebrow">Reminder · now</div>
            <p class="notification-title">{note.title}</p>
            <p class="notification-body">{note.body}</p>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          title="Dismiss"
          class="notification-dismiss"
        >
          <CloseIcon width={14} height={14} />
        </button>

        <span
          key={cycle}
          style={{
            animationDuration: `${AUTO_DISMISS_MS}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
          class="notification-progress animate-progress"
        />
      </div>
    </div>
  );
}
