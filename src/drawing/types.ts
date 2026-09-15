import type { Stroke } from "../lib/types";
import { DEFAULT_PAINT_SPEC, type PaintSpec } from "../lib/paint";

/**
 * What the drawing toolbar's tools do.
 *
 * A boundary is both: it can still be made from strokes already drawn and
 * lassoed — the spec's "any stroke can be selected and turned into a
 * boundary" — and it can be swept directly, which is what `zone` is. The
 * second way exists for the reason the Point tool does: an empty patch of
 * canvas holds nothing to promote, so drawing the outline has to be something
 * you can do to it.
 */
export type DrawingTool =
  | "pencil"
  | "pattern"
  | "shape"
  | "eraser"
  | "lasso"
  | "fill"
  | "zone";

/**
 * The two ways the sweep fill is aimed.
 *
 * **draw** is the freehand sweep: press, run a closed outline, release, and
 * the inside of it fills. It is a gesture, so it goes where the hand went —
 * and it takes the pen's own smoothing, because an outline is a line and the
 * wobble comes out of it the same way.
 *
 * **points** is the other half of the same tool: tap a corner at a time, drag
 * any of them to correct it, and fill when the shape is right. A sweep cannot
 * be adjusted after the fact — the release commits it — and some shapes are
 * a handful of straight edges rather than a gesture.
 */
export type FillMode = "draw" | "points";

export interface StrokeStyle {
  brushId: number;
  size: number;
  /**
   * How much of the hand's wobble to take out, 0–100.
   *
   * A property of the *pen* rather than of the stroke, which is why it is
   * here and not on `Stroke`: it is applied to the samples as they are
   * recorded, so what the document stores is the line that was drawn on
   * screen. A ruler leaves a straight line behind, not a curve with a note
   * saying it was drawn against a ruler.
   */
  smoothing: number;
  color: string;
  mode: Stroke["mode"];
  /**
   * Whether this tool is being used as an eraser.
   *
   * Every brush can be: what a tool would draw is what it takes out. Kept per
   * tool by `editor/tool-routing.ts`, so the Pattern brush can be an eraser
   * while the Pencil is not.
   */
  erase: boolean;
  /**
   * What the mark is made of, beyond its colour — see `lib/paint.ts`.
   *
   * On the style rather than on the tool, because the same three kinds are
   * wanted by three different tools and a colour is one of them: the Pattern
   * brush is "the pencil with a pattern for its paint", the Fill tool is "a
   * swept outline with a paint in it", and the Shape brush is "a stamp with a
   * paint in it". Keeping it here is what lets the one control in the TOOL
   * zone set it for all of them.
   */
  paint: PaintSpec;
  /**
   * The box one shape stamp fills, in world pixels.
   *
   * The grid's own tile, handed down by the shell — the drawing layer knows
   * nothing about projections and must not learn. `diamond` says the space is
   * the diamond inscribed in that box rather than the box itself, which is
   * what an isometric project's spaces are.
   */
  stamp: { width: number; height: number; diamond?: boolean };
}

export const DEFAULT_STYLE: StrokeStyle = {
  brushId: 1,
  size: 6,
  smoothing: 0,
  color: "#201e1d",
  mode: "ink",
  erase: false,
  paint: DEFAULT_PAINT_SPEC,
  stamp: { width: 32, height: 32 },
};

/** How wide the eraser's disc is, in world pixels. */
export const ERASER_RADIUS = 14;

/** Axis-aligned bounds in world pixels. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
