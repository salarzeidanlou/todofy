import { useState } from "preact/hooks";
import { useStore } from "../store";
import { renderMarkdown } from "../lib/markdown";
import type { JournalEntry as Entry, SessionLog } from "../types";
import { EditIcon, TrashIcon } from "./Icons";
import { JournalEditor, MOODS, MOOD_LABELS } from "./JournalEditor";

interface Props {
  entry: Entry;
  sessions: SessionLog[];
}

export function JournalEntry({ entry, sessions }: Props) {
  const { patchJournal, removeJournal, requestConfirm } = useStore();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <JournalEditor
        sessions={sessions}
        initial={entry}
        submitLabel="Save"
        onSubmit={async (draft) => {
          await patchJournal({ id: entry.id, ...draft });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const time = new Date(entry.createdAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article class="journal-entry">
      <div class="journal-entry-head">
        {entry.mood && (
          <span class="journal-mood-badge" title={MOOD_LABELS[entry.mood - 1]}>
            {MOODS[entry.mood - 1]}
          </span>
        )}
        <span class="journal-entry-title">{entry.title ?? "Untitled entry"}</span>
        <span class="journal-entry-time">{time}</span>
        <div class="journal-entry-actions">
          <button onClick={() => setEditing(true)} title="Edit entry">
            <EditIcon width={14} height={14} />
          </button>
          <button
            class="is-danger"
            onClick={() =>
              requestConfirm({
                title: "Delete entry?",
                message: "This journal entry will be removed.",
                confirmLabel: "Delete",
                danger: true,
                onConfirm: () => removeJournal(entry.id),
              })
            }
            title="Delete entry"
          >
            <TrashIcon width={14} height={14} />
          </button>
        </div>
      </div>
      {entry.body && (
        <div
          class="journal-prose"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
        />
      )}
    </article>
  );
}
