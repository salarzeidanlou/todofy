import { createClient } from "@supabase/supabase-js";
import { secureStorage } from "./secureStorage";

const url =
  import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: secureStorage,
  },
});
