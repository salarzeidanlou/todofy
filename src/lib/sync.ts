import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { useStore } from "../store";

interface Bundle {
  tasks: unknown[];
  labels: unknown[];
  task_labels: unknown[];
  sessions: unknown[];
}

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  syncNow: () => Promise<void>;
}

export const useSync = create<SyncState>((set, get) => ({
  status: "idle",
  lastSyncedAt: null,
  error: null,
  syncNow: async () => {
    if (get().status === "syncing") return;
    if (!useAuth.getState().session) return;

    set({ status: "syncing", error: null });
    try {
      const since = await invoke<string>("sync_get_watermark");
      const startedAt = new Date().toISOString();

      // Pull remote changes, then merge them locally (last-write-wins).
      const remote = await pull(since);
      await invoke("sync_apply", { remote });

      // Push everything changed locally since the last round.
      const local = await invoke<Bundle>("sync_changes_since", { since });
      await push(local);

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
      const offline = e instanceof TypeError || /fetch|network/i.test(String(e));
      set({ status: offline ? "offline" : "error", error: String(e) });
    }
  },
}));

async function pull(since: string): Promise<Bundle> {
  const fetchTable = async (table: string) => {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .gt("updated_at", since);
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  // Fetch order doesn't matter; sync_apply merges in FK-safe order.
  return {
    labels: await fetchTable("labels"),
    tasks: await fetchTable("tasks"),
    task_labels: await fetchTable("task_labels"),
    sessions: await fetchTable("time_sessions"),
  };
}

async function push(local: Bundle): Promise<void> {
  const upsert = async (table: string, rows: unknown[], onConflict?: string) => {
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
}

// --- Triggers ---------------------------------------------------------------

/** True while sync is applying pulled data, so the store subscription below
 *  doesn't treat sync's own refresh as a fresh local edit. */
let applying = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

/** Debounced push after a local edit. */
function scheduleSync() {
  if (applying || !useAuth.getState().session) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void useSync.getState().syncNow(), 1500);
}

/**
 * Wire up sync: run on sign-in, poll periodically while signed in, and push
 * shortly after any local task/label change. Safe to call once at startup; it
 * reacts to auth state on its own. Assumes one account per install — switching
 * accounts on the same device is not handled here.
 */
export function initSync() {
  let lastUserId: string | null = useAuth.getState().session?.user.id ?? null;

  useAuth.subscribe((s) => {
    const userId = s.session?.user.id ?? null;
    if (userId === lastUserId) return;
    lastUserId = userId;

    clearInterval(interval);
    if (userId) {
      void useSync.getState().syncNow();
      interval = setInterval(() => void useSync.getState().syncNow(), 30_000);
    } else {
      useSync.setState({ status: "idle", lastSyncedAt: null, error: null });
    }
  });

  // A change to the task or label lists means a local edit worth pushing.
  useStore.subscribe((state, prev) => {
    if (state.tasks !== prev.tasks || state.labels !== prev.labels) scheduleSync();
  });

  // If a session was already restored at launch, kick off the first round.
  if (useAuth.getState().session) {
    void useSync.getState().syncNow();
    interval = setInterval(() => void useSync.getState().syncNow(), 30_000);
  }
}
