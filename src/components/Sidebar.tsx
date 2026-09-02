import { useEffect, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../store";
import type { ViewId } from "../types";
import { toLocalDate, today } from "../lib/dates";
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  JournalIcon,
  LabelIcon,
  Logo,
  MenuIcon,
  PinIcon,
  SettingsIcon,
  TimerIcon,
  TodayIcon,
  UpcomingIcon,
} from "./Icons";

const NAV: { id: ViewId; label: string; Icon: typeof InboxIcon }[] = [
  { id: { kind: "today" }, label: "Today", Icon: TodayIcon },
  { id: { kind: "upcoming" }, label: "Upcoming", Icon: UpcomingIcon },
  { id: { kind: "inbox" }, label: "Inbox", Icon: InboxIcon },
  { id: { kind: "pinned" }, label: "Pinboard", Icon: PinIcon },
  { id: { kind: "completed" }, label: "Completed", Icon: CheckCircleIcon },
  { id: { kind: "labels" }, label: "Labels", Icon: LabelIcon },
  { id: { kind: "journal" }, label: "Journal", Icon: JournalIcon },
];

export function sameView(a: ViewId, b: ViewId): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "label" && b.kind === "label") return a.labelId === b.labelId;
  if (a.kind === "date" && b.kind === "date") return a.date === b.date;
  return true;
}

/** Top-level product navigation from the selected redesign. */
export function Sidebar() {
  const { view, setView, sidebarCollapsed, toggleSidebar } = useStore();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const navigate = (nextView: ViewId) => {
    setView(nextView);
    if (!sidebarCollapsed && window.matchMedia("(max-width: 940px)").matches) {
      toggleSidebar();
    }
  };

  return (
    <header class="app-topbar">
      <div class="app-brand">
        <Logo size={30} />
        <span>todofy</span>
        {version && <small class="app-version">v{version}</small>}
        <button
          type="button"
          class={`rail-toggle ${sidebarCollapsed ? "" : "is-active"}`}
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-controls="day-navigation"
          aria-label={sidebarCollapsed ? "Open calendar navigation" : "Close calendar navigation"}
          title={sidebarCollapsed ? "Open calendar" : "Close calendar"}
        >
          <MenuIcon width={20} height={20} />
        </button>
      </div>

      <nav class="top-navigation" aria-label="Primary navigation">
        {NAV.map(({ id, label, Icon }) => {
          const active =
            sameView(view, id) || (id.kind === "upcoming" && view.kind === "date");
          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(id)}
              class={`top-nav-item ${active ? "is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={label}
            >
              <Icon width={19} height={19} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div class="top-actions">
        <button
          type="button"
          onClick={() => navigate({ kind: "focus" })}
          class={`top-nav-item top-focus ${view.kind === "focus" ? "is-active" : ""}`}
          aria-current={view.kind === "focus" ? "page" : undefined}
        >
          <TimerIcon width={20} height={20} />
          <span>Focus</span>
        </button>
        <button
          type="button"
          onClick={() => navigate({ kind: "settings" })}
          class={`top-nav-item top-settings ${view.kind === "settings" ? "is-active" : ""}`}
          aria-current={view.kind === "settings" ? "page" : undefined}
        >
          <SettingsIcon width={20} height={20} />
          <span>Settings</span>
        </button>
      </div>
    </header>
  );
}

/** Date-oriented context rail that replaces the old feature sidebar. */
export function DayRail() {
  const { tasks, journal, view, setView, sidebarCollapsed, toggleSidebar } =
    useStore();
  const todayKey = today();
  const selectedKey = view.kind === "date" ? view.date : view.kind === "today" ? todayKey : null;
  const [anchorDate, setAnchorDate] = useState(() =>
    new Date((selectedKey ?? todayKey) + "T00:00:00"),
  );

  useEffect(() => {
    if (selectedKey) setAnchorDate(new Date(selectedKey + "T00:00:00"));
  }, [selectedKey]);

  const weekStart = new Date(anchorDate);
  weekStart.setDate(anchorDate.getDate() - anchorDate.getDay());
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const key = toLocalDate(date);
    return {
      date,
      key,
      count: tasks.filter((task) => task.status === "active" && task.dueDate === key).length,
      journaled: journal.some((entry) => entry.entryDate === key),
    };
  });
  const weekEnd = week[6].date;
  const isCurrentWeek = week.some(({ key }) => key === todayKey);

  const moveWeek = (direction: -1 | 1) => {
    const next = new Date(anchorDate);
    next.setDate(next.getDate() + direction * 7);
    setAnchorDate(next);
  };

  const chooseDay = (key: string) => {
    setView(key === todayKey ? { kind: "today" } : { kind: "date", date: key });
    if (!sidebarCollapsed && window.matchMedia("(max-width: 940px)").matches) {
      toggleSidebar();
    }
  };

  const rangeLabel =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${weekStart.toLocaleDateString(undefined, { month: "long" })} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
      : `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <aside id="day-navigation" class={`day-rail ${sidebarCollapsed ? "" : "is-open"}`} aria-label="Day navigation">
      <div class="mini-calendar">
        <div class="mini-calendar-heading">
          <div>
            <small>This week</small>
            <strong>{rangeLabel}</strong>
          </div>
          <div class="mini-calendar-actions">
            {!isCurrentWeek && (
              <button type="button" onClick={() => setAnchorDate(new Date(todayKey + "T00:00:00"))}>
                Today
              </button>
            )}
            <button type="button" onClick={() => moveWeek(-1)} aria-label="Previous week" title="Previous week">
              <ChevronLeftIcon width={15} height={15} />
            </button>
            <button type="button" onClick={() => moveWeek(1)} aria-label="Next week" title="Next week">
              <ChevronRightIcon width={15} height={15} />
            </button>
          </div>
        </div>
        <div class="mini-week">
          {week.map(({ date, key, count, journaled }) => {
            const current = key === todayKey;
            const selected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseDay(key)}
                class={`${current ? "is-current" : ""} ${selected ? "is-selected" : ""}`}
                aria-pressed={selected}
                aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${count ? `, ${count} tasks` : ", no tasks"}${journaled ? ", journaled" : ""}`}
              >
                <span>{date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                <b>{date.getDate()}</b>
                <i class={count > 0 ? "has-tasks" : ""}>{count || ""}</i>
                {journaled && <em class="journal-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div class="day-links-heading">
        <span>Daily plan</span>
        <small>{week.reduce((total, day) => total + day.count, 0)} tasks</small>
      </div>
      <div class="day-links">
        {week.map(({ date, key, count }) => {
          const current = key === todayKey;
          const active = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => chooseDay(key)}
              class={`day-link ${active ? "is-active" : ""}`}
              aria-current={active ? "date" : undefined}
            >
              <span class="day-link-date">
                <b>{date.getDate()}</b>
                <small>{date.toLocaleDateString(undefined, { month: "short" })}</small>
              </span>
              <span class="day-link-copy">
                <strong>{current ? "Today" : date.toLocaleDateString(undefined, { weekday: "long" })}</strong>
                <small>{count ? `${count} task${count === 1 ? "" : "s"} planned` : "Open day"}</small>
              </span>
              <span class={`day-link-count ${count ? "has-tasks" : ""}`}>{count || "—"}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
