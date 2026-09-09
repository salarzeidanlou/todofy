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

/**
 * Long enough to read the reminder and pick a snooze offset; hovering the card
 * pauses it.
 */
const AUTO_DISMISS_MS = 10000;

/** Snooze offsets offered on the card, in minutes. */
const SNOOZE_OPTIONS = [15, 30, 60];

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

  /** Tell the backend this popup rendered, so it stops treating it as dropped. */
  const show = (payload: NotifyPayload) => {
    setNote(payload);
    invoke("notify_popup_ack", { nonce: payload.nonce }).catch(() => {});
    startTimer();
  };

  const pause = () => {
    clearTimer();
    setPaused(true);
  };

  /**
   * Stop this reminder repeating. Deliberate actions only: the auto-dismiss
   * below is a timeout, not an answer.
   */
  const acknowledge = () => {
    const id = note?.task_id;
    if (id) invoke("acknowledge_reminder", { id }).catch(() => {});
  };

  const dismiss = () => {
    clearTimer();
    setNote(null);
    invoke("notify_popup_dismiss").catch(() => {});
  };

  const close = () => {
    acknowledge();
    dismiss();
  };

  const open = () => {
    clearTimer();
    acknowledge();
    const id = note?.task_id ?? null;
    setNote(null);
    invoke("notify_popup_open", { taskId: id }).catch(() => {});
  };

  const snooze = (minutes: number) => {
    const id = note?.task_id;
    if (!id) return;
    // Snoozing re-arms the reminder; the backend clears the acknowledgement
    // itself, so asking for one here would race it.
    invoke("snooze_task", { id, minutes }).catch(() => {});
    dismiss();
  };

  useEffect(() => {
    const unlisten = listen<NotifyPayload>("notify-show", (e) => show(e.payload));
    // Catch a notification shown before this webview finished loading.
    invoke<NotifyPayload | null>("notify_popup_pending")
      .then((pending) => {
        if (pending) show(pending);
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
            {note.task_id && (
              <div class="notification-actions">
                <span>Snooze</span>
                {SNOOZE_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    onClick={(e) => {
                      e.stopPropagation();
                      snooze(minutes);
                    }}
                  >
                    {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            close();
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
