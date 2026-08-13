import { tasksForView, useStore } from "../store";
import { sectionsForView } from "../lib/grouping";
import type { Task, ViewId } from "../types";
import { QuickAdd } from "./QuickAdd";
import { TaskItem } from "./TaskItem";
import { TaskSection } from "./TaskSection";
import { LabelsView } from "./LabelsView";

function viewTitle(view: ViewId, labelName?: string): string {
  switch (view.kind) {
    case "inbox":
      return "Inbox";
    case "today":
      return "Today";
    case "upcoming":
      return "Upcoming";
    case "pinned":
      return "Pinboard";
    case "completed":
      return "Completed";
    case "labels":
      return "Labels";
    case "label":
      return labelName ?? "Label";
  }
}

function viewSubtitle(view: ViewId): string {
  switch (view.kind) {
    case "inbox":
      return "Tasks without a date";
    case "today":
      return "Due today and overdue";
    case "upcoming":
      return "Scheduled for later";
    case "pinned":
      return "Tasks you've pinned to the top";
    case "completed":
      return "Everything you've finished";
    case "labels":
      return "Manage your labels";
    case "label":
      return "Tagged tasks";
  }
}

export function TaskList() {
  const { tasks, labels, view, loading } = useStore();
  if (view.kind === "labels") return <LabelsView />;

  const labelName =
    view.kind === "label"
      ? labels.find((l) => l.id === view.labelId)?.name
      : undefined;

  const isCompletedView = view.kind === "completed";
  const showQuickAdd = view.kind !== "completed" && view.kind !== "pinned";

  const inView = tasksForView(tasks, view);
  const active = inView.filter((t) => t.status === "active");
  const done = inView.filter((t) => t.status === "done");
  const sections = sectionsForView(isCompletedView ? inView : active, view).filter(
    (s) => s.tasks.length > 0,
  );

  return (
    <main class="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="shrink-0 px-8 pt-8 pb-4">
        <h2 class="text-2xl font-semibold tracking-tight">
          {viewTitle(view, labelName)}
        </h2>
        <p class="mt-0.5 text-sm text-[var(--color-muted)]">
          {viewSubtitle(view)}
        </p>
      </header>

      {showQuickAdd && (
        <div class="mx-auto w-full max-w-2xl px-8">
          <QuickAdd />
        </div>
      )}

      <div class="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-4 pb-8">
        {loading ? (
          <Skeleton />
        ) : active.length === 0 && done.length === 0 ? (
          <Empty view={view} />
        ) : (
          <>
            {sections.map((section) => (
              <div key={section.key} class="mb-5">
                {section.title && (
                  <p
                    class={`mb-1 px-3 text-xs font-semibold uppercase tracking-wider ${
                      section.tone === "overdue"
                        ? "text-[var(--color-danger)]"
                        : "text-[var(--color-faint)]"
                    }`}
                  >
                    {section.title}
                    <span class="ml-1.5 font-normal opacity-70">
                      {section.tasks.length}
                    </span>
                  </p>
                )}
                <TaskSection
                  tasks={section.tasks}
                  reorderable={!isCompletedView}
                />
              </div>
            ))}

            {done.length > 0 && !isCompletedView && (
              <div class="mt-6">
                <p class="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
                  Completed · {done.length}
                </p>
                <div class="flex flex-col gap-0.5 opacity-70">
                  {done.map((t: Task) => (
                    <TaskItem key={t.id} task={t} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Empty({ view }: { view: ViewId }) {
  const msg =
    view.kind === "today"
      ? "Nothing due today. Enjoy the calm. ✨"
      : view.kind === "upcoming"
        ? "No upcoming tasks scheduled."
        : view.kind === "inbox"
          ? "Inbox zero. Add a task to get started."
          : view.kind === "pinned"
            ? "No pinned tasks yet. Pin one to keep it front and center."
            : view.kind === "completed"
              ? "Nothing completed yet."
              : "No tasks with this label yet.";
  return (
    <div class="mt-16 flex flex-col items-center gap-2 text-center">
      <div class="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--color-surface)] text-2xl">
        🗒️
      </div>
      <p class="text-sm text-[var(--color-muted)]">{msg}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div class="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          class="h-11 animate-pulse rounded-lg bg-[var(--color-surface)]"
        />
      ))}
    </div>
  );
}
