import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { useAuth } from "./auth";
import {
  calendarDeleteSucceeded,
  isMissingCalendarStatus,
} from "./googleCalendarApi";

// Google Calendar sync is opt-in and configured at build time (see `.env.example`).
// The client id is public; the "secret" for a Desktop-app OAuth client is not
// treated as confidential by Google and is embedded per their installed-app flow.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";

/** True only when a build was configured with Google OAuth credentials. */
export const calendarConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);

// `calendar.app.created` is enough to create and manage the dedicated todofy
// calendar. v1.9 deliberately does not request access to the user's existing
// calendars; broader event synchronization is not part of this release.
// `openid email` lets us show which Google account is connected.
const SCOPE =
  "openid email https://www.googleapis.com/auth/calendar.app.created";

// Keyring entries (via the `secret_*` Tauri commands) — tokens never touch SQLite.
const K_ACCESS = "google_access_token";
const K_REFRESH = "google_refresh_token";
const K_EXPIRY = "google_token_expiry";

// Device-local settings rows for display + gating.
const S_CONNECTED = "calendar_google_connected";
const S_EMAIL = "calendar_google_email";
const S_OWNER_ID = "calendar_todofy_user_id";
// The original unscoped key is read only for migration. New IDs are retained
// per Todofy account so reconnecting never relies on CalendarList discovery.
const S_CALENDAR_ID_LEGACY = "calendar_google_calendar_id";
const S_CALENDAR_ID_PREFIX = `${S_CALENDAR_ID_LEGACY}:`;
const S_KEEP_COMPLETED = "calendar_keep_completed";
const S_TIMED_ONLY = "calendar_timed_only";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

// Summary of the dedicated secondary calendar todofy writes to. The narrow
// `calendar.app.created` scope only grants access to calendars we create, so
// we never touch the user's primary calendar.
const CALENDAR_SUMMARY = "todofy";

// The backend poll thread emits this when local tasks drift from their events.
const PUSH_EVENT = "calendar-push";
// Default length for a timed event built from a task's reminder time.
const TIMED_EVENT_MINUTES = 30;

type CalendarResult = { ok: true } | { ok: false; error: string };
type PushStatus = "idle" | "pushing" | "error";

interface TaskEvent {
  taskId: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  remindAt: string | null;
  status: string;
  updatedAt: string;
  eventId: string | null;
}

interface PendingDelete {
  taskId: string;
  externalEventId: string;
  externalCalendarId: string;
}

interface Pending {
  upserts: TaskEvent[];
  deletes: PendingDelete[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => UNRESERVED[b % UNRESERVED.length]).join("");
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(digest);
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`);
  return res.json();
}

async function storeTokens(tokens: TokenResponse) {
  await invoke("secret_set", { key: K_ACCESS, value: tokens.access_token });
  if (tokens.refresh_token) {
    await invoke("secret_set", { key: K_REFRESH, value: tokens.refresh_token });
  }
  const expiry = Date.now() + tokens.expires_in * 1000;
  await invoke("secret_set", { key: K_EXPIRY, value: String(expiry) });
}

async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

function calendarFetch(token: string, path: string, init?: RequestInit) {
  return fetch(`${CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function ownedCalendarIdKey(ownerId: string): string {
  return `${S_CALENDAR_ID_PREFIX}${ownerId}`;
}

async function migrateLegacyCalendarId(ownerId: string): Promise<void> {
  const ownedKey = ownedCalendarIdKey(ownerId);
  const [owned, legacy] = await Promise.all([
    invoke<string | null>("get_setting", { key: ownedKey }),
    invoke<string | null>("get_setting", { key: S_CALENDAR_ID_LEGACY }),
  ]);
  if (!legacy) return;
  if (!owned) await invoke("set_setting", { key: ownedKey, value: legacy });
  if (!owned || owned === legacy) {
    await invoke("set_setting", { key: S_CALENDAR_ID_LEGACY, value: "" });
  }
}

async function getCalendarIdForOwner(ownerId: string): Promise<string | null> {
  const owned = await invoke<string | null>("get_setting", {
    key: ownedCalendarIdKey(ownerId),
  });
  if (owned) return owned;

  const [legacy, legacyOwner] = await Promise.all([
    invoke<string | null>("get_setting", { key: S_CALENDAR_ID_LEGACY }),
    invoke<string | null>("get_setting", { key: S_OWNER_ID }),
  ]);
  return legacy && legacyOwner === ownerId ? legacy : null;
}

async function clearCalendarIdForOwner(ownerId: string, deletedId: string): Promise<void> {
  await invoke("set_setting", { key: ownedCalendarIdKey(ownerId), value: "" });
  const legacy = await invoke<string | null>("get_setting", { key: S_CALENDAR_ID_LEGACY });
  if (legacy === deletedId) {
    await invoke("set_setting", { key: S_CALENDAR_ID_LEGACY, value: "" });
  }
}

async function calendarApiError(res: Response, action: string): Promise<Error> {
  let detail = "";
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    detail = data.error?.message?.trim() ?? "";
  } catch {
    // Some Google errors have an empty or non-JSON body; the status is enough.
  }
  return new Error(`${action} (${res.status}${detail ? `: ${detail}` : ""}).`);
}

/**
 * Resolve todofy's dedicated calendar by its durable, account-scoped id.
 * CalendarList is deliberately avoided so the OAuth grant stays narrow. A
 * replacement is created only after Google definitively reports 404/410.
 */
async function ensureCalendar(token: string, ownerId: string): Promise<string> {
  const ownedKey = ownedCalendarIdKey(ownerId);
  const owned = await invoke<string | null>("get_setting", { key: ownedKey });
  const [legacy, legacyOwner] = owned
    ? [null, null]
    : await Promise.all([
        invoke<string | null>("get_setting", { key: S_CALENDAR_ID_LEGACY }),
        invoke<string | null>("get_setting", { key: S_OWNER_ID }),
      ]);
  const stored = owned ?? (legacyOwner === ownerId || !legacyOwner ? legacy : null);

  if (stored) {
    const res = await calendarFetch(token, `/calendars/${encodeURIComponent(stored)}`);
    if (res.ok) {
      if (!owned) {
        await invoke("set_setting", { key: ownedKey, value: stored });
        await invoke("set_setting", { key: S_CALENDAR_ID_LEGACY, value: "" });
      }
      return stored;
    }
    // Never discard an id for auth or transient failures: only a definitive
    // missing response permits replacement, preventing duplicate calendars.
    if (!isMissingCalendarStatus(res.status)) {
      throw await calendarApiError(res, "Couldn't verify the todofy calendar");
    }
  }

  const createRes = await calendarFetch(token, "/calendars", {
    method: "POST",
    body: JSON.stringify({
      summary: CALENDAR_SUMMARY,
      description: "Tasks synced from todofy.",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Couldn't create the todofy calendar (${createRes.status}).`);
  }
  const created = (await createRes.json()) as { id?: string };
  if (!created.id) throw new Error("Google created a calendar without returning its id.");
  await invoke("set_setting", { key: ownedKey, value: created.id });
  return created.id;
}

/** The dedicated calendar's id, or null if not connected yet. */
export function getCalendarId(): Promise<string | null> {
  const ownerId = useCalendar.getState().ownerId ?? useAuth.getState().session?.user.id;
  return ownerId ? getCalendarIdForOwner(ownerId) : Promise.resolve(null);
}

/** Google's all-day end date is exclusive, so a one-day event ends the next day. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Map a task to a Google event: timed when it has a reminder, else all-day. */
function eventBody(task: TaskEvent, timeZone: string) {
  const summary = (task.status === "done" ? "✓ " : "") + task.title;
  const description = task.notes ?? "";
  if (task.remindAt) {
    const start = new Date(task.remindAt);
    const end = new Date(start.getTime() + TIMED_EVENT_MINUTES * 60 * 1000);
    return {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
    };
  }
  const day = task.dueDate as string; // upserts always carry a due date
  return { summary, description, start: { date: day }, end: { date: nextDay(day) } };
}

/** The access token has been revoked/expired and can't be refreshed. */
export class AuthExpiredError extends Error {
  constructor(message = "Google access expired.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}
/** Google is throttling us; back off and retry after `retryAfterMs`. */
export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super("Google Calendar rate limit reached.");
  }
}

function retryAfterMs(res: Response): number {
  const secs = Number(res.headers.get("Retry-After"));
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 60_000;
}

async function isRateLimited(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  try {
    const data = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
    return (data.error?.errors ?? []).some((e) =>
      /rateLimit|quotaExceeded|userRateLimitExceeded/i.test(e.reason ?? ""),
    );
  } catch {
    return false;
  }
}

/** A Calendar-API fetch bound to one access token, refreshing it on a 401. */
export interface GoogleSession {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Open an authorized Calendar session. On a 401 it refreshes the token once and
 * retries; a still-failing 401 (or an unrefreshable token) is an
 * `AuthExpiredError`, a throttle response a `RateLimitError`. Each session holds
 * its own token so concurrent task-push and event-sync passes don't collide.
 * Returns null when there's no usable token (caller should treat as signed out).
 */
export async function openGoogleSession(): Promise<GoogleSession | null> {
  let token = await getAccessToken();
  if (!token) return null;
  const call = async (
    path: string,
    init?: RequestInit,
    allowRefresh = true,
  ): Promise<Response> => {
    const res = await calendarFetch(token as string, path, init);
    if (res.status === 401) {
      if (!allowRefresh) throw new AuthExpiredError();
      const fresh = await refreshAccessToken();
      if (!fresh) throw new AuthExpiredError();
      token = fresh;
      return call(path, init, false);
    }
    if ((res.status === 429 || res.status === 403) && (await isRateLimited(res))) {
      throw new RateLimitError(retryAfterMs(res));
    }
    return res;
  };
  return { fetch: (path, init) => call(path, init) };
}

async function upsertEvent(
  session: GoogleSession,
  calendarId: string,
  task: TaskEvent,
  timeZone: string,
): Promise<string> {
  const body = JSON.stringify(eventBody(task, timeZone));
  const cal = encodeURIComponent(calendarId);

  if (task.eventId) {
    const res = await session.fetch(
      `/calendars/${cal}/events/${encodeURIComponent(task.eventId)}`,
      { method: "PATCH", body },
    );
    if (res.ok) return ((await res.json()) as { id: string }).id;
    // If the event was deleted out from under us, fall through and recreate it.
    if (res.status !== 404 && res.status !== 410) {
      throw new Error(`Calendar update failed (${res.status}).`);
    }
  }

  const res = await session.fetch(`/calendars/${cal}/events`, { method: "POST", body });
  if (!res.ok) throw new Error(`Calendar create failed (${res.status}).`);
  return ((await res.json()) as { id: string }).id;
}

async function deleteEvent(session: GoogleSession, calendarId: string, eventId: string) {
  const res = await session.fetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // A 404/410 means it's already gone — that's the outcome we wanted.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar delete failed (${res.status}).`);
  }
}

async function deleteDedicatedCalendar(ownerId: string): Promise<string> {
  const calendarId = await getCalendarIdForOwner(ownerId);
  if (!calendarId) {
    throw new Error("The saved todofy calendar id is missing, so Google deletion was cancelled.");
  }
  const session = await openGoogleSession();
  if (!session) {
    throw new AuthExpiredError(
      "Google access expired. Reconnect Google Calendar before deleting the remote calendar.",
    );
  }
  const res = await session.fetch(`/calendars/${encodeURIComponent(calendarId)}`, {
    method: "DELETE",
  });
  if (!calendarDeleteSucceeded(res.status)) {
    throw await calendarApiError(res, "Couldn't delete the todofy calendar from Google");
  }
  return calendarId;
}

/**
 * A valid access token, refreshing it first if it's expired (or within a
 * minute of it). Returns null when the connection can't be refreshed — the
 * caller should treat that as disconnected. Used by the phase-4 push engine.
 */
export async function getAccessToken(): Promise<string | null> {
  const [access, expiryRaw] = await Promise.all([
    invoke<string | null>("secret_get", { key: K_ACCESS }),
    invoke<string | null>("secret_get", { key: K_EXPIRY }),
  ]);
  const expiry = expiryRaw ? Number(expiryRaw) : 0;
  if (access && Date.now() < expiry - 60_000) return access;
  return refreshAccessToken();
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await invoke<string | null>("secret_get", { key: K_REFRESH });
  if (!refresh) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  if (!res.ok) return null;
  const tokens = (await res.json()) as TokenResponse;
  await invoke("secret_set", { key: K_ACCESS, value: tokens.access_token });
  await invoke("secret_set", {
    key: K_EXPIRY,
    value: String(Date.now() + tokens.expires_in * 1000),
  });
  return tokens.access_token;
}

async function revoke() {
  const token =
    (await invoke<string | null>("secret_get", { key: K_REFRESH })) ??
    (await invoke<string | null>("secret_get", { key: K_ACCESS }));
  if (!token) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
  } catch {
    // Best effort — we clear the local tokens regardless.
  }
}

async function clearStoredTokens() {
  await Promise.all(
    [K_ACCESS, K_REFRESH, K_EXPIRY].map((key) =>
      invoke("secret_delete", { key }).catch(() => {}),
    ),
  );
}

interface CalendarState {
  connected: boolean;
  /** Supabase user that owns this device-local Google connection. */
  ownerId: string | null;
  email: string | null;
  /** False until the initial settings lookup resolves, so the UI can wait. */
  ready: boolean;
  busy: boolean;
  status: PushStatus;
  lastPushedAt: string | null;
  pushError: string | null;
  /** Keep finished tasks on the calendar (with a ✓) instead of removing them. */
  keepCompleted: boolean;
  /** Only push tasks that have a set time, skipping date-only tasks. */
  timedOnly: boolean;

  init: () => void;
  connect: () => Promise<CalendarResult>;
  disconnect: (deleteRemote: boolean) => Promise<CalendarResult>;
  push: () => Promise<void>;
  setKeepCompleted: (value: boolean) => Promise<void>;
  setTimedOnly: (value: boolean) => Promise<void>;
}

export const useCalendar = create<CalendarState>((set, get) => ({
  connected: false,
  ownerId: null,
  email: null,
  ready: false,
  busy: false,
  status: "idle",
  lastPushedAt: null,
  pushError: null,
  keepCompleted: false,
  timedOnly: false,

  init: () => {
    if (!calendarConfigured) {
      set({ ready: true });
      return;
    }
    void (async () => {
      const [connected, ownerId, email, keep, timed] = await Promise.all([
        invoke<string | null>("get_setting", { key: S_CONNECTED }),
        invoke<string | null>("get_setting", { key: S_OWNER_ID }),
        invoke<string | null>("get_setting", { key: S_EMAIL }),
        invoke<string | null>("get_setting", { key: S_KEEP_COMPLETED }),
        invoke<string | null>("get_setting", { key: S_TIMED_ONLY }),
      ]);
      const auth = useAuth.getState();
      const ownedByCurrentUser =
        connected === "true" && !!ownerId && ownerId === auth.session?.user.id;
      set({
        connected: ownedByCurrentUser,
        ownerId: ownerId || null,
        email: email || null,
        keepCompleted: keep === "true",
        timedOnly: timed === "true",
        ready: true,
      });

      if (ownedByCurrentUser && ownerId) {
        void migrateLegacyCalendarId(ownerId).catch(() => {});
      }

      // A legacy or mismatched connection must never become active. Wait for
      // Supabase's initial session lookup when it is still in flight.
      if (connected === "true" && auth.ready && !ownedByCurrentUser) {
        void disconnectForAccountChange();
      }
    })();
  },

  connect: async () => {
    if (get().busy) return { ok: false, error: "Already connecting." };
    const ownerId = useAuth.getState().session?.user.id;
    if (!ownerId) {
      return { ok: false, error: "Sign in to todofy before connecting Google Calendar." };
    }
    set({ busy: true });
    let storedCredentials = false;
    try {
      const verifier = randomString(64);
      const challenge = await challengeFor(verifier);
      const state = randomString(32);

      const { code, redirectUri } = await invoke<{ code: string; redirectUri: string }>(
        "google_oauth_flow",
        { clientId: CLIENT_ID, scope: SCOPE, codeChallenge: challenge, state },
      );

      const tokens = await exchangeCode(code, redirectUri, verifier);
      if (useAuth.getState().session?.user.id !== ownerId) {
        throw new Error("Your todofy account changed while Google was connecting.");
      }
      await storeTokens(tokens);
      storedCredentials = true;
      const email = await fetchEmail(tokens.access_token);
      await ensureCalendar(tokens.access_token, ownerId);

      if (useAuth.getState().session?.user.id !== ownerId) {
        throw new Error("Your todofy account changed while Google was connecting.");
      }

      await invoke("set_setting", { key: S_OWNER_ID, value: ownerId });
      await invoke("set_setting", { key: S_CONNECTED, value: "true" });
      if (email) await invoke("set_setting", { key: S_EMAIL, value: email });

      pauseUntil = 0;
      set({ connected: true, ownerId, email, status: "idle", pushError: null });
      return { ok: true };
    } catch (e) {
      if (storedCredentials) {
        await revoke();
        await clearStoredTokens();
        await Promise.all([
          invoke("set_setting", { key: S_CONNECTED, value: "false" }).catch(() => {}),
          invoke("set_setting", { key: S_OWNER_ID, value: "" }).catch(() => {}),
        ]);
        set({ connected: false, ownerId: null });
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      set({ busy: false });
    }
  },

  disconnect: async (deleteRemote) => {
    if (get().busy) return { ok: false, error: "Another calendar action is in progress." };
    const wasConnected = get().connected;
    const ownerId = get().ownerId;
    // Stop every in-process sync path while remote deletion is pending. The
    // persisted connection and credentials stay intact until Google confirms.
    set({ busy: true, connected: false });

    let deletedCalendarId: string | null = null;
    if (deleteRemote) {
      try {
        if (!ownerId) throw new Error("The Google Calendar connection owner is missing.");
        deletedCalendarId = await deleteDedicatedCalendar(ownerId);
      } catch (e) {
        set({ connected: wasConnected, busy: false });
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    try {
      await invoke("set_setting", { key: S_CONNECTED, value: "false" }).catch(() => {});

      await revoke();
      await clearStoredTokens();
      await invoke("set_setting", { key: S_EMAIL, value: "" }).catch(() => {});
      await invoke("set_setting", { key: S_OWNER_ID, value: "" }).catch(() => {});

      if (deletedCalendarId && ownerId) {
        // Only forget the durable id and links after Google confirmed deletion
        // (or confirmed that the calendar was already gone).
        await clearCalendarIdForOwner(ownerId, deletedCalendarId).catch(() => {});
        await invoke("calendar_clear_links").catch(() => {});
      }
      // Otherwise retain the owner-scoped id + links so reconnecting can verify
      // and reuse the exact calendar without CalendarList access.

      set({
        connected: false,
        ownerId: null,
        email: null,
        status: "idle",
        lastPushedAt: null,
        pushError: null,
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: `Google Calendar disconnected, but local cleanup failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    } finally {
      set({ busy: false });
    }
  },

  push: () => pushPending(),

  setKeepCompleted: async (value) => {
    set({ keepCompleted: value });
    await invoke("set_setting", {
      key: S_KEEP_COMPLETED,
      value: value ? "true" : "false",
    }).catch(() => {});
    // Reconcile existing completed tasks to the new rule right away.
    void pushPending();
  },

  setTimedOnly: async (value) => {
    set({ timedOnly: value });
    await invoke("set_setting", {
      key: S_TIMED_ONLY,
      value: value ? "true" : "false",
    }).catch(() => {});
    // Reconcile: date-only events get removed (or restored) to match the scope.
    void pushPending();
  },

}));

/** True only while the active Todofy user owns the Google connection. */
export function calendarBelongsToCurrentUser(): boolean {
  const userId = useAuth.getState().session?.user.id;
  const calendar = useCalendar.getState();
  return !!userId && calendar.connected && calendar.ownerId === userId;
}

let accountDisconnecting = false;

/**
 * Revoke and forget a Google connection when the Todofy identity changes.
 * The dedicated calendar and task links remain, but no credentials can cross
 * the account boundary. Sync is disabled synchronously before any await.
 */
async function disconnectForAccountChange() {
  if (accountDisconnecting) return;
  accountDisconnecting = true;
  const previousOwnerId = useCalendar.getState().ownerId;
  useCalendar.setState({
    connected: false,
    ownerId: null,
    email: null,
    status: "idle",
    lastPushedAt: null,
    pushError: null,
  });

  try {
    // Preserve the legacy id under the outgoing account before its ownership
    // marker is cleared, so each account can reuse its own calendar later.
    if (previousOwnerId) await migrateLegacyCalendarId(previousOwnerId).catch(() => {});
    await invoke("set_setting", { key: S_CONNECTED, value: "false" }).catch(() => {});
    await revoke();
    await clearStoredTokens();
    await Promise.all([
      invoke("set_setting", { key: S_OWNER_ID, value: "" }).catch(() => {}),
      invoke("set_setting", { key: S_EMAIL, value: "" }).catch(() => {}),
    ]);
  } finally {
    accountDisconnecting = false;
  }
}

let pushing = false;
// Set after a rate-limit response; pushes are skipped until it passes.
let pauseUntil = 0;

/**
 * Reconcile local tasks with the todofy calendar: delete events whose task is
 * gone/completed, then create/update events for active dated tasks that
 * changed. Runs one at a time and skips while backing off from a rate limit;
 * the backend poll (or the next edit) re-triggers it if more is pending.
 */
export async function pushPending(): Promise<void> {
  if (pushing || !calendarConfigured || !calendarBelongsToCurrentUser()) return;
  if (Date.now() < pauseUntil) return;
  pushing = true;
  useCalendar.setState({ status: "pushing", pushError: null });
  try {
    const session = await openGoogleSession();
    if (!session) {
      await handleAuthFailure();
      return;
    }
    const calendarId = await getCalendarId();
    if (!calendarId) throw new Error("The todofy calendar is missing.");

    const pending = await invoke<Pending>("calendar_pending");
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Deletes first, so a task that was re-dated after deletion gets a clean
    // new event rather than colliding with a stale one.
    for (const del of pending.deletes) {
      await deleteEvent(session, del.externalCalendarId, del.externalEventId);
      await invoke("calendar_link_remove", { taskId: del.taskId });
    }
    for (const task of pending.upserts) {
      const eventId = await upsertEvent(session, calendarId, task, timeZone);
      await invoke("calendar_link_set", {
        taskId: task.taskId,
        eventId,
        calendarId,
        pushedUpdatedAt: task.updatedAt,
      });
    }

    useCalendar.setState({
      status: "idle",
      lastPushedAt: new Date().toISOString(),
      pushError: null,
    });
  } catch (e) {
    if (e instanceof AuthExpiredError) {
      await handleAuthFailure();
    } else if (e instanceof RateLimitError) {
      // Partial progress already recorded its links; the rest retries after the
      // backoff window, so we don't hammer Google.
      pauseUntil = Date.now() + e.retryAfterMs;
      useCalendar.setState({
        status: "error",
        pushError: "Google rate limit reached — will retry shortly.",
      });
    } else {
      useCalendar.setState({
        status: "error",
        pushError: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    pushing = false;
  }
}

/**
 * The Google connection is unrecoverable (token revoked or refresh rejected):
 * drop the dead tokens, stop the backend poll, and surface a reconnect prompt.
 * The calendar id is kept so a reconnect reuses the same calendar.
 */
async function handleAuthFailure() {
  await clearStoredTokens();
  await invoke("set_setting", { key: S_CONNECTED, value: "false" }).catch(() => {});
  useCalendar.setState({
    connected: false,
    status: "error",
    pushError: "Google access expired — reconnect to resume calendar sync.",
  });
}

let calendarWired = false;
let pushDebounce: ReturnType<typeof setTimeout> | undefined;

/**
 * Wire up calendar push: load the saved connection, listen for the backend's
 * poll nudge, push shortly after a local task edit, and push once whenever the
 * connection turns on (launch restore or a fresh connect). Call once at startup.
 */
export function initCalendar() {
  useCalendar.getState().init();
  if (!calendarConfigured || calendarWired) return;
  calendarWired = true;

  void listen(PUSH_EVENT, () => void pushPending());

  useStore.subscribe((state, prev) => {
    if (state.tasks !== prev.tasks && useCalendar.getState().connected) {
      clearTimeout(pushDebounce);
      pushDebounce = setTimeout(() => void pushPending(), 1500);
    }
  });

  useCalendar.subscribe((s, p) => {
    if (s.connected && !p.connected) void pushPending();
  });

  useAuth.subscribe((auth) => {
    if (!auth.ready) return;
    const userId = auth.session?.user.id ?? null;
    const calendar = useCalendar.getState();

    if (calendar.ownerId && calendar.ownerId !== userId) {
      void disconnectForAccountChange();
      return;
    }

    // Calendar settings can load before the Supabase session. Restore the
    // connection only after the matching owner is known.
    if (userId && calendar.ownerId === userId && !calendar.connected) {
      void invoke<string | null>("get_setting", { key: S_CONNECTED }).then((connected) => {
        const latestAuthId = useAuth.getState().session?.user.id;
        const latestCalendar = useCalendar.getState();
        if (
          connected === "true" &&
          latestAuthId === userId &&
          latestCalendar.ownerId === userId
        ) {
          useCalendar.setState({ connected: true });
        }
      });
    }
  });
}
