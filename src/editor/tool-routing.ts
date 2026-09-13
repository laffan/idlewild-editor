/**
 * What a tool means to the pointer.
 *
 * Five tools are on the rail and three more belong to pen mode, and picking
 * any of them answers the same short list of questions again: who gets the
 * raw input — the drawing layer, or the game canvas and its gesture arbiter —
 * what a drag on empty space does, what the cursor over the canvas is, and
 * what the inspector should be describing.
 *
 * Split out of `editor.ts` because it is the one part of the shell that is
 * about the *pointer* rather than about the document. The pen rail's three
 * are here too, for the reason they are a special case at all: they are a
 * brush swap wearing a tool's clothes, so Pixels has to remember the brush it
 * borrowed from and the plain pencil has to give it back.
 */

import { DEFAULT_STYLE, PIXEL_BRUSH, type DrawingLayer } from "../drawing";
import * as log from "../lib/log";
import type { ToolId } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import type { Inspector } from "./inspector";
import type { ToolRail } from "./tool-rail";
import { penToolEffect, type PenTool } from "./pen-rail";

export interface ToolRoutingHost {
  rail: ToolRail;
  /** The canvas wrapper, which carries the cursor for whatever is in hand. */
  canvas: HTMLElement;
  /** Read through, not captured: neither is up when this is built. */
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  inspector: Inspector;
}

export interface ToolRouting {
  /**
   * Put a tool in the pointer's hands.
   *
   * Called by the rail and by the space bar, which borrows Pan for as long as
   * it is held. `rail.setTool` is what the space bar needs from it: the rail
   * has to show what the pointer is actually doing, or holding space looks
   * like nothing happened.
   */
  apply: (tool: ToolId, announce?: boolean) => void;
  /** Put one of pen mode's own three in the pointer's hands, or take it back. */
  applyPen: (tool: PenTool) => void;
}

export function createToolRouting(host: ToolRoutingHost): ToolRouting {
  /** The brush the pencil had before the pen rail's Pixels borrowed it. */
  let remembered = DEFAULT_STYLE.brushId;

  function apply(tool: ToolId, announce = true): void {
    const drawing = host.drawing();
    host.rail.setTool(tool);
    const drawingTool =
      tool === "pencil" || tool === "eraser" || tool === "lasso" || tool === "fill"
        ? tool
        : null;
    const scene = host.scene();
    scene?.suspendGestures(drawingTool !== null);
    scene?.setGestureMode(
      tool === "pan" ? "pan" : tool === "point" ? "point" : "select",
    );
    // A hand over the canvas, whether Pan was picked from the rail or
    // borrowed with the space bar. The class carries it rather than an inline
    // style so the drawing layer's own crosshair still wins where it is up.
    host.canvas.classList.toggle("panning", tool === "pan");
    host.canvas.classList.toggle("placing", tool === "point");
    drawing?.setTool(drawingTool);
    host.inspector.setDrawingTool(drawingTool, drawing?.style ?? null);
    if (!announce) return;
    if (tool === "select") log.info("Select — drag a box around what you want");
    if (tool === "pan") log.info("Pan tool: drag to move the camera");
    if (tool === "point") log.info("Point — tap to put one down; drag still pans");
    if (tool === "pencil") log.info("Pencil — draw with a pencil or a mouse; fingers pan");
    if (tool === "lasso") log.info("Lasso — sweep around strokes to select them");
    if (tool === "fill") log.info("Fill — sweep a closed shape and it fills");
  }

  function applyPen(tool: PenTool): void {
    const drawing = host.drawing();
    if (!drawing) return;
    if (tool === "pixels" && drawing.style.brushId !== PIXEL_BRUSH) {
      remembered = drawing.style.brushId;
    }
    const effect = penToolEffect(tool, remembered);
    drawing.style = { ...drawing.style, ...effect.style };
    apply(effect.tool, false);
    host.inspector.updateStrokeStyle(drawing.style);
  }

  return { apply, applyPen };
}
