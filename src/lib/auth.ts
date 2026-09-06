import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { supabase, syncConfigured } from "./supabase";
import { parseOAuthCallback } from "./authOAuth";

type AuthResult = { ok: true } | { ok: false; error: string };

const OAUTH_REDIRECT = "todofy://auth-callback";

async function completeOAuth(rawUrl: string) {
  const code = parseOAuthCallback(rawUrl);
  if (!code) return;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

interface AuthState {
  session: Session | null;
  /** False until the initial session lookup resolves, so the UI can wait. */
  ready: boolean;
  email: string | null;

  init: () => void;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  deleteAccount: (wipeLocal: boolean) => Promise<AuthResult>;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  ready: false,
  email: null,

  init: () => {
    // No project configured for this build: mark ready so the UI stops waiting,
    // but never reach out to Supabase.
    if (!syncConfigured) {
      set({ ready: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      set({
        session: data.session,
        email: data.session?.user.email ?? null,
        ready: true,
      });
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, email: session?.user.email ?? null });
    });
    listen<string>("deep-link", (e) => {
      void completeOAuth(e.payload).catch((error) => {
        console.error("Could not complete Google sign-in:", error);
      });
    });
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  signInWithGoogle: async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error) return { ok: false, error: error.message };
    if (data.url) await openUrl(data.url);
    return { ok: true };
  },

  signOut: async () => {
    await supabase.auth.signOut();
  },

  deleteAccount: async (wipeLocal) => {
    // Must run before signOut so the function still gets the caller's JWT.
    const { error } = await supabase.functions.invoke("delete-account", {
      method: "POST",
    });
    if (error) return { ok: false, error: error.message };

    try {
      await invoke(wipeLocal ? "wipe_local_data" : "sync_reset");
    } catch {
      // Best effort — the cloud account is already gone.
    }
    await supabase.auth.signOut();
    if (wipeLocal) window.location.reload();
    return { ok: true };
  },
}));
