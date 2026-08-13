import { useState } from "preact/hooks";
import { activeCount, useStore } from "../store";
import type { ViewId } from "../types";
import { EditIcon, PlusIcon, SearchIcon, TrashIcon } from "./Icons";
import { LabelForm } from "./LabelForm";

export function LabelsView() {
  const { tasks, labels, setView, addLabel, editLabel, removeLabel, requestConfirm } =
    useStore();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = labels.filter((l) =>
    l.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <main class="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <header class="shrink-0 px-8 pt-8 pb-4">
        <h2 class="text-2xl font-semibold tracking-tight">Labels</h2>
        <p class="mt-0.5 text-sm text-[var(--color-muted)]">
          Search, edit, and manage your labels
        </p>
      </header>

      <div class="mx-auto flex w-full max-w-2xl items-center gap-2 px-8">
        <div class="relative flex-1">
          <SearchIcon
            width={15}
            height={15}
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
          />
          <input
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search labels…"
            class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setAdding((v) => !v);
          }}
          class="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <PlusIcon width={15} height={15} />
          New label
        </button>
      </div>

      <div class="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-4 pb-8">
        {adding && (
          <div class="mb-3">
            <LabelForm
              onSubmit={async (name, color) => {
                await addLabel(name, color);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <p class="mt-10 text-center text-sm text-[var(--color-faint)]">
            {labels.length === 0 ? "No labels yet." : "No labels match your search."}
          </p>
        ) : (
          <div class="flex flex-col gap-1">
            {filtered.map((l) => {
              if (editingId === l.id) {
                return (
                  <LabelForm
                    key={l.id}
                    initialName={l.name}
                    initialColor={l.color}
                    onSubmit={async (name, color) => {
                      await editLabel(l.id, name, color);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                );
              }

              const id: ViewId = { kind: "label", labelId: l.id };
              const count = activeCount(tasks, id);
              return (
                <div
                  key={l.id}
                  class="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                >
                  <button
                    onClick={() => setView(id)}
                    class="flex flex-1 items-center gap-3 overflow-hidden text-left"
                  >
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: l.color }}
                    />
                    <span class="flex-1 truncate">{l.name}</span>
                    <span class="text-xs tabular-nums text-[var(--color-faint)]">
                      {count} active
                    </span>
                  </button>
                  <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setAdding(false);
                        setEditingId(l.id);
                      }}
                      class="rounded p-1 text-[var(--color-faint)] hover:text-[var(--color-text)]"
                      title="Edit label"
                    >
                      <EditIcon width={14} height={14} />
                    </button>
                    <button
                      onClick={() =>
                        requestConfirm({
                          title: "Delete label?",
                          message: `“${l.name}” will be removed from all tasks.`,
                          confirmLabel: "Delete",
                          danger: true,
                          onConfirm: () => removeLabel(l.id),
                        })
                      }
                      class="rounded p-1 text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                      title="Delete label"
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
