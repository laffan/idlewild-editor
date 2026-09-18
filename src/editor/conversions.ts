/**
 * The ways something on the canvas becomes something else.
 *
 * A sketch to a PSD or to a boundary, a fill to a PSD, a word to a PSD, and a
 * copy to a file of its own. The work is `stroke-actions.ts`,
 * `fill-actions.ts`, `text-actions.ts` and `psd-actions.ts`; what is here is
 * the shell's half of each — reading the selection, checking it is the kind
 * the conversion is about, and handing over the scene it landed in.
 *
 * Five near-identical guards, which is what makes them worth one file: every
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
import { convertTextToPsd } from "./text-actions";
import type { PsdFileActions } from "./psd-actions";

export interface ConversionDeps {
  projectId: string;
  store: DocStore;
  grid: Grid;
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  /** The round trip out to Photoshop and back, which owns making one unique. */
  file: PsdFileActions;
}

export interface Conversions {
  strokesToPsd: () => Promise<void>;
  strokesToZone: () => void;
  fillToPsd: () => Promise<void>;
  /** A word on the canvas, as pixels — `text-actions.ts` says why. */
  textToPsd: () => Promise<void>;
  /**
   * Give this placed PSD a copy of the file behind `key`, so editing it stops
   * changing the other instances of it — **Make Unique**.
   */
  makeUnique: (key: string) => Promise<void>;
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

    async textToPsd() {
      const selection = selectionOf();
      const scene = deps.scene();
      if (selection.kind !== "text" || !scene) return;
      await convertTextToPsd(deps.projectId, deps.store, deps.grid, scene, selection);
    },

    /**
     * The *selected* object is the one that moves off the shared file, so
     * whichever instance you were looking at is the one that becomes its own —
     * and every other instance goes on reading the original.
     *
     * `detach` works on the whole unit the selected placement belongs to, not
     * on that one placement: a PSD with a wall and a roof in it stands on the
     * grid as two placements, and moving one of them to the copy left the other
     * reading the original — which is what made Make Unique look like it had
     * done nothing.
     */
    async makeUnique(key) {
      const selection = selectionOf();
      if (selection.kind !== "placement") return;
      await deps.file.detach(selection.layerId, selection.placementId, key);
    },
  };
}
