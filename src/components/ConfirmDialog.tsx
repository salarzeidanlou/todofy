import { useEffect, useState } from "preact/hooks";
import { useStore } from "../store";

export function ConfirmDialog() {
  const { confirm, closeConfirm } = useStore();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConfirm();
      if (e.key === "Enter") run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm]);

  if (!confirm) return null;

  const run = async () => {
    setBusy(true);
    try {
      await confirm.onConfirm();
    } finally {
      setBusy(false);
      closeConfirm();
    }
  };

  return (
    <div
      class="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && closeConfirm()}
    >
      <div class="w-full max-w-sm animate-fade-rise rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-5 shadow-2xl shadow-black/50">
        <h3 class="text-base font-semibold text-[var(--color-text)]">
          {confirm.title}
        </h3>
        {confirm.message && (
          <p class="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">
            {confirm.message}
          </p>
        )}
        <div class="mt-5 flex justify-end gap-2">
          <button
            onClick={closeConfirm}
            disabled={busy}
            class="rounded-lg px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            onClick={run}
            disabled={busy}
            autoFocus
            class={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-60 ${
              confirm.danger
                ? "bg-[var(--color-danger)] hover:brightness-110"
                : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
            }`}
          >
            {confirm.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
