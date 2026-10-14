import { expect, test } from "bun:test";
import { boardColumns, DEFAULT_COLUMNS, columnOf, DONE_COLUMN, nudgeColumn, stageOf, STAGES } from "./board";
import type { Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "task",
    notes: null,
    dueDate: null,
    remindAt: null,
    status: "active",
    priority: 4,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    orderIndex: 0,
    pinned: false,
    repeat: null,
    estimateMinutes: null,
    stage: null,
    boardIndex: 0,
    trackedSeconds: 0,
    labelIds: [],
    subtasks: [],
    ...overrides,
  };
}

test("an unplaced or unknown stage reads as the first column", () => {
  expect(stageOf(task({ stage: null }))).toBe(STAGES[0].slug);
  expect(stageOf(task({ stage: "a-column-that-was-deleted" }))).toBe(
    STAGES[0].slug,
  );
  expect(stageOf(task({ stage: "blocked" }))).toBe("blocked");
});

test("completion outranks the stage a task still carries", () => {
  expect(columnOf(task({ stage: "blocked", status: "done" }))).toBe(
    DONE_COLUMN,
  );
  expect(columnOf(task({ stage: "blocked" }))).toBe("blocked");
});

test("nudging walks one column at a time and stops at both ends", () => {
  const todo = task({ stage: "todo" });
  expect(nudgeColumn(todo, [todo], 1)?.column).toBe("doing");
  expect(nudgeColumn(todo, [todo], -1)).toBeNull();

  const done = task({ status: "done" });
  expect(nudgeColumn(done, [done], 1)).toBeNull();
});

test("leaving Done returns the task to the stage it was working in", () => {
  const done = task({ stage: "blocked", status: "done" });
  // Not "doing", which is merely the column sitting to the left of Done.
  expect(nudgeColumn(done, [done], -1)?.column).toBe("blocked");
});

test("a re-opened task with no stage falls back to the first column", () => {
  const done = task({ stage: null, status: "done" });
  expect(nudgeColumn(done, [done], -1)?.column).toBe(STAGES[0].slug);
});

test("a nudged card lands after the last one already in the target column", () => {
  const moving = task({ id: "moving", stage: "todo" });
  const others = [
    task({ id: "a", stage: "doing", boardIndex: 3 }),
    task({ id: "b", stage: "doing", boardIndex: 7 }),
    task({ id: "c", stage: "blocked", boardIndex: 99 }),
  ];
  expect(nudgeColumn(moving, [moving, ...others], 1)).toEqual({
    column: "doing",
    boardIndex: 8,
  });
});

test("the first card into an empty column starts the order", () => {
  const moving = task({ id: "moving", stage: "todo" });
  expect(nudgeColumn(moving, [moving], 1)).toEqual({
    column: "doing",
    boardIndex: 0,
  });
});

test("custom columns use saved order while unplaced tasks still belong to To do", () => {
  const definitions = [
    ...DEFAULT_COLUMNS.map((c) => ({ ...c, orderIndex: c.id === "todo" ? 5 : c.orderIndex })),
    { ...DEFAULT_COLUMNS[0], id: "review", name: "Review", orderIndex: -1, color: "#f26cc9" },
  ];
  expect(boardColumns([task()], definitions).map((c) => c.id)).toEqual(["review", "doing", "blocked", "todo", "done"]);
  expect(stageOf(task(), definitions)).toBe("todo");
  expect(nudgeColumn(task(), [task()], -1, definitions)?.column).toBe("blocked");
});

test("deleted column replacement chains and unknown stages keep tasks visible", () => {
  const definitions = DEFAULT_COLUMNS.map((c) => ({ ...c,
    deletedAt: c.id === "blocked" || c.id === "doing" ? "2026-01-01T00:00:00Z" : null,
    replacementId: c.id === "blocked" ? "doing" : c.id === "doing" ? "todo" : null,
  }));
  expect(stageOf(task({ stage: "blocked" }), definitions)).toBe("todo");
  expect(boardColumns([task({ stage: "missing" })], definitions).find((c) => c.id === "todo")?.tasks).toHaveLength(1);
  definitions[0].replacementId = "blocked";
  definitions[0].deletedAt = "2026-01-01T00:00:00Z";
  expect(stageOf(task({ stage: "blocked" }), definitions)).toBe("todo");
});

test("WIP uses all active tasks even when only one card is visible", () => {
  const definitions = DEFAULT_COLUMNS.map((c) => ({ ...c, wipLimit: c.id === "doing" ? 2 : null }));
  const tasks = [task({ id: "visible", stage: "doing" }), task({ id: "hidden", stage: "doing" }), task({ id: "later", stage: "doing" }), task({ id: "finished", stage: "doing", status: "done" })];
  const column = boardColumns([tasks[0]], definitions, tasks).find((c) => c.id === "doing")!;
  expect(column.tasks).toHaveLength(1);
  expect(column.activeCount).toBe(3);
  expect(column.wipState).toBe("over");
  expect(boardColumns(tasks.slice(0, 2), definitions).find((c) => c.id === "doing")?.wipState).toBe("full");
});
