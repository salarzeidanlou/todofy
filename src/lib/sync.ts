import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { supabase, syncConfigured } from "./supabase";
import { useAuth } from "./auth";
import { useStore } from "../store";
import { billingConfigured, useBilling } from "./billing";

type SyncRow = Record<string, unknown>;

interface SyncTombstone extends SyncRow {
  entity_type:
    | "tasks"
    | "labels"
    | "task_labels"
    | "time_sessions"
    | "journal_entries";
  entity_id: string;
  deleted_at: string;
}

interface Bundle {
  board_columns: SyncRow[];
  tasks: SyncRow[];
  labels: SyncRow[];
  task_labels: SyncRow[];
  sessions: SyncRow[];
  journal: SyncRow[];
  tombstones: SyncTombstone[];
}

export type SyncStatus = "idle" | "syncing" | "error" | "offline" | "paused";
export type AccountDataChoice = "account" | "copy-local";

export interface SyncAccountChoice {
  previousUserId: string | null;
}

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  accountChoice: SyncAccountChoice | null;
  syncNow: (interactive?: boolean) => Promise<void>;
  resolveAccountChoice: (choice: AccountDataChoice) => Promise<void>;
}

export const useSync = create<SyncState>((set, get) => ({
  status: "idle",
  lastSyncedAt: null,
  error: null,
  accountChoice: null,
  syncNow: async (interactive = false) => {
    if (get().status === "syncing") return;
    if (!syncConfigured) return;
    const session = useAuth.getState().session;
    if (!session || get().accountChoice) return;

    let accessRevision: string | null = null;
    if (billingConfigured) {
      let billing = useBilling.getState();
      const accessExpired = Boolean(
        billing.validUntil && Date.parse(billing.validUntil) <= Date.now(),
      );
      if (billing.state === "checking" || accessExpired) {
        await billing.refresh();
        billing = useBilling.getState();
      }
      if (!billing.allowed) {
        set({
          status: "paused",
          error: billing.state === "unavailable"
            ? billing.error ?? "Could not verify Cloud Sync access."
            : "Todofy Pro is required for Cloud Sync.",
        });
        if (interactive && billing.state !== "unavailable") {
          useBilling.getState().openGate("cloud_sync");
        }
        return;
      }
      accessRevision = billing.revision;
    }

    set({ status: "syncing", error: null });
    try {
      const accountChoice = await ensureSyncOwner(session.user.id);
      if (accountChoice) {
        set({ status: "idle", accountChoice });
        return;
      }
      assertSyncContext(session.user.id, accessRevision);

      const since = await invoke<string>("sync_get_watermark");
      const startedAt = new Date().toISOString();

      // Pull remote changes, then merge them locally (last-write-wins).
      const remote = await pull(since);
      assertSyncContext(session.user.id, accessRevision);
      await invoke("sync_apply", { remote });
      assertSyncContext(session.user.id, accessRevision);

      // Push everything changed locally since the last round.
      const local = await invoke<Bundle>("sync_changes_since", { since });
      await push(local);

      // A round that moved nothing lets the poll below back off.
      lastRoundHadChanges = hasRows(remote) || hasRows(local);

      // Re-read the server-side grant before moving the checkpoint. This
      // prevents an RLS-filtered empty pull during revocation/expiry from being
      // mistaken for a successful empty sync.
      if (billingConfigured) {
        await useBilling.getState().refresh();
        assertSyncContext(session.user.id, accessRevision, true);
      } else {
        assertSyncContext(session.user.id, accessRevision);
      }

      // Advance the watermark to the moment the round began, so anything
      // written mid-sync is caught next time rather than skipped.
      await invoke("sync_set_watermark", { value: startedAt });

      // Reflect merged remote data in the UI without a loading flash.
      applying = true;
      try {
        await useStore.getState().load();
        await useStore.getState().loadTimers();
      } finally {
        applying = false;
      }

      set({ status: "idle", lastSyncedAt: startedAt, error: null });

      // Reclaim space from tombstones old enough to have propagated everywhere.
      invoke("sync_purge_tombstones", { days: 30 }).catch(() => {});
    } catch (e) {
      if (e instanceof SyncAuthorizationChanged) {
        if (useAuth.getState().session?.user.id !== session.user.id) return;
        const billing = useBilling.getState();
        set({
          status: billingConfigured && (!billing.allowed || billing.state === "unavailable")
            ? "paused"
            : "idle",
          error: billing.state === "unavailable" ? billing.error : null,
        });
        return;
      }
      const offline =
        e instanceof TypeError || /fetch|network/i.test(String(e));
      set({ status: offline ? "offline" : "error", error: String(e) });
    }
  },
  resolveAccountChoice: async (choice) => {
    const session = useAuth.getState().session;
    if (!session) return;
    set({ status: "syncing", error: null });
    try {
      if (choice === "account") {
        await invoke("sync_use_account_data", { userId: session.user.id });
      } else {
        await invoke("sync_copy_local_data", { userId: session.user.id });
      }
      set({ status: "idle", accountChoice: null });
      await get().syncNow();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));

class SyncAuthorizationChanged extends Error {}

function assertSyncContext(
  userId: string,
  accessRevision: string | null,
  requireVerified = false,
) {
  if (useAuth.getState().session?.user.id !== userId) {
    throw new SyncAuthorizationChanged("The signed-in account changed during sync.");
  }
  if (!billingConfigured) return;
  const billing = useBilling.getState();
  if (
    !billing.allowed ||
    billing.revision !== accessRevision ||
    (requireVerified && billing.state === "unavailable")
  ) {
    throw new SyncAuthorizationChanged("Cloud Sync access changed during sync.");
  }
}

const EPOCH = "1970-01-01T00:00:00+00:00";

async function ensureSyncOwner(
  userId: string,
): Promise<SyncAccountChoice | null> {
  const owner = await invoke<string | null>("sync_get_owner");
  if (owner === userId) return null;

  const hasLocalData = await invoke<boolean>("sync_has_local_data");
  if (!hasLocalData) {
    if (owner) await invoke("sync_use_account_data", { userId });
    else await invoke("sync_claim_owner", { userId });
    return null;
  }

  if (!owner) {
    const [local, remote] = await Promise.all([
      invoke<Bundle>("sync_changes_since", { since: EPOCH }),
      pull(EPOCH),
    ]);
    if (bundlesOverlap(local, remote)) {
      await invoke("sync_claim_owner", { userId });
      return null;
    }
  }

  return { previousUserId: owner };
}

function hasRows(bundle: Bundle): boolean {
  return Object.values(bundle).some((rows) => rows.length > 0);
}

function bundlesOverlap(a: Bundle, b: Bundle): boolean {
  const overlaps = (
    left: SyncRow[],
    right: SyncRow[],
    key: (row: SyncRow) => string,
  ) => {
    const keys = new Set(left.map(key).filter(Boolean));
    return right.some((row) => keys.has(key(row)));
  };
  const id = (row: SyncRow) => String(row.id ?? "");
  const association = (row: SyncRow) =>
    `${row.task_id ?? ""}:${row.label_id ?? ""}`;
  const tombstone = (row: SyncRow) =>
    `${row.entity_type ?? ""}:${row.entity_id ?? ""}`;
  return (
    overlaps(a.board_columns.filter((c) => !["todo", "doing", "blocked", "done"].includes(String(c.id))), b.board_columns, id) ||
    overlaps(a.tasks, b.tasks, id) ||
    overlaps(a.labels, b.labels, id) ||
    overlaps(a.sessions, b.sessions, id) ||
    overlaps(a.journal, b.journal, id) ||
    overlaps(a.task_labels, b.task_labels, association) ||
    overlaps(a.tombstones, b.tombstones, tombstone)
  );
}

/** One RPC for every table, rather than a `select` per table per poll. */
async function pull(since: string): Promise<Bundle> {
  const { data, error } = await supabase.rpc("sync_pull", { since });
  if (error) throw new Error(error.message);
  const bundle = (data ?? {}) as Partial<Bundle>;
  return {
    board_columns: bundle.board_columns ?? [],
    labels: bundle.labels ?? [],
    tasks: bundle.tasks ?? [],
    task_labels: bundle.task_labels ?? [],
    sessions: bundle.sessions ?? [],
    journal: bundle.journal ?? [],
    tombstones: bundle.tombstones ?? [],
  };
}

async function push(local: Bundle): Promise<void> {
  // Server-side LWW protects customized defaults from a fresh device's seeds.
  if (local.board_columns.length) {
    const { error } = await supabase.rpc("sync_board_columns", { changes: local.board_columns });
    if (error) throw new Error(`Could not sync board columns. Apply the custom_board_columns database migration. ${error.message}`);
  }
  const upsert = async (
    table: string,
    rows: SyncRow[],
    onConflict?: string,
  ) => {
    if (!rows.length) return;
    const query = onConflict
      ? supabase.from(table).upsert(rows, { onConflict })
      : supabase.from(table).upsert(rows);
    const { error } = await query;
    if (error) throw new Error(error.message);
  };
  // Parents before children, so a foreign key never lands before its target.
  await upsert("labels", local.labels);
  await upsert("tasks", local.tasks);
  await upsert("task_labels", local.task_labels, "task_id,label_id");
  await upsert("time_sessions", local.sessions);
  await upsert("journal_entries", local.journal);

  if (!local.tombstones.length) return;

  // Persist the deletion marker before removing content. Markers are immutable:
  // UUIDs are never reused, and keeping the first deletion is enough to stop a
  // stale device from resurrecting the row.
  const markerRows = local.tombstones.map(
    ({ entity_type, entity_id, deleted_at }) => ({
      entity_type,
      entity_id,
      deleted_at,
    }),
  );
  const { error: markerError } = await supabase
    .from("sync_tombstones")
    .upsert(markerRows, {
      onConflict: "user_id,entity_type,entity_id",
      ignoreDuplicates: true,
      defaultToNull: false,
    });
  if (markerError) throw new Error(markerError.message);

  const deleteIds = async (table: string, ids: string[]) => {
    if (!ids.length) return;
    const { error } = await supabase.from(table).delete().in("id", ids);
    if (error) throw new Error(error.message);
  };
  const idsFor = (type: SyncTombstone["entity_type"]) =>
    local.tombstones
      .filter((t) => t.entity_type === type)
      .map((t) => t.entity_id);

  // Children before parents. Task and label foreign keys also cascade, but the
  // explicit order keeps retries deterministic and works for standalone child
  // deletions too.
  for (const key of idsFor("task_labels")) {
    const [taskId, labelId] = key.split(":", 2);
    if (!taskId || !labelId)
      throw new Error(`Invalid task-label tombstone: ${key}`);
    const { error } = await supabase
      .from("task_labels")
      .delete()
      .eq("task_id", taskId)
      .eq("label_id", labelId);
    if (error) throw new Error(error.message);
  }
  await deleteIds("time_sessions", idsFor("time_sessions"));
  await deleteIds("journal_entries", idsFor("journal_entries"));
  await deleteIds("tasks", idsFor("tasks"));
  await deleteIds("labels", idsFor("labels"));
}

// --- Triggers ---------------------------------------------------------------

/** True while sync is applying pulled data, so the store subscription below
 *  doesn't treat sync's own refresh as a fresh local edit. */
let applying = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setTimeout> | undefined;

/** Poll cadence, backing off each time a round finds nothing. Local edits still
 *  sync in ~1.5s via `scheduleSync`, so the slow steps cost nothing visible. */
const POLL_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 900_000];
const SLOWEST_STEP = POLL_STEPS_MS.length - 1;

let pollStep = 0;
let lastRoundHadChanges = false;

function syncEnabled(): boolean {
  return (
    Boolean(useAuth.getState().session) &&
    (!billingConfigured || useBilling.getState().allowed)
  );
}

function scheduleNextPoll() {
  clearTimeout(poll);
  if (!syncEnabled()) return;
  // Nobody is looking at a tray window, but it should still notice another
  // device's edits eventually.
  const delay = document.hidden
    ? POLL_STEPS_MS[SLOWEST_STEP]
    : POLL_STEPS_MS[pollStep];
  poll = setTimeout(async () => {
    lastRoundHadChanges = false;
    await useSync.getState().syncNow();
    pollStep = lastRoundHadChanges ? 0 : Math.min(pollStep + 1, SLOWEST_STEP);
    scheduleNextPoll();
  }, delay);
}

/** Debounced push after a local edit. */
function scheduleSync() {
  if (applying || !syncEnabled()) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    void useSync.getState().syncNow();
    pollStep = 0; // The user is active again.
    scheduleNextPoll();
  }, 1500);
}

/**
 * Wire up sync: run on sign-in, poll periodically while signed in, and push
 * shortly after any local task/label change. Safe to call once at startup; it
 * reacts to auth state on its own. Assumes one account per install — switching
 * accounts on the same device is not handled here.
 */
export function initSync() {
  let lastUserId: string | null = useAuth.getState().session?.user.id ?? null;

  const startPolling = () => {
    clearTimeout(poll);
    pollStep = 0;
    if (syncEnabled()) {
      void useSync.getState().syncNow();
      scheduleNextPoll();
    } else if (useAuth.getState().session && billingConfigured) {
      useSync.setState({ status: "paused", error: null });
    }
  };

  // Returning to the window resyncs at once, unless a round just ran — so
  // repeated alt-tabbing doesn't fire a request each time.
  const onVisibilityChange = () => {
    if (!syncEnabled()) return;
    if (document.visibilityState !== "visible") {
      scheduleNextPoll(); // Re-arms at the slow tray cadence.
      return;
    }
    pollStep = 0;
    const last = useSync.getState().lastSyncedAt;
    if (!last || Date.now() - Date.parse(last) >= POLL_STEPS_MS[0]) {
      void useSync.getState().syncNow();
    }
    scheduleNextPoll();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onVisibilityChange);

  useAuth.subscribe((s) => {
    const userId = s.session?.user.id ?? null;
    if (userId === lastUserId) return;
    lastUserId = userId;

    if (userId) {
      startPolling();
    } else {
      clearTimeout(poll);
      useSync.setState({
        status: "idle",
        lastSyncedAt: null,
        error: null,
        accountChoice: null,
      });
    }
  });

  if (billingConfigured) {
    let lastAllowed = useBilling.getState().allowed;
    useBilling.subscribe((billing) => {
      if (billing.allowed === lastAllowed) return;
      lastAllowed = billing.allowed;
      startPolling();
    });
  }

  // A change to the task, label, or journal lists means a local edit to push.
  useStore.subscribe((state, prev) => {
    if (
      state.boardDefinitions !== prev.boardDefinitions ||
      state.tasks !== prev.tasks ||
      state.labels !== prev.labels ||
      state.journal !== prev.journal
    )
      scheduleSync();
  });

  // If a session was already restored at launch, kick off the first round.
  if (useAuth.getState().session) startPolling();
}
