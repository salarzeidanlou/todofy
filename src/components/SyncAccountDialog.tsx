import { useState } from "preact/hooks";
import { useAuth } from "../lib/auth";
import { useSync, type AccountDataChoice } from "../lib/sync";

export function SyncAccountDialog() {
  const { email, signOut } = useAuth();
  const { accountChoice, error, resolveAccountChoice } = useSync();
  const [busy, setBusy] = useState<AccountDataChoice | "signout" | null>(null);

  if (!accountChoice) return null;

  const choose = async (choice: AccountDataChoice) => {
    if (busy) return;
    setBusy(choice);
    await resolveAccountChoice(choice);
    setBusy(null);
  };

  const cancel = async () => {
    if (busy) return;
    setBusy("signout");
    await signOut();
    setBusy(null);
  };

  return (
    <div
      class="fixed inset-0 z-[110] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-account-title"
    >
      <div class="w-full max-w-md animate-fade-rise rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-5 shadow-2xl shadow-black/50">
        <h3 id="sync-account-title" class="text-base font-semibold text-[var(--color-text)]">
          Choose data for this account
        </h3>
        <p class="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">
          This device already has tasks linked to another account. Before syncing
          {email ? ` ${email}` : " this account"}, choose what Todofy should do.
        </p>

        <div class="mt-4 grid gap-2.5">
          <button
            type="button"
            onClick={() => choose("copy-local")}
            disabled={busy !== null}
            autoFocus
            class="rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-3 text-left transition-colors hover:brightness-110 disabled:opacity-60"
          >
            <span class="block text-sm font-semibold text-[var(--color-text)]">
              Copy this device's data
            </span>
            <span class="mt-0.5 block text-xs leading-relaxed text-[var(--color-muted)]">
              Keep local tasks, labels, focus history, and journal entries and add
              independent copies to this account.
            </span>
          </button>
          <button
            type="button"
            onClick={() => choose("account")}
            disabled={busy !== null}
            class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-60"
          >
            <span class="block text-sm font-semibold text-[var(--color-text)]">
              Use this account's data
            </span>
            <span class="mt-0.5 block text-xs leading-relaxed text-[var(--color-muted)]">
              Remove the device's synced tasks and load this account's cloud data.
              Standalone calendar events stay on this device.
            </span>
          </button>
        </div>

        {error && (
          <p class="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <div class="mt-4 flex items-center justify-between">
          <span class="text-[11px] text-[var(--color-faint)]">
            Nothing is uploaded until you choose.
          </span>
          <button
            type="button"
            onClick={cancel}
            disabled={busy !== null}
            class="rounded-lg px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
