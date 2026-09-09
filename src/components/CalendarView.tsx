import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { eventDate, useStore } from "../store";
import {
  layoutTimeBlocks,
  monthGridDays,
  scheduleDays,
  shiftCalendarAnchor,
  type CalendarViewMode,
} from "../lib/calendarLayout";
import { formatTime, toLocalDate, today } from "../lib/dates";
import { weekdayNames } from "../lib/locale";
import type { Event, Task } from "../types";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "./Icons";
import { EventEditor } from "./EventEditor";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_HEIGHT = 64;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
const MAX_MONTH_ITEMS = 4;
const VIEW_KEY = "todofy-calendar-view";

interface CalendarEntry {
  id: string;
  kind: "event" | "task";
  title: string;
  date: string;
  allDay: boolean;
  startMinute: number | null;
  endMinute: number | null;
  source: "local" | "task";
  priority?: Task["priority"];
  done?: boolean;
  event?: Event;
}

interface EditorState {
  event: Event | null;
  date: string;
  startTime?: string;
  allDay?: boolean;
}

export function CalendarView() {
  const { tasks, events, setView } = useStore();
  const [mode, setModeState] = useState<CalendarViewMode>(readStoredMode);
  const [anchor, setAnchor] = useState(() => new Date());
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const scheduleScroll = useRef<HTMLDivElement>(null);
  const todayKey = today();

  const entriesByDate = useMemo(() => buildEntries(tasks, events), [tasks, events]);
  const monthDays = useMemo(() => monthGridDays(anchor), [anchor]);
  const visibleScheduleDays = useMemo(
    () => (mode === "month" ? [] : scheduleDays(anchor, mode)),
    [anchor, mode],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode === "month") return;
    const frame = requestAnimationFrame(() => {
      if (!scheduleScroll.current) return;
      const includesToday = visibleScheduleDays.some(
        (date) => toLocalDate(date) === todayKey,
      );
      const focusHour = includesToday ? Math.max(0, now.getHours() - 1) : 7;
      scheduleScroll.current.scrollTop = focusHour * HOUR_HEIGHT;
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, anchor.getTime()]);

  const setMode = (next: CalendarViewMode) => {
    setModeState(next);
    localStorage.setItem(VIEW_KEY, next);
  };
  const openNew = (date: string, startTime?: string, allDay = false) =>
    setEditing({ event: null, date, startTime, allDay });
  const openEvent = (event: Event) =>
    setEditing({ event, date: eventDate(event) ?? todayKey });
  const openTaskDay = (date: string) => setView({ kind: "date", date });
  const openDay = (date: Date) => {
    setAnchor(date);
    setMode("day");
  };

  return (
    <main class="redesign-main calendar-page">
      <CalendarToolbar
        anchor={anchor}
        mode={mode}
        onModeChange={setMode}
        onToday={() => setAnchor(new Date())}
        onStep={(direction) =>
          setAnchor((current) => shiftCalendarAnchor(current, mode, direction))
        }
        onNew={() => openNew(toLocalDate(anchor))}
      />

      <div class="calendar-surface">
        {mode === "month" ? (
          <MonthCalendar
            anchor={anchor}
            days={monthDays}
            entriesByDate={entriesByDate}
            todayKey={todayKey}
            onAdd={(date) => openNew(date, undefined, true)}
            onOpenDay={openDay}
            onOpenEvent={openEvent}
            onOpenTaskDay={openTaskDay}
          />
        ) : (
          <ScheduleCalendar
            days={visibleScheduleDays}
            entriesByDate={entriesByDate}
            now={now}
            todayKey={todayKey}
            scrollRef={scheduleScroll}
            onAdd={openNew}
            onOpenDay={openDay}
            onOpenEvent={openEvent}
            onOpenTaskDay={openTaskDay}
          />
        )}
      </div>

      {editing && (
        <EventEditor
          event={editing.event}
          defaultDate={editing.date}
          defaultStartTime={editing.startTime}
          defaultAllDay={editing.allDay}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

function CalendarToolbar({
  anchor,
  mode,
  onModeChange,
  onToday,
  onStep,
  onNew,
}: {
  anchor: Date;
  mode: CalendarViewMode;
  onModeChange: (mode: CalendarViewMode) => void;
  onToday: () => void;
  onStep: (direction: -1 | 1) => void;
  onNew: () => void;
}) {
  return (
    <header class="calendar-toolbar">
      <div class="calendar-toolbar-primary">
        <button type="button" onClick={onToday} class="calendar-today-button">
          Today
        </button>
        <div class="calendar-stepper">
          <button
            type="button"
            onClick={() => onStep(-1)}
            aria-label={`Previous ${mode}`}
            title={`Previous ${mode}`}
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            aria-label={`Next ${mode}`}
            title={`Next ${mode}`}
          >
            <ChevronRightIcon width={18} height={18} />
          </button>
        </div>
        <div class="calendar-title">
          <h2>{calendarRangeLabel(anchor, mode)}</h2>
          <span>{mode === "month" ? "Calendar overview" : localTimeZone()}</span>
        </div>
      </div>

      <div class="calendar-toolbar-actions">
        <div class="calendar-view-switch" aria-label="Calendar view">
          {(["month", "week", "day"] as const).map((view) => (
            <button
              key={view}
              type="button"
              class={view === mode ? "is-active" : ""}
              aria-pressed={view === mode}
              onClick={() => onModeChange(view)}
            >
              {view[0].toUpperCase() + view.slice(1)}
            </button>
          ))}
        </div>
        <button type="button" onClick={onNew} class="calendar-new-button">
          <PlusIcon width={16} height={16} />
          <span>New event</span>
        </button>
      </div>
    </header>
  );
}

function MonthCalendar({
  anchor,
  days,
  entriesByDate,
  todayKey,
  onAdd,
  onOpenDay,
  onOpenEvent,
  onOpenTaskDay,
}: {
  anchor: Date;
  days: Date[];
  entriesByDate: Map<string, CalendarEntry[]>;
  todayKey: string;
  onAdd: (date: string) => void;
  onOpenDay: (date: Date) => void;
  onOpenEvent: (event: Event) => void;
  onOpenTaskDay: (date: string) => void;
}) {
  return (
    <div class="calendar-month">
      <div class="calendar-month-weekdays">
        {weekdayNames("short").map((weekday) => (
          <span key={weekday.index}>{weekday.label}</span>
        ))}
      </div>
      <div
        class="calendar-month-grid"
        style={{
          gridTemplateRows: `repeat(${days.length / 7}, minmax(7.2rem, 1fr))`,
        }}
      >
        {days.map((date) => {
          const key = toLocalDate(date);
          const entries = entriesByDate.get(key) ?? [];
          const visible = entries.slice(0, MAX_MONTH_ITEMS);
          const hidden = entries.length - visible.length;
          const inMonth = date.getMonth() === anchor.getMonth();
          return (
            <div
              key={key}
              class={`calendar-month-day ${inMonth ? "" : "is-outside"} ${
                key === todayKey ? "is-today" : ""
              }`}
              onClick={() => onAdd(key)}
            >
              <div class="calendar-month-date-row">
                <button
                  type="button"
                  class="calendar-date-number"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDay(date);
                  }}
                  aria-label={`Open ${date.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}`}
                >
                  {date.getDate() === 1
                    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    : date.getDate()}
                </button>
                <button
                  type="button"
                  class="calendar-day-add"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAdd(key);
                  }}
                  aria-label={`Add event on ${key}`}
                >
                  <PlusIcon width={13} height={13} />
                </button>
              </div>
              <div class="calendar-month-entries">
                {visible.map((entry) => (
                  <CalendarPill
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    onOpenEvent={onOpenEvent}
                    onOpenTaskDay={onOpenTaskDay}
                  />
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    class="calendar-more-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDay(date);
                    }}
                  >
                    {hidden} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleCalendar({
  days,
  entriesByDate,
  now,
  todayKey,
  scrollRef,
  onAdd,
  onOpenDay,
  onOpenEvent,
  onOpenTaskDay,
}: {
  days: Date[];
  entriesByDate: Map<string, CalendarEntry[]>;
  now: Date;
  todayKey: string;
  scrollRef: { current: HTMLDivElement | null };
  onAdd: (date: string, startTime?: string, allDay?: boolean) => void;
  onOpenDay: (date: Date) => void;
  onOpenEvent: (event: Event) => void;
  onOpenTaskDay: (date: string) => void;
}) {
  const columns = scheduleColumns(days.length);
  return (
    <div class="calendar-schedule">
      <div class="calendar-schedule-header" style={{ gridTemplateColumns: columns }}>
        <span class="calendar-timezone">GMT{timeZoneOffset(now)}</span>
        {days.map((date) => {
          const key = toLocalDate(date);
          const current = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              class={`calendar-schedule-date ${current ? "is-today" : ""}`}
              onClick={() => onOpenDay(date)}
            >
              <span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <b>{date.getDate()}</b>
            </button>
          );
        })}
      </div>

      <div class="calendar-all-day" style={{ gridTemplateColumns: columns }}>
        <span class="calendar-all-day-label">all-day</span>
        {days.map((date) => {
          const key = toLocalDate(date);
          const entries = (entriesByDate.get(key) ?? []).filter((entry) => entry.allDay);
          return (
            <div
              key={key}
              class="calendar-all-day-cell"
              onClick={() => onAdd(key, undefined, true)}
            >
              {entries.map((entry) => (
                <CalendarPill
                  key={`${entry.kind}-${entry.id}`}
                  entry={entry}
                  onOpenEvent={onOpenEvent}
                  onOpenTaskDay={onOpenTaskDay}
                />
              ))}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} class="calendar-time-scroll">
        <div class="calendar-time-grid" style={{ gridTemplateColumns: columns }}>
          <div class="calendar-time-axis">
            {HOURS.slice(1).map((hour) => (
              <span key={hour} style={{ top: `${hour * HOUR_HEIGHT}px` }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((date) => {
            const key = toLocalDate(date);
            const timed = (entriesByDate.get(key) ?? []).filter(
              (entry): entry is CalendarEntry & {
                startMinute: number;
                endMinute: number;
              } =>
                !entry.allDay &&
                entry.startMinute !== null &&
                entry.endMinute !== null,
            );
            const positioned = layoutTimeBlocks(timed);
            return (
              <div
                key={key}
                class={`calendar-time-day ${key === todayKey ? "is-today" : ""}`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const rawMinute = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
                  const minute = Math.max(
                    0,
                    Math.min(23 * 60 + 45, Math.floor(rawMinute / 15) * 15),
                  );
                  onAdd(key, minuteToTime(minute));
                }}
              >
                {positioned.map((entry) => (
                  <TimedCalendarCard
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    onOpenEvent={onOpenEvent}
                    onOpenTaskDay={onOpenTaskDay}
                  />
                ))}
                {key === todayKey && (
                  <span
                    class="calendar-now-line"
                    style={{ top: `${minutesInDay(now) * MINUTE_HEIGHT}px` }}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CalendarPill({
  entry,
  onOpenEvent,
  onOpenTaskDay,
}: {
  entry: CalendarEntry;
  onOpenEvent: (event: Event) => void;
  onOpenTaskDay: (date: string) => void;
}) {
  const time = entry.startMinute === null ? null : minuteToTime(entry.startMinute);
  return (
    <button
      type="button"
      class={`calendar-entry-pill ${entryTone(entry)}`}
      title={`${time ? `${formatTime(time)} · ` : ""}${entry.title}`}
      onClick={(event) => {
        event.stopPropagation();
        if (entry.event) onOpenEvent(entry.event);
        else onOpenTaskDay(entry.date);
      }}
    >
      <span class="calendar-entry-dot" />
      {time && <time>{formatTime(time)}</time>}
      <span>{entry.title}</span>
    </button>
  );
}

function TimedCalendarCard({
  entry,
  onOpenEvent,
  onOpenTaskDay,
}: {
  entry: CalendarEntry & {
    startMinute: number;
    endMinute: number;
    lane: number;
    laneCount: number;
  };
  onOpenEvent: (event: Event) => void;
  onOpenTaskDay: (date: string) => void;
}) {
  const width = 100 / entry.laneCount;
  const start = minuteToTime(entry.startMinute);
  const end = minuteToTime(entry.endMinute);
  return (
    <button
      type="button"
      class={`calendar-timed-entry ${entryTone(entry)}`}
      style={{
        top: `${entry.startMinute * MINUTE_HEIGHT}px`,
        height: `${Math.max(28, (entry.endMinute - entry.startMinute) * MINUTE_HEIGHT)}px`,
        left: `calc(${entry.lane * width}% + 3px)`,
        width: `calc(${width}% - 5px)`,
      }}
      title={`${entry.title}, ${formatTime(start)}–${formatTime(end)}`}
      onClick={(event) => {
        event.stopPropagation();
        if (entry.event) onOpenEvent(entry.event);
        else onOpenTaskDay(entry.date);
      }}
    >
      <strong>{entry.title}</strong>
      <span>{formatTime(start)}</span>
    </button>
  );
}

function buildEntries(tasks: Task[], events: Event[]): Map<string, CalendarEntry[]> {
  const byDate = new Map<string, CalendarEntry[]>();
  const add = (entry: CalendarEntry) => {
    const items = byDate.get(entry.date) ?? [];
    items.push(entry);
    byDate.set(entry.date, items);
  };

  for (const event of events) {
    const date = eventDate(event);
    if (!date) continue;
    const startMinute = event.allDay ? null : minuteFromIso(event.startAt);
    add({
      id: event.id,
      kind: "event",
      title: event.title,
      date,
      allDay: event.allDay || startMinute === null,
      startMinute,
      endMinute:
        startMinute === null ? null : eventEndMinute(event.endAt, date, startMinute),
      source: "local",
      event,
    });
  }

  for (const task of tasks) {
    if (!task.dueDate) continue;
    const startMinute = minuteFromIso(task.remindAt);
    add({
      id: task.id,
      kind: "task",
      title: task.title,
      date: task.dueDate,
      allDay: startMinute === null,
      startMinute,
      endMinute: startMinute === null ? null : Math.min(1440, startMinute + 30),
      source: "task",
      priority: task.priority,
      done: task.status === "done",
    });
  }

  for (const entries of byDate.values()) {
    entries.sort(
      (a, b) =>
        Number(a.allDay) - Number(b.allDay) ||
        (a.startMinute ?? -1) - (b.startMinute ?? -1) ||
        a.title.localeCompare(b.title),
    );
  }
  return byDate;
}

function readStoredMode(): CalendarViewMode {
  const stored = localStorage.getItem(VIEW_KEY);
  return stored === "week" || stored === "day" ? stored : "month";
}

function calendarRangeLabel(anchor: Date, mode: CalendarViewMode): string {
  if (mode === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (mode === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }
  const [start, ...rest] = scheduleDays(anchor, "week");
  const end = rest[rest.length - 1] ?? start;
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString(undefined, { month: "long" })} ${
      start.getDate()
    }–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function scheduleColumns(dayCount: number): string {
  return `64px repeat(${dayCount}, minmax(${dayCount === 1 ? 300 : 112}px, 1fr))`;
}

function minuteFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : minutesInDay(date);
}

function eventEndMinute(endAt: string | null, dateKey: string, startMinute: number): number {
  if (!endAt) return Math.min(1440, startMinute + 60);
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return Math.min(1440, startMinute + 60);
  if (toLocalDate(end) > dateKey) return 1440;
  return Math.min(1440, Math.max(startMinute + 15, minutesInDay(end)));
}

function minutesInDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function minuteToTime(minute: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60,
  ).padStart(2, "0")}`;
}

function hourLabel(hour: number): string {
  return formatTime(`${String(hour).padStart(2, "0")}:00`).replace(":00", "");
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
}

function timeZoneOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "−";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const remainder = Math.abs(minutes) % 60;
  return `${sign}${hours}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`;
}

function entryTone(entry: CalendarEntry): string {
  if (entry.source === "local") return "is-local";
  return `is-task priority-${entry.priority ?? 4}${entry.done ? " is-done" : ""}`;
}
