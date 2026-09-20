/**
 * What the scene hands `PsdPlacements`, assembled in one place.
 *
 * The same seam `scene-gestures.ts` is: the scene owns the pieces, this owns
 * the *shape* they are handed over in, and `world-scene.ts`'s `create` is
 * shorter by the length of an object literal it was only holding because
 * that is where the pieces happened to be in scope.
 *
 * The one part of it that is an argument rather than plumbing is
 * `releaseKey` / `restoreKey`. A PSD's textures are evicted and reloaded
 * whenever the file is rewritten, and a Phaser object still drawing against
 * a texture that has gone throws inside the renderer on every frame from
 * then on — so *everything* holding an object made from that file has to let
 * go first and be told to build again afterwards. The document renderer goes
 * through its own path; what is left is the renderers that make objects the
 * document has no record of, which is what `derived` is. A renderer added
 * later that draws from a PSD joins that list, and that is the whole of what
 * it has to do.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { Selection } from "../lib/types";
import type { DocRenderer } from "./doc-renderer";
import type { PsdHost } from "./psd-placements";

/**
 * A renderer that makes Phaser objects out of a PSD the document has no
 * record of — a pattern layer's copies, a tile layer's tiles.
 */
export interface DerivedRenderer {
  dropKey(psdKey: string): void;
  restoreKey(psdKey: string): void;
}

export interface PsdHostParts {
  scene: Phaser.Scene;
  store: DocStore;
  grid: Grid;
  docRenderer: DocRenderer;
  assetBase: string;
  /**
   * The layer new work lands on, read through rather than captured: it
   * changes as the user works, and a PSD is placed on whichever one is
   * current when it arrives.
   */
  activeLayerId: () => string;
  setSelection: (selection: Selection) => void;
  reselect: () => void;
  refresh: () => void;
  onPsdsLoaded?: () => void;
  /** Read through too: these are built alongside the host that names them. */
  derived: () => readonly DerivedRenderer[];
}

export function psdHost(parts: PsdHostParts): PsdHost {
  return {
    scene: parts.scene,
    store: parts.store,
    grid: parts.grid,
    docRenderer: parts.docRenderer,
    assetBase: parts.assetBase,
    get activeLayerId() {
      return parts.activeLayerId();
    },
    setSelection: parts.setSelection,
    reselect: parts.reselect,
    refresh: parts.refresh,
    onPsdsLoaded: parts.onPsdsLoaded,
    releaseKey: (key) => {
      for (const renderer of parts.derived()) renderer.dropKey(key);
    },
    restoreKey: (key) => {
      for (const renderer of parts.derived()) renderer.restoreKey(key);
    },
  };
}
