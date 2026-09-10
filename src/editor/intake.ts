/**
 * Everything that arrives from outside the editor.
 *
 * A paste and a drop are the same import wearing different clothes — bytes
 * become a marked PSD, psd-to-json runs over it, a placement is anchored on a
 * grid space — so they are wired in one place and share the target they land
 * on. What differs is only how the file got here and where it lands: a paste
 * has no pointer behind it and goes to the middle of the view, a drop goes
 * where it was let go of, and a drop onto something already there is an offer
 * to replace it.
 *
 * The scene is read through a getter rather than held, because the editor
 * wires this before Phaser has booted — and because the shell outlives any
 * one scene.
 */

import type { Grid } from "../lib/grid";
import type { WorldScene } from "../game/world-scene";
import { listenForPaste } from "./paste";
import {
  importPasted,
  pasteFromClipboard,
  type PasteTarget,
} from "./paste-actions";
import { listenForDrop } from "./drop";

export interface IntakeConfig {
  projectId: string;
  grid: Grid;
  /** The canvas area. A drop anywhere else is not a drop on the game. */
  canvas: HTMLElement;
  /** The live scene, or null before it has booted. */
  scene: () => WorldScene | null;
  /** Whether anything should be taken at all — false in play mode. */
  enabled: () => boolean;
  /**
   * A dropped file has replaced the one behind a key. The scene reloads it,
   * and so does the inspector's list of its layers — the file on disk has
   * changed and that list is built once and kept.
   */
  onPsdReplaced: (key: string, manifest: string) => Promise<void>;
}

export interface Intake {
  /** *Paste Image* in the header menu — the route with no ⌘V behind it. */
  paste: () => void;
  stop: () => void;
}

export function startIntake(config: IntakeConfig): Intake {
  const target = (): PasteTarget | null => {
    const scene = config.scene();
    if (!scene) return null;
    return {
      grid: config.grid,
      centreCell: () => scene.centreCell(),
      placePsd: (key, manifest, at, scale) =>
        scene.placePsd(key, manifest, at, scale),
    };
  };

  // Bound to the document rather than the canvas, which never holds focus:
  // every pointer handler over it calls preventDefault, so nothing in the
  // scene is ever the focused element.
  const stopPaste = listenForPaste({
    enabled: config.enabled,
    onImage: (name, file) => {
      const paste = target();
      if (paste) void importPasted(config.projectId, paste, name, file);
    },
  });

  const stopDrop = listenForDrop(config.projectId, config.canvas, {
    enabled: () => config.enabled() && !!config.scene(),
    paste: target,
    cellAt: (x, y) => config.scene()?.cellAt(x, y) ?? null,
    placedAt: (x, y) => config.scene()?.placedAt(x, y) ?? null,
    markDrop: (placed) => config.scene()?.markDrop(placed),
    reloadPsd: (key, manifest) => config.onPsdReplaced(key, manifest),
  });

  return {
    paste: () => {
      const paste = target();
      if (paste) void pasteFromClipboard(config.projectId, paste);
    },
    stop: () => {
      stopPaste();
      stopDrop();
    },
  };
}
