import { invoke } from "@tauri-apps/api/core";

/**
 * Supabase auth storage backed by the OS keychain (via Tauri `secret_*`
 * commands), so session tokens don't live in the webview's localStorage.
 *
 * If the keychain isn't reachable — no secret service on the box, or we're
 * running outside Tauri (e.g. a browser preview) — it transparently falls back
 * to localStorage so sign-in still works. The first failure flips the switch so
 * we don't retry the bridge on every call.
 */
let keychainOk = true;

async function viaKeychain<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  if (keychainOk) {
    try {
      return await fn();
    } catch {
      keychainOk = false;
    }
  }
  return fallback();
}

export const secureStorage = {
  getItem: (key: string) =>
    viaKeychain(
      () => invoke<string | null>("secret_get", { key }),
      () => localStorage.getItem(key),
    ),
  setItem: (key: string, value: string) =>
    viaKeychain(
      () => invoke<void>("secret_set", { key, value }),
      () => localStorage.setItem(key, value),
    ),
  removeItem: (key: string) =>
    viaKeychain(
      () => invoke<void>("secret_delete", { key }),
      () => localStorage.removeItem(key),
    ),
};
