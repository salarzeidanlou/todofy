import { useState } from "preact/hooks";
import { useStore } from "../store";
import { today } from "../lib/dates";
import { daySummary, summaryText } from "../lib/journal";
import type { SessionLog } from "../types";
import { DatePicker } from "./DatePicker";

export const MOODS = ["😞", "😕", "😐", "🙂", "😄"];
export const MOOD_LABELS = ["Rough", "Low", "Okay", "Good", "Great"];

export interface JournalDraft {
  title: string | null;
  body: string;
  mood: number | null;
  entryDate: string;
}

interface Props {
  sessions: SessionLog[];
  initial?: Partial<JournalDraft>;
  submitLabel: string;
  onSubmit: (draft: JournalDraft) => void | Promise<void>;
  onCancel?: () => void;
}

export function JournalEditor({
  sessions,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const tasks = useStore((s) => s.tasks);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? today());
  const [saving, setSaving] = useState(false);

  const summary = daySummary(tasks, sessions, entryDate);
  const prompt = summaryText(summary);

  const submit = async () => {
    if (!body.trim() && !title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim() || null,
        body: body.trim(),
        mood,
        entryDate,
      });
      if (!initial) {
        setTitle("");
        setBody("");
        setMood(null);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="journal-composer">
      <input
        class="journal-composer-title"
        value={title}
        onInput={(e) => setTitle(e.currentTarget.value)}
        placeholder="Title (optional)"
      />
      <textarea
        id={initial ? undefined : "journal-add-input"}
        class="journal-composer-body"
        value={body}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
        placeholder="Write freely… Markdown supported."
        rows={initial ? 5 : 4}
      />

      {prompt && (
        <button
          type="button"
          class="journal-summary-chip"
          onClick={() =>
            setBody((b) => (b.trim() ? `${b}\n\n${prompt}` : prompt))
          }
          title="Insert this day's summary"
        >
          <span aria-hidden="true">✨</span> {prompt}
        </button>
      )}

      <div class="journal-toolbar">
        <div class="mood-picker" role="group" aria-label="Mood">
          {MOODS.map((face, i) => {
            const value = i + 1;
            return (
              <button
                key={value}
                type="button"
                class={`mood-btn ${mood === value ? "is-active" : ""}`}
                onClick={() => setMood(mood === value ? null : value)}
                title={MOOD_LABELS[i]}
                aria-label={MOOD_LABELS[i]}
                aria-pressed={mood === value}
              >
                {face}
              </button>
            );
          })}
        </div>

        <DatePicker
          value={entryDate}
          onChange={(d) => setEntryDate(d ?? today())}
          allowClear={false}
        />

        <div class="journal-toolbar-actions">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              class="rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || (!body.trim() && !title.trim())}
            class="rounded-md bg-[var(--color-accent)] px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
