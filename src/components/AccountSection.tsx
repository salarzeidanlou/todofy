import { useEffect, useState } from "preact/hooks";
import { useAuth } from "../lib/auth";
import { useSync, type SyncStatus } from "../lib/sync";
import { syncConfigured } from "../lib/supabase";
import { CloseIcon, EyeIcon, EyeOffIcon, UserIcon } from "./Icons";

type Mode = "signin" | "signup";

export function AccountSection() {
  const { ready, session, email, signIn, signUp, signOut } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  // Builds without a configured Supabase project ship with sync disabled.
  if (!syncConfigured) {
    return (
      <section class="mb-6">
        <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          Account
        </h3>
        <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div class="px-4 py-3.5 text-sm text-[var(--color-muted)]">
            Account sync isn't configured in this build.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section class="mb-6">
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        Account
      </h3>
      <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {!ready ? (
          <div class="px-4 py-3.5 text-sm text-[var(--color-muted)]">Loading…</div>
        ) : session ? (
          <SignedInRow email={email} onSignOut={signOut} />
        ) : (
          <SignInRow onSignIn={() => setModalOpen(true)} />
        )}
      </div>

      {modalOpen && (
        <AuthModal
          signIn={signIn}
          signUp={signUp}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}

function SignInRow({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div class="flex items-center gap-3 px-4 py-3.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)]">
        <UserIcon width={18} height={18} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-[var(--color-text)]">
          Sign in to sync
        </p>
        <p class="mt-0.5 text-xs text-[var(--color-muted)]">
          Keep your tasks in sync across all your devices.
        </p>
      </div>
      <button
        onClick={onSignIn}
        class="shrink-0 rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
      >
        Sign in
      </button>
    </div>
  );
}

function SignedInRow({
  email,
  onSignOut,
}: {
  email: string | null;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div class="flex items-center gap-3 px-4 py-3.5">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)]">
          <UserIcon width={18} height={18} />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-[var(--color-text)]">
            {email ?? "Signed in"}
          </p>
          <p class="mt-0.5 text-xs text-[var(--color-muted)]">
            Signed in — your tasks are linked to this account.
          </p>
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await onSignOut();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <SyncStatusRow />
    </>
  );
}

const STATUS_META: Record<SyncStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-[var(--color-success)]", label: "Synced" },
  syncing: { dot: "bg-[var(--color-warning)]", label: "Syncing…" },
  offline: { dot: "bg-[var(--color-faint)]", label: "Offline — will retry" },
  error: { dot: "bg-[var(--color-danger)]", label: "Sync failed" },
};

function SyncStatusRow() {
  const { status, lastSyncedAt, error, syncNow } = useSync();
  const meta = STATUS_META[status];
  const detail =
    status === "error"
      ? error ?? "Something went wrong."
      : status === "idle" && !lastSyncedAt
        ? "Not synced yet"
        : lastSyncedAt
          ? `Last synced ${relativeTime(lastSyncedAt)}`
          : "";

  return (
    <div class="flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <span class={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-[var(--color-text)]">{meta.label}</p>
        {detail && (
          <p class="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">{detail}</p>
        )}
      </div>
      <button
        onClick={() => void syncNow()}
        disabled={status === "syncing"}
        class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        {status === "syncing" ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function AuthModal({
  signIn,
  signUp,
  onClose,
}: {
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const run = mode === "signin" ? signIn : signUp;
      const result = await run(email, password);
      if (result.ok) onClose();
      else setError(result.error ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === "signup";

  return (
    <div
      class="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div class="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/50">
        <button
          onClick={onClose}
          title="Close"
          class="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <CloseIcon width={16} height={16} />
        </button>

        <div class="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span class="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <UserIcon width={24} height={24} />
          </span>
          <h3 class="text-lg font-semibold text-[var(--color-text)]">
            {signup ? "Create your account" : "Welcome back"}
          </h3>
          <p class="text-xs text-[var(--color-muted)]">
            {signup
              ? "Sync your tasks across all your devices."
              : "Sign in to sync your tasks across devices."}
          </p>
        </div>

        <form onSubmit={submit} class="flex flex-col gap-3 px-6 pt-3 pb-6">
          <Field
            label="Email"
            type="email"
            value={email}
            autocomplete="email"
            placeholder="you@example.com"
            onInput={setEmail}
          />
          <Field
            label="Password"
            type="password"
            value={password}
            autocomplete={signup ? "new-password" : "current-password"}
            placeholder={signup ? "At least 6 characters" : "••••••••"}
            onInput={setPassword}
            revealable
          />

          {error && (
            <p class="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            class="mt-1 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {busy
              ? signup
                ? "Creating account…"
                : "Signing in…"
              : signup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <div class="border-t border-[var(--color-border)] px-6 py-3.5 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(signup ? "signin" : "signup");
              setError(null);
            }}
            class="group text-xs text-[var(--color-muted)]"
          >
            {signup ? (
              <>
                Already have an account?{" "}
                <span class="font-medium text-[var(--color-accent)] transition-colors group-hover:text-[var(--color-accent-hover)]">
                  Sign in
                </span>
              </>
            ) : (
              <>
                New to todofy?{" "}
                <span class="font-medium text-[var(--color-accent)] transition-colors group-hover:text-[var(--color-accent-hover)]">
                  Create an account
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  placeholder,
  autocomplete,
  onInput,
  revealable,
}: {
  label: string;
  type: string;
  value: string;
  placeholder?: string;
  autocomplete?: string;
  onInput: (value: string) => void;
  revealable?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const inputType = revealable && reveal ? "text" : type;
  return (
    <label class="flex flex-col gap-1 text-left">
      <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
        {label}
      </span>
      <div class="relative">
        <input
          type={inputType}
          value={value}
          placeholder={placeholder}
          autocomplete={autocomplete}
          onInput={(e) => onInput(e.currentTarget.value)}
          class={`w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-2 pl-3 text-sm outline-none transition-colors focus:border-[var(--color-accent)] ${
            revealable ? "pr-10" : "pr-3"
          }`}
        />
        {revealable && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReveal((r) => !r)}
            title={reveal ? "Hide password" : "Show password"}
            aria-label={reveal ? "Hide password" : "Show password"}
            class="absolute inset-y-0 right-0 grid w-10 place-items-center text-[var(--color-faint)] transition-colors hover:text-[var(--color-text)]"
          >
            {reveal ? (
              <EyeOffIcon width={16} height={16} />
            ) : (
              <EyeIcon width={16} height={16} />
            )}
          </button>
        )}
      </div>
    </label>
  );
}
