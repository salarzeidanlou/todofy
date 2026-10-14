import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store";

export function ConfirmDialog() {
  const { confirm, closeConfirm } = useStore();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!running.current) closeConfirm();
      }
      // Focused buttons use their native activation, including Cancel.
      if (e.key === "Enter" && !(e.target instanceof Element && e.target.closest("button"))) {
        e.preventDefault();
        if (!e.repeat) void run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm]);

  if (!confirm) return null;

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await confirm.onConfirm();
    } finally {
      running.current = false;
      setBusy(false);
      closeConfirm();
    }
  };

  return (
    <div
      class="fixed inset-0 z-100 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onMouseDown={(e) => e.target === e.currentTarget && !running.current && closeConfirm()}
    >
      <div class="w-full max-w-sm animate-fade-rise rounded-xl border border-border-strong bg-elevated p-5 shadow-2xl shadow-black/50">
        <h3 id="confirm-title" class="text-base font-semibold text-text">{confirm.title}</h3>
        {confirm.message && (
          <p class="mt-1.5 text-sm leading-relaxed text-muted">
            {confirm.message}
          </p>
        )}
        <div class="mt-5 flex justify-end gap-2">
          <button
            onClick={closeConfirm}
            disabled={busy}
            class="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={run}
            disabled={busy}
            autoFocus
            class={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-60 ${
              confirm.danger
                ? "bg-(--color-danger) hover:brightness-110"
                : "bg-(--color-accent) hover:bg-accent-hover"
            }`}
          >
            {confirm.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
