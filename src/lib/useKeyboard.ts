import { useEffect } from "preact/hooks";
import { useStore, visibleTaskIds } from "../store";
import { nudgeColumn } from "./board";
import { useOnboarding } from "./onboarding";

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function focusById(id: string) {
  const el = document.getElementById(id);
  if (el) {
    (el as HTMLElement).focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }
}

/**
 * Global keyboard shortcuts. Typing in a field is never intercepted
 * (except Escape, which blurs).
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Local controls own handled keys (e.g. Enter opens a board card).
      if (e.defaultPrevented || e.isComposing) return;
      // The first-run tour drives its own keys and owns the screen.
      if (useOnboarding.getState().open) return;

      const editing = isEditable(e.target);

      if (editing) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const s = useStore.getState();
      // Confirmation and account dialogs must not edit the task behind them.
      // The board's task dialog still supports task shortcuts and Escape.
      if (
        s.confirm ||
        document.querySelector('[aria-modal="true"]:not([data-task-dialog])')
      ) return;
      if (
        e.key === "Enter" &&
        e.target instanceof Element &&
        e.target.closest('button, a[href], [role="button"]')
      ) return;

      // The shortcuts cheat-sheet: "?" opens it, Escape closes it (and takes
      // priority over the panel-close Escape below).
      if (e.key === "?") {
        e.preventDefault();
        s.toggleShortcuts();
        return;
      }
      if (s.showShortcuts) {
        if (e.key === "Escape") {
          e.preventDefault();
          s.toggleShortcuts(false);
        }
        return;
      }

      const ids = visibleTaskIds(s.tasks, s.view);
      const selectedId =
        s.selectedId && ids.includes(s.selectedId) ? s.selectedId : null;
      const move = (dir: 1 | -1) => {
        if (ids.length === 0) return;
        const i = s.selectedId ? ids.indexOf(s.selectedId) : -1;
        const next =
          i === -1
            ? dir === 1
              ? 0
              : ids.length - 1
            : Math.min(ids.length - 1, Math.max(0, i + dir));
        s.select(ids[next]);
      };

      // On the board, h/l nudge the selected card to the neighbouring column —
      // the keyboard equivalent of dragging it.
      const nudge = (direction: 1 | -1) => {
        if (s.view.kind !== "board" || !selectedId) return;
        const task = s.tasks.find((x) => x.id === selectedId);
        if (!task) return;
        const target = nudgeColumn(task, s.tasks, direction, s.boardDefinitions);
        if (target) void s.moveTaskToColumn(task.id, target.column, target.boardIndex)
          .catch((error) => useStore.setState({ boardNotice: String(error) }));
      };

      switch (e.key) {
        case "/":
          e.preventDefault();
          focusById("search-input");
          break;
        case "n":
          e.preventDefault();
          // In the journal, "n" starts a new entry; elsewhere, a new task.
          if (s.view.kind === "journal") {
            focusById("journal-add-input");
          } else {
            focusById("quick-add-input");
          }
          break;
        case "J":
          // Shift+J jumps to the journal and focuses the composer.
          e.preventDefault();
          s.setView({ kind: "journal" });
          requestAnimationFrame(() => focusById("journal-add-input"));
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "h":
        case "ArrowLeft":
          if (s.view.kind === "board") {
            e.preventDefault();
            nudge(-1);
          }
          break;
        case "l":
        case "ArrowRight":
          if (s.view.kind === "board") {
            e.preventDefault();
            nudge(1);
          }
          break;
        case "e":
          if (selectedId) {
            e.preventDefault();
            focusById("detail-title");
          }
          break;
        case "c":
        case "Enter":
          if (selectedId && !e.repeat) {
            e.preventDefault();
            const t = s.tasks.find((x) => x.id === selectedId);
            if (t) s.toggleTask(t.id, t.status !== "done");
          }
          break;
        case "p":
          if (selectedId && !e.repeat) {
            e.preventDefault();
            const t = s.tasks.find((x) => x.id === selectedId);
            if (t) s.patchTask({ id: t.id, pinned: !t.pinned });
          }
          break;
        case "Backspace":
        case "Delete":
          if (selectedId && !e.repeat) {
            e.preventDefault();
            const id = selectedId;
            const t = s.tasks.find((x) => x.id === id);
            s.requestConfirm({
              title: "Delete task?",
              message: t ? `“${t.title}” will be permanently deleted.` : undefined,
              confirmLabel: "Delete",
              danger: true,
              onConfirm: () => s.removeTask(id),
            });
          }
          break;
        case "Escape":
          if (s.selectedId) s.select(null);
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
