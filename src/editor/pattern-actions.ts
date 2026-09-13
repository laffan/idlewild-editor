/**
 * Add Shape, both ways round.
 *
 * A pattern is infinite until somebody says where it is allowed to be, and
 * saying so is a gesture rather than a control: a patch of grid asked for
 * with the long-press selection every other part of this editor asks space
 * with, or an outline drawn with the pencil. Neither is instant, so the
 * request is held here — which layer asked — and cleared the moment an answer
 * arrives.
 *
 * That held request is also what decides whether the two *finishing* buttons
 * are offered at all: Pattern Shape over a grid selection, and Convert to
 * pattern shape beside a lassoed sketch. Neither appears until something has
 * asked for a shape, because on a project with no pattern layer they would be
 * buttons with nowhere to put their answer.
 */

import type { DocStore } from "../lib/doc-store";
import { cellsInRange, type Grid } from "../lib/grid";
import { addPatternShapeCells, layerKind } from "../lib/layer-kinds";
import * as log from "../lib/log";
import type { Selection, ToolId } from "../lib/types";
import type { DrawingLayer } from "../drawing";
import { convertStrokesToPatternShape } from "./stroke-actions";

export interface PatternShapeDeps {
  store: DocStore;
  grid: Grid;
  drawing: () => DrawingLayer | null;
  getSelection: () => Selection;
  setSelection: (selection: Selection) => void;
  /** The layer the rail is pointed at, when nothing has asked for a shape. */
  activeLayerId: () => string;
  useTool: (tool: ToolId) => void;
}

export interface PatternShapes {
  /** The layer waiting for a shape, or null. Read by both panels. */
  target: () => string | null;
  /** Ask for one from a grid selection, or by drawing it. */
  askFromSelection: (layerId: string) => void;
  askByDrawing: (layerId: string) => void;
  /** Stop waiting, leaving whatever has been drawn where it is. */
  cancel: () => void;
  /** Finish: take the selected patch of grid. */
  fromSelection: () => void;
  /** Finish: take the lassoed outline — the strokes panel's button. */
  fromStrokes: () => void;
  /** Finish: take everything drawn on the layer — the pattern panel's. */
  fromLayerStrokes: (layerId: string) => void;
}

export function createPatternShapes(deps: PatternShapeDeps): PatternShapes {
  let target: string | null = null;

  return {
    target: () => target,

    askFromSelection(layerId) {
      target = layerId;
      deps.useTool("select");
      log.info("Press and hold on the grid to select an area, then Pattern Shape.");
    },

    askByDrawing(layerId) {
      target = layerId;
      deps.useTool("pencil");
      // The selection stays on the layer, which is what keeps its panel — and
      // the Finish button that has just appeared in it — in front of the
      // person now holding a pencil.
      deps.setSelection({ kind: "layer", layerId });
      log.info("Draw the outline, then Finish shape in the inspector.");
    },

    cancel() {
      target = null;
    },

    /**
     * Everything drawn on the layer, as the outline.
     *
     * The finishing half of Add Shape — draw, and it does not go through the
     * lasso. Sweeping the ink is the right gesture for a sketch becoming a
     * boundary, where a layer may hold several and one of them is meant; it
     * is the wrong one here, because somebody who has just pressed Add Shape
     * and drawn an outline has already said which strokes they mean. It also
     * put the only way to finish in a panel they had no reason to open.
     */
    fromLayerStrokes(layerId) {
      const drawing = deps.drawing();
      const layer = deps.store.layer(layerId);
      if (!drawing || !layer) return;
      const ids = layer.strokes.map((stroke) => stroke.id);
      if (ids.length === 0) {
        log.warn("Nothing drawn yet — draw the outline first");
        return;
      }
      target = null;
      convertStrokesToPatternShape(
        deps.store,
        deps.grid,
        drawing,
        { kind: "strokes", layerId, ids },
        layerId,
      );
      deps.setSelection({ kind: "layer", layerId });
    },

    /**
     * Every space in the selected range.
     *
     * The spaces rather than the outline around them: what a pattern asks of
     * a shape is whether a space is inside it, and a run of spaces is that
     * answer already — see `insideShapes`.
     */
    fromSelection() {
      const selection = deps.getSelection();
      if (selection.kind !== "region") return;
      const layerId = target ?? deps.activeLayerId();
      const layer = deps.store.layer(layerId);
      if (!layer || layerKind(layer) !== "pattern") {
        log.warn("Pattern Shape needs a pattern layer to confine");
        return;
      }
      target = null;
      const cells = [...cellsInRange(selection.from, selection.to)];
      const shape = addPatternShapeCells(deps.store, layerId, cells);
      if (!shape) return;
      log.info(`${shape.name} — ${cells.length} spaces on ${layer.name}`);
      deps.setSelection({ kind: "layer", layerId });
    },

    /**
     * The lassoed outline, handed to whichever layer asked.
     *
     * The request is consumed either way. A conversion that is refused says
     * why in the console, and leaving the button up afterwards would make it
     * look as though nothing had been pressed.
     */
    fromStrokes() {
      const selection = deps.getSelection();
      const drawing = deps.drawing();
      const layerId = target;
      if (selection.kind !== "strokes" || !drawing || !layerId) return;
      target = null;
      convertStrokesToPatternShape(
        deps.store,
        deps.grid,
        drawing,
        selection,
        layerId,
      );
      deps.setSelection({ kind: "layer", layerId });
    },
  };
}
