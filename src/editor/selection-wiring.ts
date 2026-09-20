/**
 * What the things that act on a whole selection are handed.
 *
 * Four of them — delete, group, merge and extract — and they want overlapping
 * halves of the same short list: the document, what is selected, a way to say
 * what is selected instead, and the panels that have to be redrawn once it
 * has changed. They were three object literals in a row in `openEditor`,
 * assembled there only because that is where the pieces happened to be in
 * scope, and `editor.ts` is against the 700-line rule.
 *
 * One host in, three records out. The host is narrow on purpose: nothing here
 * knows what a scene is beyond the four questions it asks one, which is what
 * lets the whole set be built before the canvas has booted — every field that
 * reaches the scene goes through a closure the shell owns.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { DrawingLayer } from "../drawing";
import type { WorldScene } from "../game/world-scene";
import type { Selection } from "../lib/types";
import type { DeleteWiring } from "./layer-actions";
import type { MergeDeps } from "./merge-actions";
import type { ExtractDeps } from "./extract-actions";

export interface SelectionWiringHost {
  projectId: string;
  store: DocStore;
  grid: Grid;
  /** Read through: neither is up when this is built. */
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  /** Make this the layer new work lands on. */
  setActiveLayer: (layerId: string) => void;
  /** Redraw the left panel: rows go, and one arrives. */
  redrawLayers: () => void;
  /** Fold the properties sidebar down to a just-written file's layer list. */
  revealPsdLayers: () => void;
  /**
   * A source file has been rewritten and the canvas has to be put back in
   * step with it — `PsdFileActions.applyLayers`, which an extraction needs
   * and a merge does not, because a merge leaves its sources alone.
   */
  applyLayers: (key: string, manifest: string) => Promise<void>;
}

export interface SelectionWiring {
  /** Deleting it — `layer-actions.ts`, beside the sheet it puts up. */
  selected: DeleteWiring;
  /** One file out of several — `merge-actions.ts`. */
  merging: MergeDeps;
  /** The same, one level in: layers rather than files — `extract-actions.ts`. */
  extracting: ExtractDeps;
}

export function selectionWiring(host: SelectionWiringHost): SelectionWiring {
  const selection = (): Selection | null => host.scene()?.getSelection() ?? null;

  const selected: DeleteWiring = {
    store: host.store,
    selection,
    setSelection: (next) => host.scene()?.setSelection(next),
    setActiveLayer: host.setActiveLayer,
    redrawLayers: host.redrawLayers,
    removeSelectedPlacement: () => host.scene()?.removeSelectedPlacement(),
    removeStrokes: (ids) => host.drawing()?.removeStrokes(ids),
    clearSelection: () => host.scene()?.setSelection({ kind: "none" }),
  };

  const merging: MergeDeps = {
    projectId: host.projectId,
    store: host.store,
    grid: host.grid,
    scene: host.scene,
    selection,
    redrawLayers: host.redrawLayers,
    focusLayer: host.setActiveLayer,
    onMerged: host.revealPsdLayers,
  };

  return {
    selected,
    merging,
    extracting: { ...merging, onSourceRewritten: host.applyLayers },
  };
}
