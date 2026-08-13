import { invoke } from "@tauri-apps/api/core";
import type { Label, NewTask, Task, TaskPatch } from "../types";

export const api = {
  listTasks: () => invoke<Task[]>("list_tasks"),
  createTask: (task: NewTask) => invoke<Task>("create_task", { task }),
  updateTask: (patch: TaskPatch) => invoke<Task>("update_task", { patch }),
  reorderTask: (id: number, orderIndex: number) =>
    invoke<Task>("reorder_task", { id, orderIndex }),
  toggleTask: (id: number, done: boolean) =>
    invoke<Task>("toggle_task", { id, done }),
  deleteTask: (id: number) => invoke<void>("delete_task", { id }),

  listLabels: () => invoke<Label[]>("list_labels"),
  createLabel: (name: string, color: string) =>
    invoke<Label>("create_label", { name, color }),
  updateLabel: (id: number, name: string, color: string) =>
    invoke<Label>("update_label", { id, name, color }),
  deleteLabel: (id: number) => invoke<void>("delete_label", { id }),
};
