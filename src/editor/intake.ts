/**
 * Everything that arrives from outside the editor, and the one thing that
 * leaves.
 *
 * A paste and a drop are the same import wearing different clothes — bytes
 * become a marked PSD, psd-to-json runs over it, a placement is anchored on a
 * grid space — so they are wired in one place and share the target they land
 * on. What differs is only how the file got here and where it lands: a paste
 * has no pointer behind it and goes to the middle of the view, a drop goes
 * where it was let go of, and a drop onto something already there is an offer
 * to replace it.
 *
 * **⌘C is here because ⌘V is.** Copying the selected PSD is the other end of
 * the same gesture, and it made the paste path worth having twice over: a file
 * could be carried *into* a project and never out of one, so PSDs only ever
 * travelled in one direction. The keystroke and the menu item both come through
 * here for the same reason the two paste routes do — one answer to *what is
 * selected* and one answer to *what goes on the pasteboard*, rather than two
 * that have to agree.
 *
 * The scene is read through a getter rather than held, because the editor
 * wires this before Phaser has booted — and because the shell outlives any
 * one scene.
 */

import { selectedPlacement } from "../game/adjusting";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import * as log from "../lib/log";
import { isMobile } from "../lib/platform";
import type { WorldScene } from "../game/world-scene";
import { copyPsdToClipboard } from "./clipboard";
import {
  listenForCopyShortcut,
  listenForPaste,
  listenForPasteShortcut,
} from "./paste";
import {
  importPasted,
  pasteFromClipboard,
  type PasteTarget,
} from "./paste-actions";
import { listenForDrop } from "./drop";

export interface IntakeConfig {
  projectId: string;
  grid: Grid;
  /** The document, which is where a selection's PSD key is read from. */
  store: DocStore;
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
  /** *Copy PSD* in the menu — the same, for the half ⌘C does. */
  copy: () => void;
  stop: () => void;
}

/**
 * The canvas as something arriving from outside lands on it.
 *
 * Exported because Import Assets brings files in through a sheet rather than
 * through a gesture, and lands them the same way a paste does. It is the same
 * three answers either way — where the middle of the view is, what the grid is,
 * and how to place — so there is one of them rather than two that have to agree.
 */
export function pasteTargetFor(
  grid: Grid,
  scene: WorldScene | null,
): PasteTarget | null {
  if (!scene) return null;
  return {
    grid,
    centreCell: () => scene.centreCell(),
    // A paste has nothing to consume, so whether anything landed is
    // already in the console rather than something to act on here.
    placePsd: async (key, manifest, at, scale) => {
      await scene.placePsd(key, manifest, at, scale);
    },
  };
}

export function startIntake(config: IntakeConfig): Intake {
  const target = (): PasteTarget | null =>
    pasteTargetFor(config.grid, config.scene());

  /** Go and ask the clipboard for an image, and import whatever it hands over. */
  const paste = (): void => {
    const into = target();
    if (into) void pasteFromClipboard(config.projectId, into);
  };

  /** The PSD behind what is selected, if what is selected is a placed one. */
  const selectedPsd = (): string | null => {
    const selection = config.scene()?.getSelection();
    if (selection?.kind !== "placement") return null;
    return selectedPlacement(config.store, selection)?.psdKey ?? null;
  };

  /**
   * Put the selected PSD on the clipboard, and say whether anything went.
   *
   * The answer is what ⌘C reads to decide whether to consume the keystroke —
   * see `listenForCopyShortcut`. The menu item ignores it and says so in the
   * console instead, because there the press was a request rather than a
   * shortcut that may have been meant for something else.
   */
  const copy = (announce: boolean): boolean => {
    if (!config.enabled()) {
      // The menu is reachable in Code and Play, where the canvas is behind a
      // running game and nothing on it can be selected.
      if (announce) log.warn("Copy PSD works on the canvas — go back to Draw");
      return false;
    }
    const key = selectedPsd();
    if (!key) {
      if (announce) log.warn("Select a placed PSD to copy it");
      return false;
    }
    void copyPsdToClipboard(config.projectId, key)
      .then(() => log.info(`Copied ${key}.psd — ⌘V puts it in another project`))
      .catch((err) => log.error(`Could not copy ${key}.psd:`, err));
    return true;
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

  // ⌘C, on every platform. There is no `copy` event to take instead: the
  // browser fires one for a *selection*, and a placed PSD is not one — so the
  // keystroke is the only signal either platform gives, and the shell is what
  // writes the pasteboard. See `paste.ts`.
  const stopCopy = listenForCopyShortcut({
    enabled: config.enabled,
    onCopy: () => copy(false),
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
    paste,
    copy: () => void copy(true),
    stop: () => {
      stopPaste();
      stopShortcut();
      stopCopy();
      stopDrop();
    },
  };
}
