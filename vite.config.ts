import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [preact(), tailwindcss()],

  // Two HTML entry points: the main app and the quick-add spotlight window.
  build: {
    rollupOptions: {
      input: {
        main: entry("./index.html"),
        quickadd: entry("./quickadd.html"),
        notification: entry("./notification.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
