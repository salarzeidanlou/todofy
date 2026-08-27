import { createClient } from "@supabase/supabase-js";
import { secureStorage } from "./secureStorage";

const url =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://zrxjrtovttuupzxabjwn.supabase.co";
const anonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_9MrOf3LeKIqHcGyChWOwQg_NiaPgr5l";

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: secureStorage,
  },
});
