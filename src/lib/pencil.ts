/**
 * The Apple Pencil's double tap on its barrel, as something the editor hears.
 *
 * There is no pointer event for it. The tap (a squeeze on a Pencil Pro) is
 * reported only to a `UIPencilInteraction`, so the iPad plugin attaches one
 * to the web view and emits `pencil-double-tap` — see
 * `src-tauri/tauri-plugin-ipad-chrome/ios/Sources/PencilTap.swift`. Ported
 * from hush, where it toggles the notebook's eraser; here it does the same for
 * whichever tool is in hand — see `editor/tool-routing.ts` and
 * `editor/plan-mode.ts`, which are the two listeners.
 *
 * One plugin listener for the whole session, fanned out here, because the
 * editor is rebuilt for every project and the plugin's listener is not. On
 * anything but an iPad nothing is registered at all: nowhere else has the
 * interaction to report from.
 */

import * as log from "./log";
import { isIpad } from "./window-chrome";

type Listener = () => void;

const listeners = new Set<Listener>();
let started = false;

/** Hear each double tap of the barrel. Returns the way to stop. */
export function onPencilDoubleTap(listener: Listener): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

/** What the plugin calls, and what the harness calls in its place. */
export function pencilDoubleTapped(): void {
  for (const listener of [...listeners]) listener();
}

function start(): void {
  if (started) return;
  started = true;
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__pencilDoubleTap = pencilDoubleTapped;
  }
  if (!("__TAURI_INTERNALS__" in window) || !isIpad(navigator)) return;
  void import("@tauri-apps/api/core")
    .then(({ addPluginListener }) =>
      addPluginListener("ipad-chrome", "pencil-double-tap", pencilDoubleTapped),
    )
    .catch((err) => log.warn("The Pencil's double tap is not reaching the editor:", err));
}
