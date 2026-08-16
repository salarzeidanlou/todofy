import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "preact/hooks";
import { navCount, useStore } from "../store";
import type { ViewId } from "../types";
import {
  InboxIcon,
  TodayIcon,
  UpcomingIcon,
  PinIcon,
  CheckCircleIcon,
  LabelIcon,
  SettingsIcon,
  TimerIcon,
  Logo,
} from "./Icons";

const SMART: { id: ViewId; label: string; Icon: typeof InboxIcon }[] = [
  { id: { kind: "today" }, label: "Today", Icon: TodayIcon },
  { id: { kind: "upcoming" }, label: "Upcoming", Icon: UpcomingIcon },
  { id: { kind: "inbox" }, label: "Inbox", Icon: InboxIcon },
  { id: { kind: "pinned" }, label: "Pinboard", Icon: PinIcon },
  { id: { kind: "completed" }, label: "Completed", Icon: CheckCircleIcon },
  { id: { kind: "labels" }, label: "Labels", Icon: LabelIcon },
];

function sameView(a: ViewId, b: ViewId): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "label" && b.kind === "label") return a.labelId === b.labelId;
  return true;
}

export function Sidebar() {
  const { tasks, labels, view, setView, sidebarCollapsed, toggleFocus } = useStore();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  if (sidebarCollapsed) {
    return (
      <aside class="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-[var(--color-border)] bg-[var(--color-surface)] py-4">
        <div class="mb-2">
          <Logo size={28} />
        </div>

        {SMART.map(({ id, label, Icon }) => {
          const active = sameView(view, id);
          return (
            <button
              key={label}
              onClick={() => setView(id)}
              title={label}
              class={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon width={18} height={18} />
            </button>
          );
        })}

        <button
          onClick={toggleFocus}
          title="Focus timer"
          class="mt-auto grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <TimerIcon width={18} height={18} />
        </button>

        <button
          onClick={() => setView({ kind: "settings" })}
          title="Settings"
          class={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
            sameView(view, { kind: "settings" })
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          }`}
        >
          <SettingsIcon width={18} height={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside class="flex w-64 shrink-0 flex-col gap-6 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-5">
      <div class="px-2">
        <h1 class="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Logo size={28} />
          todofy
          {version && (
            <span class="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-faint)]">
              v{version}
            </span>
          )}
        </h1>
      </div>

      <nav class="flex flex-col gap-0.5">
        {SMART.map(({ id, label, Icon }) => {
          const active = sameView(view, id);
          const count = id.kind === "labels" ? labels.length : navCount(tasks, id);
          return (
            <button
              key={label}
              onClick={() => setView(id)}
              class={`group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-text)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon
                width={18}
                height={18}
                class={active ? "text-[var(--color-accent)]" : ""}
              />
              <span class="flex-1 text-left">{label}</span>
              {count > 0 && (
                <span class="text-xs tabular-nums text-[var(--color-faint)]">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div class="mt-auto flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-3">
        <button
          onClick={toggleFocus}
          class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <TimerIcon width={18} height={18} />
          Focus timer
        </button>
        <button
          onClick={() => setView({ kind: "settings" })}
          class={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
            sameView(view, { kind: "settings" })
              ? "bg-[var(--color-accent-soft)] text-[var(--color-text)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          }`}
        >
          <SettingsIcon
            width={18}
            height={18}
            class={sameView(view, { kind: "settings" }) ? "text-[var(--color-accent)]" : ""}
          />
          Settings
        </button>
      </div>
    </aside>
  );
}
