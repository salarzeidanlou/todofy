import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import * as compat from "preact/compat";
import type { Task, TaskPatch } from "../types";

const dom = new Window({ url: "http://localhost" });
// Match the React alias supplied by @preact/preset-vite in the app build.
mock.module("react", () => compat);
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  HTMLInputElement: dom.HTMLInputElement,
  HTMLTextAreaElement: dom.HTMLTextAreaElement,
  KeyboardEvent: dom.KeyboardEvent,
  Event: dom.Event,
  PointerEvent: dom.PointerEvent,
  DOMRect: dom.DOMRect,
  localStorage: dom.localStorage,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
});

const { useStore } = await import("../store");
const { useKeyboard } = await import("./useKeyboard");
const { BoardView } = await import("../components/BoardView");
const { ConfirmDialog } = await import("../components/ConfirmDialog");
const { TaskDetail } = await import("../components/TaskDetail");
const { api } = await import("./api");
const { DEFAULT_COLUMNS } = await import("./board");
const { TaskList } = await import("../components/TaskList");
const { visibleTaskIds } = await import("../store");

const initialState = useStore.getState();
let root: HTMLDivElement;
const toggleTask = mock(async () => {});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task", title: "Task", notes: null, dueDate: null, remindAt: null,
    status: "active", priority: 4, createdAt: "2026-01-01T00:00:00Z",
    completedAt: null, orderIndex: 0, pinned: false, repeat: null,
    estimateMinutes: null, stage: null, boardIndex: 0, trackedSeconds: 0,
    labelIds: [], subtasks: [], ...overrides,
  };
}

function KeyboardBoard() {
  useKeyboard();
  return h(BoardView, {});
}

function KeyboardConfirmation() {
  useKeyboard();
  return h(ConfirmDialog, {});
}

function KeyboardList() {
  useKeyboard();
  return h(TaskList, {});
}

function element<T extends HTMLElement>(selector: string): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found as T;
}

function key(target: EventTarget, key: string, repeat = false) {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key, repeat, bubbles: true, cancelable: true,
  }));
}

beforeEach(() => {
  dom.localStorage.clear();
  toggleTask.mockClear();
  useStore.setState({ ...initialState, view: { kind: "board" }, loading: false, tasks: [task()], toggleTask }, true);
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  useStore.setState(initialState, true);
});

test("Enter opens a recurring board card without completing or advancing it", async () => {
  useStore.setState({ tasks: [task({ repeat: "daily" })] });
  await act(() => render(h(KeyboardBoard, {}), root));
  await act(() => key(element(".board-card"), "Enter"));
  expect(root.querySelector("[data-task-dialog]")).not.toBeNull();
  expect(useStore.getState().selectedId).toBe("task");
  expect(toggleTask).not.toHaveBeenCalled();
});

test("Enter on a nested completion button is owned by that button", async () => {
  useStore.setState({ selectedId: "task" });
  await act(() => render(h(KeyboardBoard, {}), root));
  const button = element<HTMLButtonElement>(".board-card .task-complete");
  await act(() => {
    key(button, "Enter");
    // Browsers synthesize this click for Enter on a native button.
    button.click();
  });
  expect(toggleTask).toHaveBeenCalledTimes(1);
});

test("confirmation Enter runs the confirmation without completing the background task", async () => {
  const confirm = mock(async () => {});
  useStore.setState({ selectedId: "task", confirm: { title: "Delete?", onConfirm: confirm } });
  await act(() => render(h(KeyboardConfirmation, {}), root));
  await act(() => key(document.body, "Enter"));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(toggleTask).not.toHaveBeenCalled();
});

test("Enter on Cancel does not run the confirmation", async () => {
  const confirm = mock(async () => {});
  useStore.setState({ selectedId: "task", confirm: { title: "Delete?", onConfirm: confirm } });
  await act(() => render(h(KeyboardConfirmation, {}), root));
  const cancel = element<HTMLButtonElement>("button");
  await act(() => { key(cancel, "Enter"); cancel.click(); });
  expect(confirm).not.toHaveBeenCalled();
  expect(toggleTask).not.toHaveBeenCalled();
  expect(useStore.getState().confirm).toBeNull();
});

test("holding a completion shortcut does not advance a recurring task repeatedly", async () => {
  useStore.setState({ selectedId: "task" });
  await act(() => render(h(KeyboardBoard, {}), root));
  await act(() => { key(document.body, "c"); key(document.body, "c", true); });
  expect(toggleTask).toHaveBeenCalledTimes(1);
});

function input(field: HTMLInputElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function blur(field: HTMLInputElement) {
  field.dispatchEvent(new Event("focusout", { bubbles: true }));
}

test("synced title and notes refresh untouched fields without writing stale text back", async () => {
  const patchTask = mock(async (_patch: TaskPatch) => {});
  useStore.setState({ patchTask });
  await act(() => render(h(TaskDetail, { taskId: "task" }), root));
  await act(() => useStore.setState({ tasks: [task({ title: "Remote title", notes: "Remote notes" })] }));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  const notes = element<HTMLInputElement>('[aria-label="Task notes"]');
  expect(title.value).toBe("Remote title");
  expect(notes.value).toBe("Remote notes");
  await act(() => { blur(title); blur(notes); });
  expect(patchTask).not.toHaveBeenCalled();
});

test("sync preserves an unsaved title while refreshing untouched notes", async () => {
  const patchTask = mock(async (_patch: TaskPatch) => {});
  useStore.setState({ patchTask });
  await act(() => render(h(TaskDetail, { taskId: "task" }), root));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  await act(() => input(title, "My unsaved title"));
  await act(() => useStore.setState({ tasks: [task({ title: "Remote title", notes: "Remote notes" })] }));
  expect(title.value).toBe("My unsaved title");
  expect(element<HTMLInputElement>('[aria-label="Task notes"]').value).toBe("Remote notes");
  await act(() => blur(title));
  expect(patchTask).toHaveBeenCalledWith({ id: "task", title: "My unsaved title" });
});

test("a save response preserves newer text typed while the save is pending", async () => {
  let finish!: () => void;
  useStore.setState({ patchTask: async (patch) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    useStore.setState({ tasks: [task({ title: patch.title })] });
  } });
  await act(() => render(h(TaskDetail, { taskId: "task" }), root));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  await act(() => input(title, "First edit"));
  await act(() => blur(title));
  await act(() => input(title, "Newer draft"));
  await act(async () => { finish(); await Promise.resolve(); });
  expect(title.value).toBe("Newer draft");
});

test("switching tasks resets drafts and cannot leak text into the next task", async () => {
  useStore.setState({ selectedId: "task", tasks: [task(), task({ id: "second", title: "Second task" })] });
  await act(() => render(h(TaskDetail, { taskId: undefined }), root));
  await act(() => input(element('[aria-label="Task title"]'), "Unsaved first task"));
  await act(() => useStore.getState().select("second"));
  expect(element<HTMLInputElement>('[aria-label="Task title"]').value).toBe("Second task");
});

test("a failed save preserves the draft and shows an actionable error", async () => {
  useStore.setState({ patchTask: async () => { throw new Error("Database unavailable"); } });
  await act(() => render(h(TaskDetail, { taskId: "task" }), root));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  await act(() => input(title, "Keep this edit"));
  await act(async () => { blur(title); await Promise.resolve(); });
  expect(title.value).toBe("Keep this edit");
  expect(element('[role="alert"]').textContent).toContain("Could not save the title");
});

function completedTasks(count: number) {
  return Array.from({ length: count }, (_, i) => task({
    id: `done-${i}`, title: `Completed ${i}`, status: "done", orderIndex: i,
    completedAt: new Date(Date.UTC(2026, 0, count - i)).toISOString(),
  }));
}

test("Completed keyboard navigation follows page two and stops at its boundary", async () => {
  useStore.setState({ view: { kind: "completed" }, tasks: completedTasks(32) });
  useStore.getState().setCompletedPage(2);
  await act(() => render(h(KeyboardList, {}), root));
  const displayed = Array.from(root.querySelectorAll(".task-row-title p"), (row) => row.textContent);
  expect(displayed).toEqual(Array.from({ length: 15 }, (_, i) => `Completed ${i + 15}`));
  expect(visibleTaskIds(useStore.getState().tasks, { kind: "completed" })).toEqual(
    Array.from({ length: 15 }, (_, i) => `done-${i + 15}`),
  );
  await act(() => key(document.body, "j"));
  expect(useStore.getState().selectedId).toBe("done-15");
  await act(() => { for (let i = 0; i < 20; i++) key(document.body, "j"); });
  expect(useStore.getState().selectedId).toBe("done-29");
});

test("search resets Completed to page one and clears the previous selection", async () => {
  useStore.setState({ view: { kind: "completed" }, tasks: completedTasks(32) });
  useStore.getState().setCompletedPage(2);
  useStore.getState().select("done-20");
  await act(() => render(h(KeyboardList, {}), root));
  await act(() => useStore.getState().setSearchQuery("Completed 31"));
  expect(useStore.getState().completedPage).toBe(1);
  expect(useStore.getState().selectedId).toBeNull();
  expect(root.querySelectorAll(".task-row")).toHaveLength(1);
  await act(() => key(document.body, "j"));
  expect(useStore.getState().selectedId).toBe("done-31");
});

test("removing the last Completed page clamps both the list and keyboard navigation", async () => {
  const tasks = completedTasks(32);
  useStore.setState({ view: { kind: "completed" }, tasks });
  useStore.getState().setCompletedPage(3);
  await act(() => render(h(KeyboardList, {}), root));
  await act(() => useStore.setState({ tasks: tasks.slice(0, 30) }));
  expect(useStore.getState().completedPage).toBe(2);
  expect(root.querySelectorAll(".task-row")).toHaveLength(15);
  await act(() => key(document.body, "j"));
  expect(useStore.getState().selectedId).toBe("done-15");
});

test("completion shortcuts cannot mutate an off-page selection", async () => {
  useStore.setState({ view: { kind: "completed" }, tasks: completedTasks(32) });
  useStore.getState().setCompletedPage(2);
  useStore.getState().select("done-0");
  await act(() => render(h(KeyboardList, {}), root));
  await act(() => key(document.body, "c"));
  expect(toggleTask).not.toHaveBeenCalled();
  expect(root.querySelector(".next-up-card")).toBeNull();
});

test("the board shows saved names and global WIP counts under search", async () => {
  useStore.setState({
    boardDefinitions: DEFAULT_COLUMNS.map((c) => ({ ...c, name: c.id === "doing" ? "Working" : c.name, wipLimit: c.id === "doing" ? 1 : null })),
    tasks: [task({ title: "Visible", stage: "doing" }), task({ id: "hidden", title: "Hidden", stage: "doing" })],
    searchQuery: "Visible",
  });
  await act(() => render(h(KeyboardBoard, {}), root));
  expect(element('[aria-label="Working"] .board-column-count').textContent).toBe("2/1");
  expect(element('[aria-label="Working"] .board-column-count').classList.contains("wip-over")).toBe(true);
  expect(element('[aria-label="Working"] small').textContent).toContain("1 shown");
});

test("column management saves name, color and WIP settings without task shortcuts", async () => {
  const update = mock(async (id: string, input: { name: string; color: string; wipLimit: number | null }) => {
    useStore.setState({ boardDefinitions: useStore.getState().boardDefinitions.map((c) => c.id === id ? { ...c, ...input } : c) });
  });
  useStore.setState({ selectedId: "task", updateBoardColumn: update });
  await act(() => render(h(KeyboardBoard, {}), root));
  await act(() => element<HTMLButtonElement>('[aria-label="Edit In progress column"]').click());
  const fields = root.querySelectorAll<HTMLInputElement>(".column-editor input");
  await act(() => { input(fields[0], "Writing"); input(fields[1], "#f26cc9"); input(fields[2], "3"); });
  await act(() => key(document.body, "c"));
  expect(toggleTask).not.toHaveBeenCalled();
  await act(async () => { element<HTMLButtonElement>('.column-editor button[type="submit"]').click(); await Promise.resolve(); });
  expect(update).toHaveBeenCalledWith("doing", { name: "Writing", color: "#f26cc9", wipLimit: 3 });
  expect(root.querySelector('[aria-label="Writing"]')).not.toBeNull();
});

test("column reorder buttons preserve Done last and the default destination", async () => {
  const reorder = mock(async (ids: string[]) => {
    useStore.setState({ boardDefinitions: useStore.getState().boardDefinitions.map((c) => ({ ...c, orderIndex: ids.indexOf(c.id) })) });
  });
  useStore.setState({ reorderBoardColumns: reorder });
  await act(() => render(h(KeyboardBoard, {}), root));
  await act(() => element<HTMLButtonElement>(".board-manage-button").click());
  await act(async () => { element<HTMLButtonElement>('[aria-label="Move To do right"]').click(); await Promise.resolve(); });
  expect(reorder).toHaveBeenCalledWith(["doing", "todo", "blocked", "done"]);
  expect(element<HTMLButtonElement>('[aria-label="Move Done right"]').disabled).toBe(true);
});

test("pointer dragging reorders columns and pointer cancellation leaves them unchanged", async () => {
  const reorder = mock(async (_ids: string[]) => {});
  useStore.setState({ reorderBoardColumns: reorder });
  await act(() => render(h(KeyboardBoard, {}), root));
  await act(() => element<HTMLButtonElement>(".board-manage-button").click());
  root.querySelectorAll<HTMLElement>(".column-manager-row").forEach((row, index) => {
    row.getBoundingClientRect = () => new DOMRect(0, index * 60, 400, 40);
  });
  const handle = element<HTMLButtonElement>('[aria-label="Drag Blocked to reorder"]');
  await act(() => {
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientY: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  expect(reorder).not.toHaveBeenCalled();
  await act(async () => {
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientY: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await Promise.resolve();
  });
  expect(reorder).toHaveBeenCalledWith(["blocked", "todo", "doing", "done"]);
});

test("deleting a column requires a destination and never offers protected column deletion", async () => {
  const remove = mock(async (_id: string, _destination: string) => {});
  useStore.setState({ deleteBoardColumn: remove });
  await act(() => render(h(KeyboardBoard, {}), root));
  await act(() => element<HTMLButtonElement>(".board-manage-button").click());
  expect(root.querySelectorAll(".column-delete")).toHaveLength(2);
  await act(() => element<HTMLButtonElement>(".column-delete").click());
  await act(async () => { element<HTMLButtonElement>(".column-danger-button").click(); await Promise.resolve(); });
  expect(remove).toHaveBeenCalledWith("doing", "todo");
});

test("moving into a full column succeeds and warns using unfiltered task totals", async () => {
  const tasks = [task({ id: "moving", stage: "todo" }), task({ id: "hidden", stage: "doing", title: "Hidden" })];
  useStore.setState({ tasks, searchQuery: "moving", boardDefinitions: DEFAULT_COLUMNS.map((c) => ({ ...c, wipLimit: c.id === "doing" ? 1 : null })) });
  const native = spyOn(api, "moveTaskToStage").mockImplementation(async (id, stage, boardIndex) => [task({ id, stage, boardIndex })]);
  try {
    await initialState.moveTaskToColumn("moving", "doing", 1);
    expect(useStore.getState().tasks.find((t) => t.id === "moving")?.stage).toBe("doing");
    expect(useStore.getState().boardNotice).toContain("2/1");
    await initialState.moveTaskToColumn("moving", "doing", 2);
    expect(useStore.getState().boardNotice).toBeNull();
  } finally { native.mockRestore(); }
});

test("moving a completed task uses one native move and warns about its new WIP count", async () => {
  useStore.setState({ tasks: [task({ status: "done" }), task({ id: "other", stage: "doing" })], boardDefinitions: DEFAULT_COLUMNS.map((c) => ({ ...c, wipLimit: c.id === "doing" ? 1 : null })) });
  const native = spyOn(api, "moveTaskToStage").mockImplementation(async (id, stage, boardIndex) => [task({ id, stage, boardIndex, status: "active" })]);
  try {
    await initialState.moveTaskToColumn("task", "doing", 1);
    expect(toggleTask).not.toHaveBeenCalled();
    expect(native).toHaveBeenCalledTimes(1);
    expect(useStore.getState().boardNotice).toContain("2/1");
  } finally { native.mockRestore(); }
});

test("canceling a card drag never commits a move", async () => {
  const move = mock(async (_id: string, _column: string, _index: number) => {});
  useStore.setState({ moveTaskToColumn: move });
  await act(() => render(h(KeyboardBoard, {}), root));
  root.querySelectorAll<HTMLElement>(".board-column").forEach((column, i) => {
    column.getBoundingClientRect = () => new DOMRect(i * 300, 0, 274, 400);
  });
  element<HTMLElement>(".board-columns").getBoundingClientRect = () => new DOMRect(0, 0, 1200, 400);
  await act(() => {
    element(".board-card").dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 50, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 350, clientY: 50, bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  expect(move).not.toHaveBeenCalled();
});
