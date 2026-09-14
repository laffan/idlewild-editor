/**
 * What a tool means to the pointer.
 *
 * Nine tools on three bars and one more on PSD Edit mode's bar, and picking
 * any of them answers the same short list of questions again: who gets the
 * raw input — the drawing layer, or the game canvas and its gesture arbiter —
 * what a drag on empty space does, what the cursor over the canvas is, and
 * what the inspector should be describing.
 *
 * Split out of `editor.ts` because it is the one part of the shell that is
 * about the *pointer* rather than about the document.
 *
 * **Two of them are the pencil wearing a tool's clothes.** Pixels is the
 * pencil with a hard checker for a tip and Rub is the pencil with the paint
 * taken out, so both come down to a brush and a stroke mode rather than to a
 * gesture of their own. Saying so in one place is what lets them be buttons
 * like any other: Pixels has to remember the brush it borrowed the slot from,
 * and going back to the plain pencil has to give it back.
 */

import { DEFAULT_STYLE, PIXEL_BRUSH, type DrawingLayer } from "../drawing";
import type { StrokeStyle } from "../drawing";
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
const DRAWN: Partial<Record<ToolId, "pencil" | "eraser" | "lasso" | "fill" | "zone">> =
  {
    pencil: "pencil",
    // The pencil, drawn differently. Both are a brush and a stroke mode; see
    // `styleFor` for the half that is not the gesture.
    pixels: "pencil",
    rub: "pencil",
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
  pixels: "Pixels — the pencil with a hard pixel pattern for a tip",
  eraser: "Eraser — drag across a stroke to cut it where the disc passes",
  lasso: "Lasso — sweep around strokes to select them",
  fill: "Fill — sweep a closed shape, or tap its corners out",
  rub: "Rub — the pencil with the paint taken out",
};

export function createToolRouting(host: ToolRoutingHost): ToolRouting {
  /** The brush the pencil had before Pixels borrowed the slot. */
  let remembered = DEFAULT_STYLE.brushId;

  /**
   * The brush and the stroke mode a tool draws with.
   *
   * Only three tools change either, and the plain pencil is one of them: it
   * is what gives the borrowed brush slot back. Fill and Lasso are left alone
   * deliberately — a swept shape takes the drawing colour and no tip at all,
   * so a stale `brushId` on the style does nothing to it.
   */
  function styleFor(tool: ToolId): Partial<StrokeStyle> | null {
    if (tool === "pixels") return { mode: "ink", brushId: PIXEL_BRUSH };
    if (tool === "rub") return { mode: "erase", brushId: remembered };
    if (tool === "pencil") return { mode: "ink", brushId: remembered };
    return null;
  }

  function apply(tool: ToolId, announce = true): void {
    const drawing = host.drawing();
    host.rail.setTool(tool);

    if (drawing) {
      // Remembered before the swap, and only when there is something to
      // remember: picking Pixels twice must not leave the checker as the
      // brush the pencil goes back to.
      if (tool === "pixels" && drawing.style.brushId !== PIXEL_BRUSH) {
        remembered = drawing.style.brushId;
      }
      const patch = styleFor(tool);
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
