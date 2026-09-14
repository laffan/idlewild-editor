/**
 * The two ways into a pattern shape that are not the panel's own button.
 *
 * Making one used to be a *request*: press Add Shape, and the editor
 * remembered which layer had asked while you went and made a gesture
 * somewhere else. Two buttons set that request, two other buttons in two
 * other places consumed it, and nothing on the canvas said the editor was
 * waiting for anything. Mask mode replaced the whole arrangement — see
 * `game/mask-mode.ts` — and with it the held request, which is why this file
 * is a quarter of what it was.
 *
 * What is left is the two shortcuts, and they are shortcuts in the strict
 * sense: both start from something the user has *already* described, so
 * making them walk into the mode and sweep it again would be asking twice.
 *
 * - **A run of grid spaces**, from the floating action bar over a region.
 *   It seeds the mode rather than writing a shape, so Cancel still leaves the
 *   layer alone and the spaces can be trimmed before they are committed.
 * - **A lassoed sketch**, from the sketch panel. This one writes, because the
 *   outline is the point: a shape made from a drawn line keeps that line
 *   beside its spaces so the canvas can draw what somebody actually drew, and
 *   handing it to a mode that sweeps rectangles would throw the line away on
 *   the first touch.
 */

import type { DocStore } from "../lib/doc-store";
import { cellsInRange, type Grid } from "../lib/grid";
import { layerKind } from "../lib/layer-kinds";
import * as log from "../lib/log";
import type { Cell, Selection } from "../lib/types";
import type { DrawingLayer } from "../drawing";
import { convertStrokesToPatternShape } from "./stroke-actions";

export interface PatternShapeDeps {
  store: DocStore;
  grid: Grid;
  drawing: () => DrawingLayer | null;
  getSelection: () => Selection;
  /** The layer the rail is pointed at, when the selection names none. */
  activeLayerId: () => string;
  /** Open the mask editor — on a new shape when `shapeId` is null. */
  openMask: (
    layerId: string,
    shapeId: string | null,
    seed?: readonly Cell[],
  ) => void;
}

export interface PatternShapes {
  /**
   * The pattern layer a lassoed sketch would become a shape on, or null.
   *
   * The layer the ink is *on*, which is the only reading that needs nothing
   * remembered: draw the outline on the pattern layer, sweep it up with the
   * lasso, and the button says which layer it is about because there is only
   * one layer involved.
   */
  strokeTarget: () => string | null;
  /** Take the selected patch of grid into a new shape, and open it. */
  fromSelection: () => void;
  /** Take the lassoed outline as a shape on the layer the ink is on. */
  fromStrokes: () => void;
}

export function createPatternShapes(deps: PatternShapeDeps): PatternShapes {
  function strokeTarget(): string | null {
    const selection = deps.getSelection();
    if (selection.kind !== "strokes") return null;
    const layer = deps.store.layer(selection.layerId);
    return layer && layerKind(layer) === "pattern" ? layer.id : null;
  }

  return {
    strokeTarget,

    /**
     * Every space in the selected range, as a shape being made.
     *
     * The spaces rather than the outline around them: what a pattern asks of
     * a shape is whether a space is inside it, and a run of spaces is that
     * answer already — see `insideShapes`.
     */
    fromSelection() {
      const selection = deps.getSelection();
      if (selection.kind !== "region") return;
      const layerId = deps.activeLayerId();
      const layer = deps.store.layer(layerId);
      if (!layer || layerKind(layer) !== "pattern") {
        log.warn("Pattern Shape needs a pattern layer to confine");
        return;
      }
      deps.openMask(layerId, null, [...cellsInRange(selection.from, selection.to)]);
    },

    fromStrokes() {
      const selection = deps.getSelection();
      const drawing = deps.drawing();
      const layerId = strokeTarget();
      if (selection.kind !== "strokes" || !drawing || !layerId) return;
      convertStrokesToPatternShape(
        deps.store,
        deps.grid,
        drawing,
        selection,
        layerId,
      );
    },
  };
}
