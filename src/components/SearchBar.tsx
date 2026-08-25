import { useRef } from "preact/hooks";
import { useStore } from "../store";
import { CloseIcon, FlagIcon, SearchIcon } from "./Icons";
import { PRIORITIES } from "./PriorityPicker";

export function SearchBar() {
  const {
    labels,
    searchQuery,
    filterLabelIds,
    filterPriorities,
    setSearchQuery,
    toggleFilterLabel,
    toggleFilterPriority,
    clearFilters,
  } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFilters =
    searchQuery.trim() !== "" ||
    filterLabelIds.length > 0 ||
    filterPriorities.length > 0;

  return (
    <div class="mt-4 flex flex-col gap-2">
      <div class="relative">
        <SearchIcon
          width={15}
          height={15}
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
        />
        <input
          ref={inputRef}
          id="search-input"
          value={searchQuery}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder="Search tasks…"
          class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-9 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              inputRef.current?.focus();
            }}
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-faint)] transition-colors hover:text-[var(--color-text)]"
            title="Clear search"
            aria-label="Clear search"
          >
            <CloseIcon width={14} height={14} />
          </button>
        )}
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        {PRIORITIES.map((priority) => {
          const active = filterPriorities.includes(priority.value);
          return (
            <button
              key={priority.value}
              type="button"
              onClick={() => toggleFilterPriority(priority.value)}
              class={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
              }`}
            >
              <FlagIcon
                width={12}
                height={12}
                style={{ color: priority.color }}
              />
              {priority.label}
            </button>
          );
        })}

        {labels.map((label) => {
          const active = filterLabelIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              onClick={() => toggleFilterLabel(label.id)}
              class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
              }`}
            >
              <span
                class="h-2.5 w-2.5 rounded-full"
                style={{ background: label.color }}
              />
              {label.name}
            </button>
          );
        })}

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            class="ml-auto px-1 py-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
