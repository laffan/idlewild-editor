/**
 * What a tool means to the pointer.
 *
 * Ten tools on two columns and one more on PSD Edit mode's bar, and picking
 * any of them answers the same short list of questions again: who gets the
 * raw input — the drawing layer, or the game canvas and its gesture arbiter —
 * what a drag on empty space does, what the cursor over the canvas is, and
 * what the inspector should be describing.
 *
 * Split out of `editor.ts` because it is the one part of the shell that is
 * about the *pointer* rather than about the document.
 *
 * **Two of them are the pencil wearing a tool's clothes.** Pattern is the
 * pencil with a pattern for its paint and Rub is the pencil with the paint
 * taken out, so both come down to a stroke mode and a style rather than to a
 * gesture of their own.
 *
 * Pattern used to be *Pixels*, and it used to borrow the brush slot: the
 * checkered tip went in, the pencil's own brush was remembered, and picking
 * the pencil again gave it back. None of that is here now. What makes a
 * Pattern stroke a pattern is the paint on the style — the tip is not
 * involved at all, because the stroke is not stamped; see
 * `drawing/paint-render.ts`. Nothing is borrowed, so nothing has to be
 * given back.
 */

import type { DrawingLayer, DrawingTool, StrokeStyle } from "../drawing";
import { patternLibrary, shapeLibrary } from "../lib/library";
import * as log from "../lib/log";
import type { ToolId } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import type { Inspector } from "./inspector";
import type { ToolRail } from "./tool-rail";

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
   * Called by the bars and by the space bar, which borrows Pan for as long as
   * it is held. `rail.setTool` is what the space bar needs from it: the bars
   * have to show what the pointer is actually doing, or holding space looks
   * like nothing happened.
   */
  apply: (tool: ToolId, announce?: boolean) => void;
}

/** Which tools hand the raw pointer to the drawing layer, and as what. */
const DRAWN: Partial<Record<ToolId, DrawingTool>> = {
  pencil: "pencil",
  // The pencil, drawn differently. Both are a stroke mode and a style; see
  // `styleFor` for the half that is not the gesture.
  rub: "pencil",
  // Its own gesture in the layer, because what it records is a path that will
  // be read as lattice cells rather than stamped — and because the live
  // preview has to show the pattern rather than a tip.
  pattern: "pattern",
  shape: "shape",
  eraser: "eraser",
  lasso: "lasso",
  fill: "fill",
  zone: "zone",
};

/** What each of them says in the console when it is picked up. */
const ANNOUNCE: Partial<Record<ToolId, string>> = {
  select: "Select — drag a box around what you want",
  pan: "Pan tool: drag to move the camera",
  point: "Point — tap to put one down; drag still pans",
  zone: "Boundary — sweep an outline and it becomes a blocking zone",
  pencil: "Pencil — draw with a pencil or a mouse; fingers pan",
  pattern: "Pattern — sweep to reveal a pattern pinned to the world",
  shape: "Shape — every grid space you cross takes a copy of the shape",
  eraser: "Eraser — drag across a stroke to cut it where the disc passes",
  lasso: "Lasso — sweep around strokes to select them",
  fill: "Fill — sweep a closed shape, or tap its corners out",
  rub: "Rub — the pencil with the paint taken out",
};

export function createToolRouting(host: ToolRoutingHost): ToolRouting {
  /**
   * The stroke mode and the paint a tool draws with.
   *
   * Rub is the only one that changes the *mode* — it is the pencil
   * compositing `destination-out` — and the three painting tools each say
   * what their paint has to be: Pattern is a pattern, Shape is a shape, and
   * the plain pencil is a colour. Fill is deliberately left alone, because
   * Fill is the tool whose whole point is that it can be any of the three.
   *
   * A tool that changes the kind keeps whatever row was last chosen for it —
   * that is the library's business, not this file's, so what goes out is only
   * the kind and `paint-picker.ts` fills the rest in.
   */
  function styleFor(tool: ToolId, style: StrokeStyle): Partial<StrokeStyle> | null {
    if (tool === "rub") return { mode: "erase" };
    if (tool === "pencil") return { mode: "ink", paint: { ...style.paint, kind: "color" } };
    if (tool === "pattern") {
      return {
        mode: "ink",
        paint: {
          ...style.paint,
          kind: "pattern",
          patternId: style.paint.patternId ?? patternLibrary.selectedId ?? undefined,
        },
      };
    }
    if (tool === "shape") {
      return {
        mode: "shape",
        paint: {
          ...style.paint,
          kind: "shape",
          shapeId: style.paint.shapeId ?? shapeLibrary.selectedId ?? undefined,
        },
      };
    }
    return null;
  }

  function apply(tool: ToolId, announce = true): void {
    const drawing = host.drawing();
    host.rail.setTool(tool);

    if (drawing) {
      const patch = styleFor(tool, drawing.style);
      if (patch) drawing.style = { ...drawing.style, ...patch };
    }

    const drawingTool = DRAWN[tool] ?? null;
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
    host.inspector.setTool(tool, drawing?.style ?? null);
    if (!announce) return;
    const said = ANNOUNCE[tool];
    if (said) log.info(said);
  }

  return { apply };
}
