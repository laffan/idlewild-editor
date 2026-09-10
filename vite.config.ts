import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Tauri drives this dev server; the fixed port and strictPort are what
// `devUrl` in tauri.conf.json points at.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      // psd-to-phaser ships no dist on `main`; scripts/vendor-p2p.mjs builds
      // it into vendor/ from a pinned ref.
      "psd-to-phaser": fileURLToPath(
        new URL("./vendor/psd-to-phaser/psd-to-phaser.es.js", import.meta.url),
      ),
    },
  },
  build: {
    target: "es2022",
    sourcemap: !!process.env.TAURI_DEBUG,
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
  },
});
