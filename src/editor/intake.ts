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
import * as log from "../lib/log";
import { isMobile } from "../lib/platform";
import type { WorldScene } from "../game/world-scene";
import { listenForPaste, listenForPasteShortcut } from "./paste";
import {
  importPasted,
  pasteFromClipboard,
  type PasteTarget,
} from "./paste-actions";
import { listenForDrop } from "./drop";

export interface IntakeConfig {
  projectId: string;
  grid: Grid;
  /** Which platform this is, since ⌘V means different things on each. */
  os: string;
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
      // A paste has nothing to consume, so whether anything landed is
      // already in the console rather than something to act on here.
      placePsd: async (key, manifest, at, scale) => {
        await scene.placePsd(key, manifest, at, scale);
      },
    };
  };

  /** Go and ask the clipboard for an image, and import whatever it hands over. */
  const paste = (): void => {
    const into = target();
    if (into) void pasteFromClipboard(config.projectId, into);
  };

  // Bound to the document rather than the canvas, which never holds focus:
  // every pointer handler over it calls preventDefault, so nothing in the
  // scene is ever the focused element.
  const stopPaste = listenForPaste({
    enabled: config.enabled,
    onImage: (name, file) => {
      const into = target();
      if (into) void importPasted(config.projectId, into, name, file);
    },
  });

  // ⌘V over the canvas produces no paste event on iPadOS — WKWebView only
  // runs the Paste command against an editable element — so there the
  // keystroke itself is the signal, and it asks for the clipboard the way the
  // menu item does. A Mac has the event, which carries the file with it, and
  // binding both would import the same image twice.
  const stopShortcut = isMobile(config.os)
    ? listenForPasteShortcut({
        enabled: config.enabled,
        onPaste: () => {
          // Said out loud because the next thing on an iPad is the system's
          // own paste prompt: if that is declined, or never appears, this
          // line is what says the keystroke was heard at all.
          log.info("⌘V — reading the clipboard");
          paste();
        },
      })
    : () => {};

  const stopDrop = listenForDrop(config.projectId, config.canvas, {
    enabled: () => config.enabled() && !!config.scene(),
    paste: target,
    cellAt: (x, y) => config.scene()?.cellAt(x, y) ?? null,
    placedAt: (x, y) => config.scene()?.placedAt(x, y) ?? null,
    markDrop: (placed) => config.scene()?.markDrop(placed),
    reloadPsd: (key, manifest) => config.onPsdReplaced(key, manifest),
  });

  return {
    paste,
    stop: () => {
      stopPaste();
      stopShortcut();
      stopDrop();
    },
  };
}
