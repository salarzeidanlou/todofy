import { tasksForView, useStore } from "../store";
import { sectionsForView } from "../lib/grouping";
import { completionStats } from "../lib/streak";
import type { Task, ViewId } from "../types";
import { QuickAdd } from "./QuickAdd";
import { TaskItem } from "./TaskItem";
import { TaskSection } from "./TaskSection";
import { LabelsView } from "./LabelsView";
import { SettingsView } from "./SettingsView";
import { FocusView } from "./FocusView";

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
    case "settings":
      return "Settings";
    case "focus":
      return "Focus";
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
    case "settings":
      return "Startup, appearance, and about";
    case "focus":
      return "Pomodoro and focus history";
    case "label":
      return "Tagged tasks";
  }
}

export function TaskList() {
  const { tasks, labels, view, loading, rescheduleOverdue } = useStore();
  if (view.kind === "labels") return <LabelsView />;
  if (view.kind === "settings") return <SettingsView />;
  if (view.kind === "focus") return <FocusView />;

  const labelName =
    view.kind === "label"
      ? labels.find((l) => l.id === view.labelId)?.name
      : undefined;

  const isCompletedView = view.kind === "completed";
  const showQuickAdd = view.kind !== "completed" && view.kind !== "pinned";
  const stats = completionStats(tasks);
  const showStats =
    (view.kind === "today" || view.kind === "completed") &&
    (stats.doneToday > 0 || stats.streak > 0);

  const inView = tasksForView(tasks, view);
  const active = inView.filter((t) => t.status === "active");
  const done = inView.filter((t) => t.status === "done");
  const sections = sectionsForView(isCompletedView ? inView : active, view).filter(
    (s) => s.tasks.length > 0,
  );

  return (
    <main class="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="shrink-0 px-8 pt-8 pb-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-2xl font-semibold tracking-tight">
            {viewTitle(view, labelName)}
          </h2>
          {showStats && (
            <div class="flex items-center gap-2 text-xs">
              {stats.doneToday > 0 && (
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 font-medium text-[var(--color-success)]"
                  title={`${stats.doneToday} completed today`}
                >
                  ✓ {stats.doneToday} today
                </span>
              )}
              {stats.streak > 1 && (
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 font-medium text-[var(--color-warning)]"
                  title={`${stats.streak}-day completion streak`}
                >
                  🔥 {stats.streak}-day streak
                </span>
              )}
            </div>
          )}
        </div>
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
                  <div class="mb-1 flex items-center justify-between px-3">
                    <p
                      class={`text-xs font-semibold uppercase tracking-wider ${
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
                    {section.tone === "overdue" && (
                      <button
                        onClick={() => rescheduleOverdue()}
                        class="rounded-md px-2 py-0.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                        title="Move all overdue tasks to today"
                      >
                        Reschedule to today
                      </button>
                    )}
                  </div>
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
  // Views where adding a task makes sense — surface the global capture hotkey.
  const showHint =
    view.kind === "inbox" ||
    view.kind === "today" ||
    view.kind === "upcoming" ||
    view.kind === "label";
  return (
    <div class="mt-16 flex flex-col items-center gap-2 text-center">
      <div class="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--color-surface)] text-2xl">
        🗒️
      </div>
      <p class="text-sm text-[var(--color-muted)]">{msg}</p>
      {showHint && (
        <p class="mt-1 text-xs text-[var(--color-faint)]">
          Tip: press{" "}
          <kbd class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-sans text-[var(--color-muted)]">
            Ctrl
          </kbd>{" "}
          +{" "}
          <kbd class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-sans text-[var(--color-muted)]">
            Alt
          </kbd>{" "}
          +{" "}
          <kbd class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-sans text-[var(--color-muted)]">
            A
          </kbd>{" "}
          anywhere to capture a task.
        </p>
      )}
      {showHint && (
        <p class="text-xs text-[var(--color-faint)]">
          Press{" "}
          <kbd class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-sans text-[var(--color-muted)]">
            ?
          </kbd>{" "}
          for keyboard shortcuts.
        </p>
      )}
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
