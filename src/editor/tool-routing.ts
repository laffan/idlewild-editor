/**
 * What a tool means to the pointer.
 *
 * Ten tools on two columns, and picking any of them answers the same short
 * list of questions again: who gets the raw input — the drawing layer, or the
 * game canvas and its gesture arbiter — what a drag on empty space does, what
 * the cursor over the canvas is, and what the inspector should be describing.
 *
 * Split out of `editor.ts` because it is the one part of the shell that is
 * about the *pointer* rather than about the document.
 *
 * There was an eleventh on PSD Edit mode's bar — Rub, the pencil with the
 * paint taken out — and it went once every brush could be turned round:
 * erasing is a flag on the style, so a tool that was only ever an eraser was
 * a second way of saying the same thing.
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
import type { LayerKind, ToolId } from "../lib/types";
import type { TileStamp } from "../lib/tile-layers";
import {
  DENSITY_DEFAULT,
  DENSITY_RANGE,
  type TileHand,
} from "../lib/tile-tools";
import type { WorldScene } from "../game/world-scene";
import type { Inspector } from "./inspector";
import {
  canErase,
  tileVerbOf,
  toolName,
  toolsFor,
  type ToolRail,
} from "./tool-rail";

export interface ToolRoutingHost {
  rail: ToolRail;
  /**
   * What kind of layer the work is landing on.
   *
   * Read through rather than pushed, because it changes for reasons this file
   * has no way to hear about — a row picked in the left sidebar, a selection
   * on the canvas, a scene switch. The shell re-applies the tool whenever it
   * moves; see `editor.ts`.
   */
  layerKind: () => LayerKind;
  /**
   * Whether a PSD is open in PSD Edit mode.
   *
   * The one thing that makes a tile layer offer the ink again: a file open
   * for drawing is ordinary artwork, and the layer underneath it happening to
   * hold tiles has nothing to do with what the pointer is for. Read through
   * like everything else here, because a session opens and closes without
   * this file hearing about it — `editor/psd-edit.ts` re-applies the tool at
   * both ends.
   */
  psdEditing: () => boolean;
  /** The canvas wrapper, which carries the cursor for whatever is in hand. */
  canvas: HTMLElement;
  /** Read through, not captured: neither is up when this is built. */
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  inspector: Inspector;
  /** The run picked in the palette — the sidebar's, so it is asked for. */
  tileStamp: () => TileStamp | null;
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
   * Everything the canvas needs to know about the tile tool in hand.
   *
   * Assembled here because this is where the answers already are: which tool
   * is held, which way round it is, and what its own option is set to. The
   * run picked in the palette comes in through the host, since that is the
   * sidebar's. A `verb` of null is every moment the work is not landing on a
   * tile layer, which is what keeps every other layer's gestures untouched.
   */
  tileHand: () => TileHand;
  /**
   * Whether a tile tool is set to its **random** half, and the way to set it.
   *
   * Per tool and remembered, for the reason erasing is: a Sweep left
   * scattering is still scattering when you come back to it, exactly as a
   * Pattern brush left turned round is still an eraser. One flag for both
   * would make picking up the Stamp find it doing whatever the Sweep was.
   */
  tileRandom: (tool: ToolId) => boolean;
  onTileRandom: (tool: ToolId, on: boolean) => void;
  /** How much of a swept area a scatter covers — Sweep's second option. */
  tileDensity: () => number;
  onTileDensity: (density: number) => void;
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
  text: "Text — tap to write on the canvas; a drag still pans",
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
  /** Which tile tools are on their random half, and how thick a scatter is. */
  const random = new Set<ToolId>();
  let density = DENSITY_DEFAULT;

  /**
   * The stroke mode and the paint a tool draws with.
   *
   * The three painting tools each say what their paint has to be: Pattern is
   * a pattern, Shape is a shape, and the plain pencil is a colour. Fill is
   * deliberately left alone, because Fill is the tool whose whole point is
   * that it can be any of the three.
   *
   * A tool that changes the kind keeps whatever row was last chosen for it —
   * that is the library's business, not this file's, so what goes out is only
   * the kind and `paint-picker.ts` fills the rest in.
   */
  function styleFor(tool: ToolId, style: StrokeStyle): Partial<StrokeStyle> | null {
    // Ink, whether or not this pencil is turned round: the stroke mode
    // "erase" is legacy — see `lib/types.ts` — and what makes a mark come out
    // instead of going on is the flag `apply` writes below.
    if (tool === "pencil") {
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

  function apply(wanted: ToolId, announce = true): void {
    // A tool this layer does not offer cannot stay in hand. Its button has
    // just gone, so nothing on screen would say what the pointer is doing —
    // and two of the three a tile layer withholds would go on handing the
    // drawing layer strokes onto a layer whose subject is a grid of tiles.
    // Select is what the canvas does when nothing else is chosen.
    const editing = host.psdEditing();
    const offered = toolsFor(host.layerKind(), editing);
    const tool = offered.includes(wanted) ? wanted : "select";
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
      // flag left behind from the last tool is how that goes wrong.
      const erase = erasing.has(tool);
      drawing.style = {
        ...drawing.style,
        ...(patch ?? {}),
        ...(size === undefined ? {} : { size }),
        erase,
      };
    }

    // **On a tile layer two of the drawing tools mean something else.** The
    // Pencil lays the run picked in the palette and Fill pours it, which are
    // gestures over the *grid* rather than ink on the drawing surface — so
    // the pointer stays with the canvas and the drawing layer is given
    // nothing. Every other tool is what it always was: Select still selects,
    // Pan still pans, and Slice and the Lasso still reach the ink that is
    // there, because a tile layer can carry strokes like any other.
    const tiling = !editing && tileVerbOf(tool) !== null;
    const drawingTool = tiling ? null : DRAWN[tool] ?? null;
    const scene = host.scene();
    scene?.suspendGestures(drawingTool !== null);
    scene?.setGestureMode(
      tiling
        ? "tile"
        : tool === "pan"
          ? "pan"
          : tool === "point"
            ? "point"
            : tool === "text"
              ? "text"
              : "select",
    );
    // A hand over the canvas, whether Pan was picked from the rail or
    // borrowed with the space bar. The class carries it rather than an inline
    // style so the drawing layer's own crosshair still wins where it is up.
    host.canvas.classList.toggle("panning", tool === "pan");
    // Both of the tools whose gesture is a tap on bare ground get the same
    // cursor: what they say is "this is a place", and which of the two lands
    // is the button that is lit.
    host.canvas.classList.toggle("placing", tool === "point" || tool === "text");
    // What the rail offers follows the layer, not the tool — a tile layer
    // withholds three of the eleven. Set here because this is the one place
    // that already runs on both of the things that can change it.
    host.rail.setOffered(offered);
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

  /** What the canvas reads. See `ToolRouting.tileHand`. */
  function tileHand(): TileHand {
    const tool = host.rail.tool;
    const verb =
      host.layerKind() === "tile" && !host.psdEditing()
        ? tileVerbOf(tool)
        : null;
    return {
      verb,
      stamp: host.tileStamp(),
      random: random.has(tool),
      density,
      erasing: erasing.has(tool),
    };
  }

  return {
    apply,
    setErasing,
    isErasing: (tool) => erasing.has(tool),
    tileHand,
    tileRandom: (tool) => random.has(tool),
    onTileRandom: (tool, on) => {
      if (on) random.add(tool);
      else random.delete(tool);
      host.inspector.setTool(tool, host.drawing()?.style ?? null);
      log.info(
        on
          ? `${toolName(tool)} draws from the run at random`
          : `${toolName(tool)} lays the run out as it was picked`,
      );
    },
    tileDensity: () => density,
    onTileDensity: (next) => {
      density = Math.round(
        Math.max(DENSITY_RANGE.min, Math.min(DENSITY_RANGE.max, next)),
      );
    },
    hold: (tool) => {
      apply(tool, false);
      setErasing(tool, !erasing.has(tool));
    },
  };
}
