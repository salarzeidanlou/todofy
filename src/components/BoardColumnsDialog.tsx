import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";
import { DONE_COLUMN, orderedColumns, TODO_COLUMN } from "../lib/board";
import { useColumnReorder } from "../lib/useColumnReorder";
import type { BoardColumnDefinition, BoardColumnInput } from "../types";
import { PALETTE } from "./LabelForm";
import { CloseIcon, GripIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "./Icons";

export function BoardColumnsDialog({ initialId, onClose }: { initialId?: string; onClose: () => void }) {
  const { boardDefinitions, reorderBoardColumns, deleteBoardColumn } = useStore();
  const columns = orderedColumns(boardDefinitions);
  const [editing, setEditing] = useState<string | null>(initialId ?? null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [destination, setDestination] = useState(TODO_COLUMN);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(String(e)); }
    finally { pending.current = false; setBusy(false); }
  };
  const reorder = (ids: string[]) => void run(() => reorderBoardColumns(ids));
  const { start, setRowRef, overId } = useColumnReorder(columns.map((c) => c.id), reorder);
  const move = (id: string, direction: -1 | 1) => {
    const ids = columns.map((c) => c.id);
    const from = ids.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length - 1 || id === DONE_COLUMN) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder(ids);
  };
  useEffect(() => {
    const first = dialog.current?.querySelector<HTMLElement>(".column-editor input")
      ?? dialog.current?.querySelector<HTMLElement>("button");
    first?.focus();
    return () => {
      const previous = previousFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const current = columns.find((c) => c.id === editing);
  const deletion = columns.find((c) => c.id === deleting);
  return (
    <div class="column-dialog-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !pending.current) onClose();
    }}>
      <div ref={dialog} class="column-dialog" role="dialog" aria-modal="true" aria-labelledby="columns-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); if (!pending.current) onClose(); }
          if (e.key !== "Tab") return;
          const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
          const first = elements[0], last = elements[elements.length - 1];
          if (!dialog.current?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
        <header class="column-dialog-header">
          <div><h2 id="columns-title">Manage columns</h2><p>Shape your workflow. WIP limits give a nudge when a column fills up.</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close column settings"><CloseIcon width={18} height={18} /></button>
        </header>
        <div class="column-dialog-scroll">
          {error && <p class="column-error" role="alert">{error}</p>}
          <div class="column-manager-list">
            {columns.map((column, index) => (
              <div key={column.id} ref={setRowRef(column.id)} class={`column-manager-row ${overId === column.id ? "is-drop-target" : ""}`}>
                <button type="button" class="column-drag-handle" disabled={busy || column.id === DONE_COLUMN}
                  onPointerDown={start(column.id)} aria-label={`Drag ${column.name} to reorder`}
                  onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); move(column.id, e.key === "ArrowUp" ? -1 : 1); } }}>
                  <GripIcon width={16} height={16} />
                </button>
                <i class="column-color-dot" style={{ background: column.color }} />
                <div class="column-manager-copy"><strong>{column.name}</strong><small>{column.id === DONE_COLUMN ? "Completion column · always last" : column.id === TODO_COLUMN ? "Default destination" : column.wipLimit ? `WIP limit: ${column.wipLimit}` : "No WIP limit"}</small></div>
                <button type="button" disabled={busy || index === 0 || column.id === DONE_COLUMN} aria-label={`Move ${column.name} left`} onClick={() => move(column.id, -1)}><ChevronLeftIcon width={14} height={14} /></button>
                <button type="button" disabled={busy || index >= columns.length - 2} aria-label={`Move ${column.name} right`} onClick={() => move(column.id, 1)}><ChevronRightIcon width={14} height={14} /></button>
                <button type="button" disabled={busy} onClick={() => { setEditing(column.id); setDeleting(null); setError(null); }}>Edit</button>
                {column.id !== TODO_COLUMN && column.id !== DONE_COLUMN && <button type="button" class="column-delete" disabled={busy} onClick={() => { setDeleting(column.id); setEditing(null); setDestination(TODO_COLUMN); setError(null); }}>Delete</button>}
              </div>
            ))}
          </div>
          {deletion && <section class="column-delete-panel">
            <h3>Delete {deletion.name}?</h3>
            <p>Move its tasks to another column. Completed tasks will remember the new destination when reopened.</p>
            <label>Move tasks to<select value={destination} disabled={busy} onChange={(e) => setDestination(e.currentTarget.value)}>
              {columns.filter((c) => c.id !== deletion.id && c.id !== DONE_COLUMN).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
            <div class="column-editor-actions"><button type="button" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" class="column-danger-button" disabled={busy} onClick={() => void run(async () => { await deleteBoardColumn(deletion.id, destination); setDeleting(null); })}>Move tasks and delete</button></div>
          </section>}
          {editing !== null && (editing === "new" || current) && <ColumnEditor key={editing} column={current} busy={busy} onCancel={() => setEditing(null)} onSave={(input) => run(async () => {
            if (current) await useStore.getState().updateBoardColumn(current.id, input);
            else await useStore.getState().createBoardColumn(input);
            setEditing(null);
            requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(".column-add-button")?.focus());
          })} />}
          {editing !== "new" && <button type="button" class="column-add-button" disabled={busy} onClick={() => { setEditing("new"); setDeleting(null); setError(null); }}><PlusIcon width={16} height={16} />Add column</button>}
        </div>
      </div>
    </div>
  );
}

function ColumnEditor({ column, busy, onCancel, onSave }: {
  column?: BoardColumnDefinition; busy: boolean; onCancel: () => void; onSave: (input: BoardColumnInput) => Promise<void>;
}) {
  const [name, setName] = useState(column?.name ?? "");
  const [color, setColor] = useState(column?.color ?? "#6c7cff");
  const [limit, setLimit] = useState(column?.wipLimit?.toString() ?? "");
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(color);
  const limitValid = limit === "" || /^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 9999;
  const valid = name.trim().length > 0 && name.trim().length <= 60 && colorValid && limitValid;
  return (
    <form class="column-editor" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void onSave({ name: name.trim(), color, wipLimit: column?.id === DONE_COLUMN || !limit ? null : Number(limit) }); }}>
      <h3>{column ? `Edit ${column.name}` : "New column"}</h3>
      <label>Column name<input autoFocus value={name} maxLength={60} disabled={busy} onInput={(e) => setName(e.currentTarget.value)} /></label>
      <label>Color<input value={color} disabled={busy} onInput={(e) => setColor(e.currentTarget.value)} aria-invalid={!colorValid} placeholder="#6c7cff" /></label>
      <div class="column-palette" role="group" aria-label="Column color presets">{PALETTE.map((c) => <button key={c} type="button" disabled={busy} aria-label={`Use ${c}`} aria-pressed={color.toLowerCase() === c} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
      {!colorValid && <small class="column-error">Use a six-digit hex color, such as #6c7cff.</small>}
      {column?.id !== DONE_COLUMN && <label>WIP limit<input type="number" min="1" max="9999" step="1" value={limit} disabled={busy} onInput={(e) => setLimit(e.currentTarget.value)} placeholder="No limit" aria-invalid={!limitValid} /><small>Leave empty for no limit. Counts all active tasks, including those hidden by filters. Moves remain allowed.</small></label>}
      {!limitValid && <small class="column-error">Enter a whole number between 1 and 9999.</small>}
      <div class="column-editor-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" class="column-save-button" disabled={busy || !valid}>{busy ? "Saving…" : "Save column"}</button></div>
    </form>
  );
}
