/**
 * The ways something on the canvas becomes something else.
 *
 * A sketch to a PSD or to a boundary, a fill to a PSD, and a copy to a file
 * of its own. The work is `stroke-actions.ts`, `fill-actions.ts` and
 * `psd-actions.ts`; what is here is the shell's half of each — reading the
 * selection, checking it is the kind the conversion is about, and handing
 * over the scene it landed in.
 *
 * Four near-identical guards, which is what makes them worth one file: every
 * one of them is "what is selected, is it the right kind, is the canvas up".
 * They were four functions in the middle of the shell, between the panels
 * they are wired to and the mode switch they have nothing to do with.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { Selection } from "../lib/types";
import type { DrawingLayer } from "../drawing";
import type { WorldScene } from "../game/world-scene";
import { convertStrokesToPsd, convertStrokesToZone } from "./stroke-actions";
import { convertFillToPsd } from "./fill-actions";
import type { PsdFileActions } from "./psd-actions";

export interface ConversionDeps {
  projectId: string;
  store: DocStore;
  grid: Grid;
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  /** The round trip out to Photoshop and back, which owns detaching a copy. */
  file: PsdFileActions;
}

export interface Conversions {
  strokesToPsd: () => Promise<void>;
  strokesToZone: () => void;
  fillToPsd: () => Promise<void>;
  /** Give a referencing placement its own copy of the PSD behind `key`. */
  removeReference: (key: string) => Promise<void>;
}

export function createConversions(deps: ConversionDeps): Conversions {
  const selectionOf = (): Selection =>
    deps.scene()?.getSelection() ?? { kind: "none" };

  return {
    async strokesToPsd() {
      const selection = selectionOf();
      const drawing = deps.drawing();
      const scene = deps.scene();
      if (selection.kind !== "strokes" || !drawing || !scene) return;
      await convertStrokesToPsd(
        deps.projectId,
        deps.store,
        deps.grid,
        drawing,
        scene,
        selection,
      );
    },

    strokesToZone() {
      const selection = selectionOf();
      const drawing = deps.drawing();
      if (selection.kind !== "strokes" || !drawing) return;
      convertStrokesToZone(deps.store, drawing, selection);
      deps.scene()?.setSelection({ kind: "none" });
    },

    async fillToPsd() {
      const selection = selectionOf();
      const scene = deps.scene();
      if (selection.kind !== "fill" || !scene) return;
      await convertFillToPsd(deps.projectId, deps.store, deps.grid, scene, selection);
    },

    /**
     * The *selected* placement is the one that moves off the shared file, so
     * whichever of the two you were looking at is the one that becomes
     * independent — and everything else pointing at the original stays put.
     */
    async removeReference(key) {
      const selection = selectionOf();
      if (selection.kind !== "placement") return;
      await deps.file.detach(selection.layerId, selection.placementId, key);
    },
  };
}
