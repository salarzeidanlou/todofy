import { useEffect } from "preact/hooks";
import { useStore, visibleTaskIds } from "../store";

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
      const editing = isEditable(e.target);

      if (editing) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const s = useStore.getState();

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

      switch (e.key) {
        case "/":
          e.preventDefault();
          focusById("search-input");
          break;
        case "n":
          e.preventDefault();
          focusById("quick-add-input");
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
        case "e":
          if (s.selectedId) {
            e.preventDefault();
            focusById("detail-title");
          }
          break;
        case "c":
        case "Enter":
          if (s.selectedId) {
            e.preventDefault();
            const t = s.tasks.find((x) => x.id === s.selectedId);
            if (t) s.toggleTask(t.id, t.status !== "done");
          }
          break;
        case "p":
          if (s.selectedId) {
            e.preventDefault();
            const t = s.tasks.find((x) => x.id === s.selectedId);
            if (t) s.patchTask({ id: t.id, pinned: !t.pinned });
          }
          break;
        case "Backspace":
        case "Delete":
          if (s.selectedId) {
            e.preventDefault();
            const id = s.selectedId;
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
