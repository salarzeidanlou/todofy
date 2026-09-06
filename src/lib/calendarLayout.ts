export type CalendarViewMode = "month" | "week" | "day";

export interface TimeBlock {
  id: string;
  startMinute: number;
  endMinute: number;
}

export type PositionedTimeBlock<T extends TimeBlock> = T & {
  lane: number;
  laneCount: number;
};

function dateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addCalendarDays(date: Date, amount: number): Date {
  const next = dateOnly(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfCalendarWeek(date: Date): Date {
  return addCalendarDays(date, -date.getDay());
}

export function monthGridDays(anchor: Date): Date[] {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfCalendarWeek(monthStart);
  const visibleDays = Math.ceil((monthStart.getDay() + daysInMonth(monthStart)) / 7) * 7;
  return Array.from({ length: visibleDays }, (_, index) =>
    addCalendarDays(gridStart, index),
  );
}

export function scheduleDays(anchor: Date, mode: Exclude<CalendarViewMode, "month">): Date[] {
  const start = mode === "week" ? startOfCalendarWeek(anchor) : dateOnly(anchor);
  const count = mode === "week" ? 7 : 1;
  return Array.from({ length: count }, (_, index) => addCalendarDays(start, index));
}

export function shiftCalendarAnchor(
  anchor: Date,
  mode: CalendarViewMode,
  direction: -1 | 1,
): Date {
  if (mode === "month") {
    return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
  }
  return addCalendarDays(anchor, direction * (mode === "week" ? 7 : 1));
}

/** Timed events are currently single-day, so their end must follow their start. */
export function isValidEventTimeRange(
  allDay: boolean,
  startTime: string,
  endTime: string,
): boolean {
  return allDay || !startTime || !endTime || endTime > startTime;
}

/** Assign overlapping blocks to equal-width lanes, cluster by cluster. */
export function layoutTimeBlocks<T extends TimeBlock>(
  blocks: readonly T[],
): PositionedTimeBlock<T>[] {
  const sorted = [...blocks].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
  const positioned: PositionedTimeBlock<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const placements = cluster.map((block) => {
      let lane = laneEnds.findIndex((end) => end <= block.startMinute);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = block.endMinute;
      return { block, lane };
    });
    const laneCount = laneEnds.length;
    positioned.push(
      ...placements.map(({ block, lane }) => ({ ...block, lane, laneCount })),
    );
    cluster = [];
    clusterEnd = -1;
  };

  for (const block of sorted) {
    if (cluster.length > 0 && block.startMinute >= clusterEnd) flush();
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  flush();
  return positioned;
}

function daysInMonth(month: Date): number {
  return new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
}
