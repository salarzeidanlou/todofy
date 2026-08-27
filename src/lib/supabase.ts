import { createClient } from "@supabase/supabase-js";
import { secureStorage } from "./secureStorage";

// Sync is opt-in: the URL and publishable key are injected at build time from
// `.env` (see `.env.example`). No hardcoded fallback — a build without them
// simply ships with sync disabled rather than pointing at someone else's project.
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

/** True only when a build was configured with a Supabase project to sync against. */
export const syncConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || "http://localhost", anonKey || "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: secureStorage,
  },
  // Which Postgres schema the tables live in. Self-host uses the default
  // `public` (the simple single-app migration); a build can override it via
  // VITE_SUPABASE_SCHEMA to point at an app-specific schema in a shared project.
  db: { schema: import.meta.env.VITE_SUPABASE_SCHEMA || "public" },
});
