import type { BoardColumnDefinition, Task } from "../types";
import { toLocalDate, today } from "./dates";

export const TODO_COLUMN = "todo";
export const DONE_COLUMN = "done";
export type ColumnId = string;

export const STAGES = [
  { slug: TODO_COLUMN, title: "To do", hint: "Ready to pick up" },
  { slug: "doing", title: "In progress", hint: "Being worked on now" },
  { slug: "blocked", title: "Blocked", hint: "Waiting on something else" },
] as const;

export const DEFAULT_COLUMNS: BoardColumnDefinition[] = [
  ...STAGES.map(({ slug, title }, index) => ({
    id: slug, name: title, color: ["#6c7cff", "#38bdf8", "#f2b155"][index],
    orderIndex: index, wipLimit: null, updatedAt: "1970-01-01T00:00:01Z",
    deletedAt: null, replacementId: null,
  })),
  { id: DONE_COLUMN, name: "Done", color: "#4fd18b", orderIndex: 3,
    wipLimit: null, updatedAt: "1970-01-01T00:00:01Z", deletedAt: null, replacementId: null },
];

export function orderedColumns(definitions: BoardColumnDefinition[]): BoardColumnDefinition[] {
  const live = definitions.filter((column) => !column.deletedAt);
  for (const id of [TODO_COLUMN, DONE_COLUMN]) {
    if (!live.some((column) => column.id === id)) live.push(DEFAULT_COLUMNS.find((column) => column.id === id)!);
  }
  return live.sort((a, b) => Number(a.id === DONE_COLUMN) - Number(b.id === DONE_COLUMN) ||
    a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
}

export type BoardScope = "all" | "today" | "week";

export const SCOPES: { id: BoardScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];

const SCOPE_KEY = "todofy-board-scope";

/** Read outside the view too, so keyboard nav walks exactly what's on screen. */
export function readBoardScope(): BoardScope {
  const stored = localStorage.getItem(SCOPE_KEY);
  return SCOPES.some((s) => s.id === stored) ? (stored as BoardScope) : "all";
}

export function writeBoardScope(scope: BoardScope): void {
  localStorage.setItem(SCOPE_KEY, scope);
}

export interface BoardColumn {
  id: ColumnId;
  title: string;
  hint: string;
  color: string;
  wipLimit: number | null;
  activeCount: number;
  wipState: "none" | "below" | "full" | "over";
  tasks: Task[];
}

/** Resolve deleted IDs through their replacement chain; unknown IDs stay visible. */
export function stageOf(task: Task, definitions = DEFAULT_COLUMNS): ColumnId {
  let id = task.stage ?? TODO_COLUMN;
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const column = definitions.find((item) => item.id === id && item.id !== DONE_COLUMN);
    if (!column) return TODO_COLUMN;
    if (!column.deletedAt) return column.id;
    id = column.replacementId ?? TODO_COLUMN;
  }
  return TODO_COLUMN;
}

export function columnOf(task: Task, definitions = DEFAULT_COLUMNS): ColumnId {
  return task.status === "done" ? DONE_COLUMN : stageOf(task, definitions);
}

/**
 * Narrow the board to a time window. Undated tasks stay visible in every scope
 * — hiding them would make the board quietly lose work.
 */
export function inScope(task: Task, scope: BoardScope): boolean {
  if (scope === "all" || !task.dueDate) return true;
  const t = today();
  if (scope === "today") return task.dueDate <= t;
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);
  return task.dueDate <= toLocalDate(horizon);
}

/**
 * Group tasks into columns, each sorted by manual order. Done is capped
 * because it grows without limit; the full history has its own view.
 */
export function boardColumns(
  tasks: Task[],
  definitions = DEFAULT_COLUMNS,
  allTasks = tasks,
  doneLimit = 15,
): BoardColumn[] {
  const byColumn = new Map<ColumnId, Task[]>();
  const totals = new Map<ColumnId, number>();
  for (const task of allTasks) {
    if (task.status !== "active") continue;
    const id = stageOf(task, definitions);
    totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  for (const task of tasks) {
    const id = columnOf(task, definitions);
    const list = byColumn.get(id) ?? [];
    list.push(task);
    byColumn.set(id, list);
  }
  return orderedColumns(definitions).map((definition) => {
    const done = definition.id === DONE_COLUMN;
    const activeCount = totals.get(definition.id) ?? 0;
    const wipLimit = done ? null : definition.wipLimit;
    const items = byColumn.get(definition.id) ?? [];
    items.sort(done
      ? (a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")
      : (a, b) => Number(b.pinned) - Number(a.pinned) || a.boardIndex - b.boardIndex || a.createdAt.localeCompare(b.createdAt));
    return {
      id: definition.id, title: definition.name, color: definition.color, wipLimit, activeCount,
      hint: done ? "Finished recently" : STAGES.find((s) => s.slug === definition.id)?.hint ?? "Your workflow",
      wipState: wipLimit === null ? "none" : activeCount > wipLimit ? "over" : activeCount === wipLimit ? "full" : "below",
      tasks: done ? items.slice(0, doneLimit) : items,
    };
  });
}

/**
 * Where a task lands if nudged one column left or right — the keyboard's
 * equivalent of a drag, null at either end. The card joins the bottom of its
 * new column, so the move needs no second "which slot?" decision.
 */
export function nudgeColumn(
  task: Task,
  tasks: Task[],
  direction: 1 | -1,
  definitions = DEFAULT_COLUMNS,
): { column: ColumnId; boardIndex: number } | null {
  const order = orderedColumns(definitions).map((column) => column.id);
  const current = columnOf(task, definitions);
  const to = order.indexOf(current) + direction;
  if (to < 0 || to >= order.length) return null;

  // Leaving Done re-opens the task, and `stage` still records where it was
  // working before it was finished — so it goes back there rather than to
  // whichever column happens to sit to the left of Done.
  const column = current === DONE_COLUMN ? stageOf(task, definitions) : order[to];
  const last = tasks
    .filter((t) => t.id !== task.id && columnOf(t, definitions) === column)
    .reduce((max, t) => Math.max(max, t.boardIndex), Number.NEGATIVE_INFINITY);
  return {
    column,
    boardIndex: last === Number.NEGATIVE_INFINITY ? 0 : last + 1,
  };
}
