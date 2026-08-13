import type { Task, ViewId } from "../types";
import { toLocalDate, today } from "./dates";

export interface Section {
  key: string;
  title: string | null;
  tone?: "overdue";
  tasks: Task[];
}

/** Section header for a future date in the Upcoming view. */
function upcomingTitle(date: string): string {
  const d = new Date(date + "T00:00:00");
  const tomorrow = toLocalDate(new Date(Date.now() + 86400000));
  if (date === tomorrow) return "Tomorrow";

  const days = (d.getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });

  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Pinned tasks bubble to the top of whatever group they land in; within the
 * pinned and unpinned runs, manual drag order (`orderIndex`) is preserved.
 */
function pinnedFirst(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || a.orderIndex - b.orderIndex,
  );
}

/**
 * Split active tasks into display sections for the current view.
 * Today groups overdue vs. due-today; Upcoming groups by date;
 * Inbox and label views are a single untitled section. Within every
 * group, pinned tasks are sorted to the top.
 */
export function sectionsForView(tasks: Task[], view: ViewId): Section[] {
  const t = today();

  if (view.kind === "today") {
    const overdue = tasks.filter((x) => x.dueDate && x.dueDate < t);
    const due = tasks.filter((x) => x.dueDate === t);
    const out: Section[] = [];
    if (overdue.length)
      out.push({ key: "overdue", title: "Overdue", tone: "overdue", tasks: pinnedFirst(overdue) });
    out.push({ key: "today", title: "Today", tasks: pinnedFirst(due) });
    return out;
  }

  if (view.kind === "upcoming") {
    const byDate = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const list = byDate.get(task.dueDate) ?? [];
      list.push(task);
      byDate.set(task.dueDate, list);
    }
    return [...byDate.keys()]
      .sort()
      .map((date) => ({
        key: date,
        title: upcomingTitle(date),
        tasks: pinnedFirst(byDate.get(date)!),
      }));
  }

  if (view.kind === "completed") {
    // Most recently completed first, with pinned ones still on top.
    const sorted = [...tasks].sort(
      (a, b) =>
        new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime(),
    );
    return [{ key: "all", title: null, tasks: pinnedFirst(sorted) }];
  }

  // Inbox / label / pinned: no grouping.
  return [{ key: "all", title: null, tasks: pinnedFirst(tasks) }];
}
