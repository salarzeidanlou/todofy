import { useEffect } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { applySearchAndFilters, tasksForView, useStore } from "../store";
import {
  completedTasksPage,
  COMPLETED_PAGE_SIZE,
  sectionsForView,
} from "../lib/grouping";
import { completionStats } from "../lib/streak";
import type { Task, ViewId } from "../types";
import { QuickAdd } from "./QuickAdd";
import { TaskItem } from "./TaskItem";
import { TaskSection } from "./TaskSection";
import { LabelsView } from "./LabelsView";
import { FocusView } from "./FocusView";
import { CalendarView } from "./CalendarView";
import { BoardView } from "./BoardView";
import { SearchBar } from "./SearchBar";
import { TaskDetail } from "./TaskDetail";
import { ChevronLeftIcon, ChevronRightIcon, InboxIcon } from "./Icons";

const SettingsView = lazy(() =>
  import("./SettingsView").then(({ SettingsView }) => ({ default: SettingsView })),
);
const JournalView = lazy(() =>
  import("./JournalView").then(({ JournalView }) => ({ default: JournalView })),
);

function viewTitle(view: ViewId, labelName?: string): string {
  switch (view.kind) {
    case "inbox":
      return "Inbox";
    case "today":
      return new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    case "upcoming":
      return "Upcoming";
    case "date":
      return new Date(view.date + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
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
    case "journal":
      return "Journal";
    case "calendar":
      return "Calendar";
    case "board":
      return "Board";
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
    case "date":
      return "A focused plan for this day";
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
    case "journal":
      return "Write and reflect";
    case "calendar":
      return "Tasks and events by month";
    case "board":
      return "Move work across stages";
    case "label":
      return "Tagged tasks";
  }
}

export function TaskList() {
  const {
    tasks,
    labels,
    view,
    loading,
    selectedId,
    completedPage,
    setCompletedPage,
    searchQuery,
    filterLabelIds,
    filterPriorities,
    clearFilters,
    rescheduleOverdue,
    loadError,
    load,
  } = useStore();
  const inView = applySearchAndFilters(
    tasksForView(tasks, view),
    searchQuery,
    filterLabelIds,
    filterPriorities,
  );
  const completed = completedTasksPage(
    view.kind === "completed" ? inView : [],
    completedPage,
  );

  useEffect(() => {
    // Deleting/reopening tasks can remove the last page. Persist the clamp so
    // adding tasks later doesn't unexpectedly jump back to that old page.
    if (view.kind === "completed" && completedPage !== completed.page) {
      setCompletedPage(completed.page);
    }
  }, [view.kind, completedPage, completed.page, setCompletedPage]);

  if (view.kind === "labels") return <LabelsView />;
  if (view.kind === "focus") return <FocusView />;
  if (view.kind === "calendar") return <CalendarView />;
  if (view.kind === "board") return <BoardView />;
  if (view.kind === "settings" || view.kind === "journal") {
    return (
      <Suspense
        fallback={
          <main class="redesign-main" aria-busy="true">
            <div class="task-page-scroll" role="status">Opening view…</div>
          </main>
        }
      >
        {view.kind === "settings" && <SettingsView />}
        {view.kind === "journal" && <JournalView />}
      </Suspense>
    );
  }

  const labelName =
    view.kind === "label"
      ? labels.find((label) => label.id === view.labelId)?.name
      : undefined;
  const isCompletedView = view.kind === "completed";
  const showQuickAdd = view.kind !== "completed" && view.kind !== "pinned";
  const stats = completionStats(tasks);
  const showStats =
    (view.kind === "today" || view.kind === "completed") &&
    (stats.doneToday > 0 || stats.streak > 1);

  const active = inView.filter((task) => task.status === "active");
  const done = inView.filter((task) => task.status === "done");
  const selected = (isCompletedView ? completed.tasks : inView).find(
    (task) => task.id === selectedId,
  );
  const selectedActive = active.find((task) => task.id === selectedId);
  // Daily views always surface the next active task. Pinboard and Completed
  // stay compact until the user explicitly chooses a task to inspect.
  const detailTask =
    view.kind === "pinned" || isCompletedView
      ? selected
      : selectedActive ?? active[0];
  const showTaskDetail = !!detailTask;
  const hasFilters =
    searchQuery.trim() !== "" ||
    filterLabelIds.length > 0 ||
    filterPriorities.length > 0;
  const {
    page: currentCompletedPage,
    pageCount: completedPageCount,
    start: completedPageStart,
  } = completed;
  const sections = (isCompletedView
    ? [{ key: "all", title: null, tasks: completed.tasks }]
    : sectionsForView(active, view)
  ).filter((section) => section.tasks.length > 0);

  const changeCompletedPage = (page: number) => {
    setCompletedPage(page);
    document.querySelector(".task-page-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main class="redesign-main">
      <header class="app-page-header">
        <div>
          <h2>{viewTitle(view, labelName)}</h2>
          <p>{viewSubtitle(view)}</p>
        </div>
        {showStats && (
          <div class="daily-stats">
            {stats.doneToday > 0 && <span>✓ {stats.doneToday} today</span>}
            {stats.streak > 1 && <span>{stats.streak}-day streak</span>}
          </div>
        )}
      </header>

      <div class="task-page-scroll">
        {showTaskDetail && (
          <section class="next-up-section">
            <p class="section-kicker">
              {view.kind === "pinned"
                ? "Pinned task"
                : isCompletedView
                  ? "Completed task"
                  : "Next up"}
            </p>
            <TaskDetail taskId={detailTask.id} />
          </section>
        )}

        <section class="agenda-section">
          <div class="agenda-heading">
            <div>
              <h3>{isCompletedView ? "Completed tasks" : "Your day"}</h3>
              <span>{inView.length} task{inView.length === 1 ? "" : "s"}</span>
            </div>
            <SearchBar />
          </div>

          {loadError && (
            <div class="load-error" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => load()}>
                Try again
              </button>
            </div>
          )}

          {loading ? (
            <Skeleton />
          ) : active.length === 0 && done.length === 0 ? (
            hasFilters ? (
              <FilteredEmpty clearFilters={clearFilters} />
            ) : (
              <Empty view={view} />
            )
          ) : (
            <>
              {sections.map((section) => (
                <div key={section.key} class="task-group">
                  {section.title && (
                    <div class="task-group-heading">
                      <p class={section.tone === "overdue" ? "is-overdue" : ""}>
                        {section.title}
                        <span>{section.tasks.length}</span>
                      </p>
                      {section.tone === "overdue" && (
                        <button
                          type="button"
                          onClick={() => rescheduleOverdue()}
                          title="Move all overdue tasks to today"
                        >
                          Reschedule to today
                        </button>
                      )}
                    </div>
                  )}
                  <TaskSection tasks={section.tasks} reorderable={!isCompletedView} />
                </div>
              ))}

              {isCompletedView && completedPageCount > 1 && (
                <nav class="completed-pagination" aria-label="Completed tasks pages">
                  <p>
                    {completedPageStart + 1}–{Math.min(completedPageStart + COMPLETED_PAGE_SIZE, inView.length)}
                    <span> of {inView.length}</span>
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() => changeCompletedPage(currentCompletedPage - 1)}
                      disabled={currentCompletedPage === 1}
                      aria-label="Previous completed tasks page"
                    >
                      <ChevronLeftIcon width={14} height={14} />
                      Previous
                    </button>
                    <span>Page {currentCompletedPage} of {completedPageCount}</span>
                    <button
                      type="button"
                      onClick={() => changeCompletedPage(currentCompletedPage + 1)}
                      disabled={currentCompletedPage === completedPageCount}
                      aria-label="Next completed tasks page"
                    >
                      Next
                      <ChevronRightIcon width={14} height={14} />
                    </button>
                  </div>
                </nav>
              )}

              {done.length > 0 && !isCompletedView && (
                <div class="task-group completed-group">
                  <div class="task-group-heading">
                    <p>Completed <span>{done.length}</span></p>
                  </div>
                  <div class="task-row-list is-completed">
                    {done.map((task: Task) => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {showQuickAdd && (
        <footer class="capture-dock">
          <QuickAdd />
          <p class="capture-hint">Press <kbd>N</kbd> to quick capture</p>
        </footer>
      )}
    </main>
  );
}

function FilteredEmpty({ clearFilters }: { clearFilters: () => void }) {
  return (
    <div class="empty-state">
      <InboxIcon width={28} height={28} />
      <p>No tasks match your search or filters.</p>
      <button type="button" onClick={clearFilters}>Clear filters</button>
    </div>
  );
}

function Empty({ view }: { view: ViewId }) {
  const message =
    view.kind === "today"
      ? "Nothing due today. Enjoy the calm."
        : view.kind === "upcoming"
          ? "No upcoming tasks scheduled."
          : view.kind === "date"
            ? "Nothing scheduled for this day yet."
        : view.kind === "inbox"
          ? "Inbox zero. Add a task to get started."
          : view.kind === "pinned"
            ? "No pinned tasks yet."
            : view.kind === "completed"
              ? "Nothing completed yet."
              : "No tasks with this label yet.";
  return (
    <div class="empty-state">
      <InboxIcon width={30} height={30} />
      <p>{message}</p>
      <small>Use quick capture below, or press Ctrl + Alt + A from anywhere.</small>
    </div>
  );
}

function Skeleton() {
  return (
    <div class="task-row-list">
      {[0, 1, 2].map((index) => (
        <div key={index} class="task-row-skeleton" />
      ))}
    </div>
  );
}
