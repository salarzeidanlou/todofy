import { useEffect, useState } from "preact/hooks";
import { useStore } from "../store";
import { eventDate } from "../store";
import { combineDateTime, timeOf } from "../lib/dates";
import { isValidEventTimeRange } from "../lib/calendarLayout";
import type { Event } from "../types";
import { CalendarIcon, CloseIcon, TrashIcon } from "./Icons";
import { DatePicker } from "./DatePicker";
import { TimeField } from "./TimeField";

interface Props {
  event: Event | null;
  defaultDate: string;
  defaultStartTime?: string;
  defaultAllDay?: boolean;
  onClose: () => void;
}

export function EventEditor({
  event,
  defaultDate,
  defaultStartTime,
  defaultAllDay,
  onClose,
}: Props) {
  const { addEvent, patchEvent, removeEvent } = useStore();
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState<string>(
    (event ? eventDate(event) : null) ?? defaultDate,
  );
  const [allDay, setAllDay] = useState(event?.allDay ?? defaultAllDay ?? false);
  const [startTime, setStartTime] = useState(
    event && !event.allDay ? timeOf(event.startAt) : (defaultStartTime ?? "09:00"),
  );
  const [endTime, setEndTime] = useState(
    event && !event.allDay
      ? timeOf(event.endAt)
      : nextHour(defaultStartTime ?? "09:00"),
  );
  const [description, setDescription] = useState(event?.description ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const invalidTimeRange = !isValidEventTimeRange(allDay, startTime, endTime);
  const canSave = title.trim() !== "" && !!date && !invalidTimeRange;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const startAt = allDay ? date : combineDateTime(date, startTime || "00:00");
    const endAt = allDay
      ? null
      : endTime
        ? combineDateTime(date, endTime)
        : null;
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      startAt,
      endAt,
      allDay,
    };
    try {
      if (event) {
        await patchEvent({ id: event.id, ...fields });
      } else {
        await addEvent(fields);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    setBusy(true);
    try {
      await removeEvent(event.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

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

        <div class="flex items-center gap-2.5 px-6 pt-6 pb-2">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-muted)]">
            <CalendarIcon width={18} height={18} />
          </span>
          <h3 class="text-base font-semibold text-[var(--color-text)]">
            {event ? "Edit event" : "New event"}
          </h3>
        </div>

        <div class="flex flex-col gap-3 px-6 pt-2 pb-6">
          <input
            type="text"
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="Event title"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && void save()}
            class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-70"
          />

          <div class="flex items-center justify-between">
            <div class="[&>*]:!text-sm">
              <DatePicker
                value={date}
                onChange={(d) => d && setDate(d)}
                allowClear={false}
                placeholder="Pick a date"
              />
            </div>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted)]">
              All day
              <Switch checked={allDay} onChange={() => setAllDay((v) => !v)} />
            </label>
          </div>

          {!allDay && (
            <div class="flex items-center gap-2">
              <TimeField
                variant="field"
                label="Start"
                value={startTime || null}
                onChange={(v) => setStartTime(v ?? "")}
              />
              <span class="text-xs text-[var(--color-faint)]">to</span>
              <TimeField
                variant="field"
                label="End"
                value={endTime || null}
                onChange={(v) => setEndTime(v ?? "")}
                invalid={invalidTimeRange}
              />
            </div>
          )}

          {invalidTimeRange && (
            <p role="alert" class="text-xs text-[var(--color-danger)]">
              End time must be later than start time.
            </p>
          )}

          <textarea
            value={description}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="Notes (optional)"
            rows={3}
            class="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />

          <div class="mt-1 flex gap-2">
            {event && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                title="Delete event"
                class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                <TrashIcon width={16} height={16} />
              </button>
            )}
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
              onClick={() => void save()}
              disabled={busy || !canSave}
              class="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {busy ? "Saving…" : event ? "Save" : "Add event"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function nextHour(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  if (hour >= 23) return "23:59";
  return `${String(hour + 1).padStart(2, "0")}:${String(
    Number.isFinite(minute) ? minute : 0,
  ).padStart(2, "0")}`;
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      class={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-2)]"
      }`}
    >
      <span
        class={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
