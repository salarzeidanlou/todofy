import { useEffect, useRef, useState } from "preact/hooks";
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
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const hasFilters =
    searchQuery.trim() !== "" ||
    filterLabelIds.length > 0 ||
    filterPriorities.length > 0;

  useEffect(() => {
    if (!open) return;

    const closeWhenOutside = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={toolsRef} class="agenda-tools">
      <div class="compact-search">
        <SearchIcon width={15} height={15} />
        <input
          ref={inputRef}
          id="search-input"
          value={searchQuery}
          onInput={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              inputRef.current?.focus();
            }}
            title="Clear search"
            aria-label="Clear search"
          >
            <CloseIcon width={13} height={13} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        class={`filter-trigger ${hasFilters ? "has-filters" : ""}`}
        aria-expanded={open}
      >
        <FlagIcon width={15} height={15} />
        Filters
        {hasFilters && <span>{filterLabelIds.length + filterPriorities.length}</span>}
      </button>

      {open && (
        <div class="filter-popover">
          <div>
            <p>Priority</p>
            <div class="filter-options">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority.value}
                  type="button"
                  onClick={() => toggleFilterPriority(priority.value)}
                  class={filterPriorities.includes(priority.value) ? "is-active" : ""}
                >
                  <FlagIcon width={12} height={12} style={{ color: priority.color }} />
                  {priority.label}
                </button>
              ))}
            </div>
          </div>
          {labels.length > 0 && (
            <div>
              <p>Labels</p>
              <div class="filter-options">
                {labels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleFilterLabel(label.id)}
                    class={filterLabelIds.includes(label.id) ? "is-active" : ""}
                  >
                    <i style={{ background: label.color }} />
                    {label.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hasFilters && (
            <button type="button" class="clear-filter-button" onClick={clearFilters}>
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
