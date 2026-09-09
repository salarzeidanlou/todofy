import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatDue, formatTime, toLocalDate, today } from "../lib/dates";
import { BellIcon, CalendarIcon, RepeatIcon } from "./Icons";
import { TimeField } from "./TimeField";
import { weekdayNames, weekdayOffset } from "../lib/locale";
import { api } from "../lib/api";
import {
  DEFAULT_QUICK_TIMES,
  parseQuickTimes,
  QUICK_TIMES_KEY,
} from "../lib/quickTimes";
import { REPEAT_OPTIONS } from "../lib/repeat";
import type { RepeatRule } from "../types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const POPOVER_W = 268;
const YEARS_PER_PAGE = 12;
const MARGIN = 8;

type Mode = "days" | "months" | "years";

function shift(days: number): string {
  return toLocalDate(new Date(Date.now() + days * 86400000));
}
function thisWeekend(): string {
  const d = new Date();
  return toLocalDate(new Date(d.getTime() + ((6 - d.getDay() + 7) % 7) * 86400000));
}
function nextWeek(): string {
  const d = new Date();
  return toLocalDate(new Date(d.getTime() + (((8 - d.getDay()) % 7) || 7) * 86400000));
}

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  /** When provided, a time picker is shown; used to set a reminder. */
  time?: string | null; // HH:mm
  onTimeChange?: (time: string | null) => void;
  /** The stored reminder instant; enables snooze chips when it's in the past. */
  reminderAt?: string | null;
  onSnooze?: (minutes: number) => void;
  /** When provided, recurrence is set here rather than in a separate control. */
  repeat?: RepeatRule | null;
  onRepeatChange?: (rule: RepeatRule | null) => void;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Schedule",
  allowClear = true,
  time,
  onTimeChange,
  reminderAt,
  onSnooze,
  repeat,
  onRepeatChange,
}: Props) {
  const withTime = !!onTimeChange;
  const [open, setOpen] = useState(false);
  const [quickTimes, setQuickTimes] = useState(DEFAULT_QUICK_TIMES);
  const [mode, setMode] = useState<Mode>("days");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [month, setMonth] = useState(() =>
    value ? new Date(value + "T00:00:00") : new Date(),
  );
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openPicker = () => {
    const r = btnRef.current!.getBoundingClientRect();
    // Rough initial spot; corrected once measured in the layout effect below.
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_W - MARGIN)),
    });
    setMonth(value ? new Date(value + "T00:00:00") : new Date());
    setMode("days");
    setOpen(true);
  };

  // Once rendered, measure the real popover size and keep it fully on-screen:
  // open below the trigger, flip above when there's no room, else clamp.
  useLayoutEffect(() => {
    if (!open || !ref.current || !btnRef.current) return;
    const trigger = btnRef.current.getBoundingClientRect();
    const { offsetHeight: h, offsetWidth: w } = ref.current;
    let top = trigger.bottom + 4;
    if (top + h > window.innerHeight - MARGIN) {
      const above = trigger.top - 4 - h;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - MARGIN - h);
    }
    const left = Math.max(
      MARGIN,
      Math.min(trigger.left, window.innerWidth - w - MARGIN),
    );
    setPos({ top, left });
  }, [open, mode]);

  // Re-read on each open so a change made in Settings takes effect without a
  // restart; the values live in SQLite, which both windows share.
  useEffect(() => {
    if (!open || !withTime) return;
    api
      .getSetting(QUICK_TIMES_KEY)
      .then((stored) => setQuickTimes(parseQuickTimes(stored)))
      .catch(() => {});
  }, [open, withTime]);

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

  const pick = (date: string | null) => {
    onChange(date);
    if (!date) onTimeChange?.(null);
    setOpen(false);
  };
  const setTime = (t: string | null) => onTimeChange?.(t);

  const year = month.getFullYear();
  const valueDate = value ? new Date(value + "T00:00:00") : null;
  const now = new Date();

  const QUICK = [
    { label: "Today", date: today(), hint: now.toLocaleDateString(undefined, { weekday: "short" }) },
    { label: "Tomorrow", date: shift(1), hint: new Date(Date.now() + 86400000).toLocaleDateString(undefined, { weekday: "short" }) },
    { label: "This weekend", date: thisWeekend(), hint: "Sat" },
    { label: "Next week", date: nextWeek(), hint: "Mon" },
  ];

  const label = (() => {
    if (!value) return placeholder;
    // The time is appended here, so the bare label is used to avoid repeating it.
    const base = formatDue(value).label;
    return time ? `${base}, ${formatTime(time)}` : base;
  })();
  const tone = value ? formatDue(value, reminderAt).tone : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        class={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)] ${
          value
            ? tone === "overdue"
              ? "text-[var(--color-danger)]"
              : "text-[var(--color-accent)]"
            : "text-[var(--color-faint)]"
        }`}
        title="Set date"
      >
        <CalendarIcon width={14} height={14} />
        {label}
      </button>

      {open && (
        <div
          ref={ref}
          style={{
            position: "fixed",
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            width: `${POPOVER_W}px`,
            // Shortcuts, calendar, time and repeat can outgrow a short window.
            maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
          }}
          class="z-50 animate-fade-rise overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-2.5 shadow-2xl shadow-black/50"
        >
          {/* Quick shortcuts */}
          <div class="mb-2 flex flex-col gap-0.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => pick(q.date)}
                class="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-accent-soft)]"
              >
                <span class="flex items-center gap-2.5">
                  <CalendarIcon width={14} height={14} class="text-[var(--color-faint)]" />
                  {q.label}
                </span>
                <span class="text-xs text-[var(--color-faint)]">{q.hint}</span>
              </button>
            ))}
          </div>

          <div class="border-t border-[var(--color-border)] pt-2">
            {/* Header — clickable month / year to jump modes */}
            <div class="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonth(paginate(month, mode, -1))}
                class="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
              >
                ‹
              </button>

              <div class="flex items-center gap-1 text-sm font-medium">
                {mode === "days" && (
                  <button
                    type="button"
                    onClick={() => setMode("months")}
                    class="rounded-md px-1.5 py-0.5 transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
                  >
                    {month.toLocaleDateString(undefined, { month: "long" })}
                  </button>
                )}
                {mode !== "years" && (
                  <button
                    type="button"
                    onClick={() => setMode("years")}
                    class="rounded-md px-1.5 py-0.5 transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
                  >
                    {year}
                  </button>
                )}
                {mode === "years" && (
                  <span class="px-1.5 py-0.5 text-[var(--color-muted)]">
                    {yearPageStart(year)} – {yearPageStart(year) + YEARS_PER_PAGE - 1}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setMonth(paginate(month, mode, 1))}
                class="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
              >
                ›
              </button>
            </div>

            {mode === "days" && (
              <DayGrid month={month} value={value} onPick={pick} />
            )}

            {mode === "months" && (
              <div class="grid grid-cols-3 gap-1">
                {MONTHS.map((m, i) => {
                  const sel = valueDate?.getFullYear() === year && valueDate?.getMonth() === i;
                  const isNow = now.getFullYear() === year && now.getMonth() === i;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMonth(new Date(year, i, 1));
                        setMode("days");
                      }}
                      class={cell(sel, isNow) + " h-9"}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            )}

            {mode === "years" && (
              <div class="grid grid-cols-3 gap-1">
                {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart(year) + i).map((y) => {
                  const sel = valueDate?.getFullYear() === y;
                  const isNow = now.getFullYear() === y;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => {
                        setMonth(new Date(y, month.getMonth(), 1));
                        setMode("months");
                      }}
                      class={cell(sel, isNow) + " h-9"}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Time / reminder */}
          {withTime && (
            <div class="mt-2 border-t border-[var(--color-border)] pt-2">
              <div class="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs text-[var(--color-muted)]">
                <BellIcon width={13} height={13} />
                Time
                {time && (
                  <button
                    type="button"
                    onClick={() => setTime(null)}
                    class="ml-auto text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div class="flex items-center gap-1.5 px-0.5">
                {quickTimes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTime(t)}
                    class={`rounded-md px-2 py-1 text-xs transition-colors ${
                      time === t
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {formatTime(t)}
                  </button>
                ))}
                <TimeField
                  value={time || null}
                  onChange={setTime}
                  onDone={() => setOpen(false)}
                />
              </div>

              {onSnooze &&
                reminderAt &&
                new Date(reminderAt).getTime() < Date.now() && (
                  <div class="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
                    <span class="text-xs text-[var(--color-warning)]">
                      Snooze
                    </span>
                    {[
                      { label: "10m", min: 10 },
                      { label: "1h", min: 60 },
                      { label: "3h", min: 180 },
                    ].map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          onSnooze(s.min);
                          setOpen(false);
                        }}
                        class="rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )}

          {onRepeatChange && (
            <div class="mt-2 border-t border-[var(--color-border)] pt-2">
              <div class="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs text-[var(--color-muted)]">
                <RepeatIcon width={13} height={13} />
                Repeat
              </div>
              <div class="flex flex-wrap gap-1 px-0.5">
                {REPEAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value ?? "none"}
                    type="button"
                    onClick={() => onRepeatChange(opt.value)}
                    class={`rounded-md px-2 py-1 text-xs transition-colors ${
                      (repeat ?? null) === opt.value
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {allowClear && value && (
            <button
              type="button"
              onClick={() => pick(null)}
              class="mt-2 w-full rounded-md border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-faint)] hover:text-[var(--color-danger)]"
            >
              Clear date &amp; time
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Shared cell styling for day / month / year buttons. */
function cell(selected: boolean, isToday: boolean): string {
  if (selected) return "grid place-items-center rounded-lg bg-[var(--color-accent)] text-xs font-medium text-white";
  if (isToday)
    return "grid place-items-center rounded-lg text-xs text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)] hover:bg-[var(--color-surface-2)]";
  return "grid place-items-center rounded-lg text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]";
}

function DayGrid({
  month,
  value,
  onPick,
}: {
  month: Date;
  value: string | null;
  onPick: (d: string) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = weekdayOffset(first);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(toLocalDate(new Date(month.getFullYear(), month.getMonth(), d)));

  return (
    <>
      <div class="grid grid-cols-7 text-center text-[10px] font-medium text-[var(--color-faint)]">
        {weekdayNames("narrow").map((w) => (
          <span key={w.index} class="py-1">{w.label}</span>
        ))}
      </div>
      <div class="grid grid-cols-7 gap-0.5">
        {cells.map((date, i) =>
          !date ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => onPick(date)}
              class={cell(date === value, date === today()) + " h-8"}
            >
              {Number(date.slice(-2))}
            </button>
          ),
        )}
      </div>
    </>
  );
}

function yearPageStart(year: number): number {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
}

/** Step the header back/forward by one unit for the active mode. */
function paginate(month: Date, mode: Mode, dir: number): Date {
  if (mode === "days") return new Date(month.getFullYear(), month.getMonth() + dir, 1);
  if (mode === "months") return new Date(month.getFullYear() + dir, month.getMonth(), 1);
  return new Date(month.getFullYear() + dir * YEARS_PER_PAGE, month.getMonth(), 1);
}
