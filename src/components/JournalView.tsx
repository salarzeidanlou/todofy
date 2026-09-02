import { useEffect, useMemo, useState } from "preact/hooks";
import { useStore } from "../store";
import { api } from "../lib/api";
import { today } from "../lib/dates";
import type { JournalEntry as Entry, SessionLog } from "../types";
import { JournalEditor } from "./JournalEditor";
import { JournalEntry } from "./JournalEntry";

function groupHeading(date: string): string {
  if (date === today()) return "Today";
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function JournalView() {
  const { journal, addJournal } = useStore();
  const [sessions, setSessions] = useState<SessionLog[]>([]);

  useEffect(() => {
    api.focusHistory().then(setSessions).catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const byDate = new Map<string, Entry[]>();
    for (const entry of journal) {
      const list = byDate.get(entry.entryDate) ?? [];
      list.push(entry);
      byDate.set(entry.entryDate, list);
    }
    return [...byDate.entries()];
  }, [journal]);

  return (
    <main class="redesign-secondary flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="app-page-header shrink-0 px-8 pt-8 pb-4">
        <h2 class="text-2xl font-semibold tracking-tight">Journal</h2>
        <p class="mt-0.5 text-sm text-[var(--color-muted)]">
          Write and reflect on your days
        </p>
      </header>

      <div class="secondary-scroll mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-10">
        <JournalEditor
          sessions={sessions}
          submitLabel="Add entry"
          onSubmit={async (draft) => {
            await addJournal(draft);
          }}
        />

        {journal.length === 0 ? (
          <p class="mt-10 text-center text-sm text-[var(--color-faint)]">
            No entries yet. Start writing above.
          </p>
        ) : (
          <div class="mt-7 flex flex-col gap-7">
            {groups.map(([date, entries]) => (
              <section key={date} class="journal-day">
                <div class="journal-day-heading">
                  <strong>{groupHeading(date)}</strong>
                  <span>
                    {entries.length} {entries.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
                {entries.map((entry) => (
                  <JournalEntry key={entry.id} entry={entry} sessions={sessions} />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
