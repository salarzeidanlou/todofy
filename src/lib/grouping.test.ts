import { expect, test } from "bun:test";
import { sectionsForView } from "./grouping";
import type { Task } from "../types";

function task(id: string, completedAt: string, orderIndex: number, pinned = false): Task {
  return {
    id, title: id, completedAt, orderIndex, pinned, status: "done",
    notes: null, dueDate: null, remindAt: null, priority: 4,
    createdAt: "2026-01-01T00:00:00Z", repeat: null, estimateMinutes: null,
    stage: null, boardIndex: 0, trackedSeconds: 0, labelIds: [], subtasks: [],
  };
}

test("Completed lists newest completions first even when manual order conflicts", () => {
  const tasks = [task("old", "2026-01-01T12:00:00Z", 0), task("new", "2026-01-02T12:00:00Z", 1)];
  expect(sectionsForView(tasks, { kind: "completed" })[0].tasks.map((t) => t.id)).toEqual(["new", "old"]);
  expect(tasks.map((t) => t.id)).toEqual(["old", "new"]);
});

test("Completed preserves pins and sorts each pin group by completion date", () => {
  const tasks = [
    task("old-pin", "2026-01-01T12:00:00Z", 0, true),
    task("new-pin", "2026-01-02T12:00:00Z", 1, true),
    task("old", "2026-01-03T12:00:00Z", 0),
    task("new", "2026-01-04T12:00:00Z", 1),
  ];
  expect(sectionsForView(tasks, { kind: "completed" })[0].tasks.map((t) => t.id)).toEqual(["new-pin", "old-pin", "new", "old"]);
});

test("active task views keep their manual ordering", () => {
  const tasks = [task("second", "2026-01-01T12:00:00Z", 2), task("first", "2026-01-02T12:00:00Z", 1)];
  expect(sectionsForView(tasks, { kind: "inbox" })[0].tasks.map((t) => t.id)).toEqual(["first", "second"]);
});
