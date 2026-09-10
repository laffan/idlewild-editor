import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const stub = (name: string) =>
  fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 1421, strictPort: true },
  resolve: {
    alias: {
      "psd-to-phaser": fileURLToPath(
        new URL("../vendor/psd-to-phaser/psd-to-phaser.es.js", import.meta.url),
      ),
      "@tauri-apps/api/core": stub("tauri-stub.ts"),
      "@tauri-apps/api/event": stub("event-stub.ts"),
      "@tauri-apps/plugin-dialog": stub("dialog-stub.ts"),
    },
  },
});
