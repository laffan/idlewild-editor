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
import { canErase, toolName, type ToolRail } from "./tool-rail";

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
  /**
   * Turn a tool round, or back.
   *
   * **Per tool, and remembered.** Erasing is a property of the tool rather
   * than of the session: a Pattern brush left set to erase is still an eraser
   * when you come back to it, exactly as its size and its pattern are still
   * what you left them. One flag on the style would have made it a property
   * of the *pen*, so picking up the Pencil to draw a line would have found it
   * rubbing one out.
   */
  setErasing: (tool: ToolId, on: boolean) => void;
  /** Whether a tool is currently turned round. */
  isErasing: (tool: ToolId) => boolean;
  /**
   * A tool held down rather than tapped: pick it up, and turn it round.
   *
   * The second way into erase mode, the first being the switch at the top of
   * the tool's own panel. A toggle, so the way out is the way in — and it
   * picks the tool up without announcing it, because the line that matters is
   * the one `setErasing` prints.
   */
  hold: (tool: ToolId) => void;
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
  eraser: "Slice — drag across a stroke to cut it in two where the blade passes",
  lasso: "Lasso — sweep around strokes to select them",
  fill: "Fill — sweep a closed shape, or tap its corners out",
  rub: "Rub — the pencil with the paint taken out",
};

/**
 * Which tools have a size worth remembering separately.
 *
 * The pencil is a nib and the Pattern brush is an *opening* onto a filled
 * area, so their natural sizes are an order apart: six pixels of pencil is a
 * line, and six pixels of Pattern brush is a checkered thread. Sharing one
 * number meant picking the other tool up and re-aiming it every single time.
 */
const SIZED: readonly ToolId[] = ["pencil", "pattern"];

export function createToolRouting(host: ToolRoutingHost): ToolRouting {
  /** What each of those was last set to. Pattern starts wide, on purpose. */
  const sizes: Partial<Record<ToolId, number>> = { pattern: 28 };
  /** Which tools are turned round. See `ToolRouting.setErasing`. */
  const erasing = new Set<ToolId>();

  /**
   * The stroke mode and the paint a tool draws with.
   *
   * The three painting tools each say what their paint has to be: Pattern is
   * a pattern, Shape is a shape, and the plain pencil is a colour. Fill is
   * deliberately left alone, because Fill is the tool whose whole point is
   * that it can be any of the three. Rub is the pencil, and what makes it an
   * eraser is the flag `apply` writes rather than anything here.
   *
   * A tool that changes the kind keeps whatever row was last chosen for it —
   * that is the library's business, not this file's, so what goes out is only
   * the kind and `paint-picker.ts` fills the rest in.
   */
  function styleFor(tool: ToolId, style: StrokeStyle): Partial<StrokeStyle> | null {
    // Rub is the pencil with erasing already on, rather than a mode of its
    // own. The stroke mode "erase" is legacy — see `lib/types.ts` — and
    // leaving Rub on it would have made it the one eraser in the editor that
    // behaved differently from the other four.
    if (tool === "pencil" || tool === "rub") {
      return { mode: "ink", paint: { ...style.paint, kind: "color" } };
    }
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
    // Read before the rail is told, because it is what the rail is showing
    // now that says which tool is being put down.
    const previous = host.rail.tool;
    host.rail.setTool(tool);

    if (drawing) {
      if (previous !== tool && SIZED.includes(previous)) {
        sizes[previous] = drawing.style.size;
      }
      const patch = styleFor(tool, drawing.style);
      const size = SIZED.includes(tool) ? sizes[tool] : undefined;
      // Always written, not only when the tool has a patch: picking the Fill
      // tool up after erasing with the Pencil has to *stop* erasing, and a
      // flag left behind from the last tool is how that goes wrong. Rub is
      // the one tool that is an eraser and nothing else.
      const erase = tool === "rub" || erasing.has(tool);
      drawing.style = {
        ...drawing.style,
        ...(patch ?? {}),
        ...(size === undefined ? {} : { size }),
        erase,
      };
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
    if (erasing.has(tool)) log.info(`${toolName(tool)} is set to erase`);
  }

  function setErasing(tool: ToolId, on: boolean): void {
    if (!canErase(tool)) return;
    if (on) erasing.add(tool);
    else erasing.delete(tool);
    host.rail.setErasing(new Set(erasing));
    const drawing = host.drawing();
    if (drawing && host.rail.tool === tool) {
      drawing.style = { ...drawing.style, erase: on };
      // The panel's first row is this switch, so it has to be rebuilt — and
      // `updateStrokeStyle` deliberately does not rebuild. See `Inspector`.
      host.inspector.setTool(tool, drawing.style);
    }
    log.info(
      on
        ? `${toolName(tool)} is set to erase — it takes out what it would draw`
        : `${toolName(tool)} draws again`,
    );
  }

  return {
    apply,
    setErasing,
    isErasing: (tool) => erasing.has(tool),
    hold: (tool) => {
      apply(tool, false);
      setErasing(tool, !erasing.has(tool));
    },
  };
}
