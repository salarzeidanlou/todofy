import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase, syncConfigured } from "./supabase";

type AuthResult = { ok: true } | { ok: false; error: string };

interface AuthState {
  session: Session | null;
  /** False until the initial session lookup resolves, so the UI can wait. */
  ready: boolean;
  email: string | null;

  init: () => void;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
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

  signOut: async () => {
    await supabase.auth.signOut();
  },
}));
