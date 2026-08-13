export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  dueDate: string | null; // YYYY-MM-DD
  remindAt: string | null; // ISO datetime
  status: "active" | "done";
  priority: 1 | 2 | 3 | 4;
  createdAt: string;
  completedAt: string | null;
  orderIndex: number;
  pinned: boolean;
  labelIds: number[];
}

export interface NewTask {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  priority?: number;
  labelIds?: number[];
}

export interface TaskPatch {
  id: number;
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  priority?: number;
  labelIds?: number[];
  pinned?: boolean;
}

/** A reminder that has fired, shown as an in-app toast. */
export interface ActiveReminder {
  id: number;
  title: string;
}

/** Built-in smart views plus dynamic label views. */
export type ViewId =
  | { kind: "inbox" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "pinned" }
  | { kind: "completed" }
  | { kind: "labels" }
  | { kind: "label"; labelId: number };
