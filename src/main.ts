/**
 * Idlewild — a Tauri + Phaser game editor built around psd-to-phaser.
 *
 * Two screens: the project list, and the editor. Everything else is a panel,
 * a sheet or the game canvas itself.
 */

import { renderHome } from "./home/home";
import { mountEditor } from "./editor/editor";
import { suppressPageZoom } from "./lib/gestures";
import * as log from "./lib/log";
import type { ProjectMeta } from "./lib/types";

const app = document.getElementById("app");
if (!app) throw new Error("#app is missing from index.html");

let teardownEditor: (() => Promise<void>) | null = null;

async function showHome(): Promise<void> {
  if (teardownEditor) {
    await teardownEditor();
    teardownEditor = null;
  }
  renderHome(app!, {
    onOpenProject: (meta) => void showEditor(meta),
  });
}

async function showEditor(meta: ProjectMeta): Promise<void> {
  try {
    teardownEditor = await mountEditor(app!, meta, {
      onBack: () => showHome(),
    });
  } catch (err) {
    log.error("Could not open the project:", err);
    await showHome();
  }
}

log.captureConsole();
suppressPageZoom();
void showHome();
