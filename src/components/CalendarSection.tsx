import { useEffect, useState } from "preact/hooks";
import { useAuth } from "../lib/auth";
import { calendarConfigured, useCalendar } from "../lib/googleCalendar";
import { CalendarIcon, CloseIcon, GoogleIcon } from "./Icons";
import { Checkbox } from "./Checkbox";

export function CalendarSection() {
  const { session } = useAuth();
  const {
    ready,
    connected,
    email,
    busy,
    connect,
    disconnect,
    pushError,
    keepCompleted,
    setKeepCompleted,
    timedOnly,
    setTimedOnly,
  } = useCalendar();
  const [error, setError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  // Builds without Google credentials don't advertise the feature at all.
  if (!calendarConfigured) return null;

  const onConnect = async () => {
    setError(null);
    const result = await connect();
    if (!result.ok) setError(result.error);
  };

  return (
    <section class="mb-6">
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        Calendar
      </h3>
      <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {!session ? (
          <div class="flex items-center gap-3 px-4 py-3.5">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)]">
              <CalendarIcon width={18} height={18} />
            </span>
            <p class="text-sm text-[var(--color-muted)]">
              Sign in to your account above to push your tasks to Google Calendar.
            </p>
          </div>
        ) : !ready ? (
          <div class="px-4 py-3.5 text-sm text-[var(--color-muted)]">Loading…</div>
        ) : connected ? (
          <>
            <div class="flex items-center gap-3 px-4 py-3.5">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                <CalendarIcon width={18} height={18} />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-[var(--color-text)]">
                  {email ?? "Google Calendar connected"}
                </p>
                <p class="mt-0.5 text-xs text-[var(--color-muted)]">
                  Your tasks push to a dedicated todofy calendar.
                </p>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setDisconnectOpen(true);
                }}
                disabled={busy}
                class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
            <PushStatusRow />
            <div class="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-3.5">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-[var(--color-text)]">
                  Keep completed tasks
                </p>
                <p class="mt-0.5 text-xs text-[var(--color-muted)]">
                  Leave finished tasks on the calendar with a ✓ instead of
                  removing them when done.
                </p>
              </div>
              <Switch
                checked={keepCompleted}
                onChange={() => void setKeepCompleted(!keepCompleted)}
              />
            </div>
            <div class="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-3.5">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-[var(--color-text)]">
                  Only tasks with a set time
                </p>
                <p class="mt-0.5 text-xs text-[var(--color-muted)]">
                  Skip date-only tasks and push only those with a specific
                  reminder time.
                </p>
              </div>
              <Switch
                checked={timedOnly}
                onChange={() => void setTimedOnly(!timedOnly)}
              />
            </div>
          </>
        ) : (
          <div class="flex flex-col gap-2.5 px-4 py-3.5">
            <div class="flex items-center gap-3">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                <CalendarIcon width={18} height={18} />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-[var(--color-text)]">
                  Connect Google Calendar
                </p>
                <p class="mt-0.5 text-xs text-[var(--color-muted)]">
                  Push tasks with a due date to a dedicated todofy calendar.
                </p>
              </div>
              <button
                onClick={() => void onConnect()}
                disabled={busy}
                class="flex shrink-0 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                <GoogleIcon width={14} height={14} />
                {busy ? "Waiting for browser…" : "Connect"}
              </button>
            </div>
            {(error ?? pushError) && (
              <p class="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
                {error ?? pushError}
              </p>
            )}
          </div>
        )}
      </div>

      {disconnectOpen && (
        <DisconnectModal
          busy={busy}
          error={error}
          onClose={() => setDisconnectOpen(false)}
          onConfirm={async (deleteRemote) => {
            setError(null);
            const result = await disconnect(deleteRemote);
            if (result.ok) setDisconnectOpen(false);
            else setError(result.error);
          }}
        />
      )}
    </section>
  );
}

function DisconnectModal({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (deleteRemote: boolean) => Promise<void>;
}) {
  const [deleteRemote, setDeleteRemote] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      class="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div class="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/50">
        <button
          onClick={onClose}
          title="Close"
          class="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <CloseIcon width={16} height={16} />
        </button>

        <div class="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span class="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-muted)]">
            <CalendarIcon width={24} height={24} />
          </span>
          <h3 class="text-lg font-semibold text-[var(--color-text)]">
            Disconnect Google Calendar
          </h3>
          <p class="text-xs text-[var(--color-muted)]">
            todofy will stop pushing tasks to your calendar.
          </p>
        </div>

        <div class="flex flex-col gap-3 px-6 pt-3 pb-6">
          <button
            type="button"
            role="checkbox"
            aria-checked={deleteRemote}
            onClick={() => setDeleteRemote((v) => !v)}
            class={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              deleteRemote
                ? "border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5"
                : "border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <span class="mt-0.5">
              <Checkbox checked={deleteRemote} interactive={false} color="var(--color-danger)" />
            </span>
            <span class="text-xs text-[var(--color-text)]">
              Also delete the todofy calendar and its events from Google.
              <span class="mt-0.5 block text-[var(--color-muted)]">
                Leave unchecked to keep the calendar; reconnecting later resumes
                where you left off.
              </span>
            </span>
          </button>

          {error && (
            <p
              role="alert"
              class="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
            >
              {error}
            </p>
          )}

          <div class="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              class="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm(deleteRemote)}
              disabled={busy}
              class={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                deleteRemote
                  ? "bg-[var(--color-danger)] hover:opacity-90"
                  : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
              }`}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PUSH_META = {
  idle: { dot: "bg-[var(--color-success)]", label: "Up to date" },
  pushing: { dot: "bg-[var(--color-warning)]", label: "Pushing…" },
  error: { dot: "bg-[var(--color-danger)]", label: "Push failed" },
} as const;

function PushStatusRow() {
  const { status, lastPushedAt, pushError, push } = useCalendar();
  const meta = PUSH_META[status];
  const detail =
    status === "error"
      ? pushError ?? "Something went wrong."
      : lastPushedAt
        ? `Last pushed ${relativeTime(lastPushedAt)}`
        : "Nothing pushed yet";

  return (
    <div class="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
      <span class={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-[var(--color-text)]">{meta.label}</p>
        <p class="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">{detail}</p>
      </div>
      <button
        onClick={() => void push()}
        disabled={status === "pushing"}
        class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        {status === "pushing" ? "Pushing…" : "Push now"}
      </button>
    </div>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-2)]"
      }`}
    >
      <span
        class={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
