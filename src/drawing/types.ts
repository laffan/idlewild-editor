import type { Stroke } from "../lib/types";

/**
 * What the rail's drawing tools do.
 *
 * There is no boundary *tool*. A boundary is made from strokes you have
 * already drawn and selected — the spec's "any stroke can be selected and
 * turned into a boundary" — so it is an action on a lasso selection, not a
 * mode you draw in.
 */
export type DrawingTool = "pencil" | "eraser" | "lasso";

export interface StrokeStyle {
  brushId: number;
  size: number;
  color: string;
  mode: Stroke["mode"];
}

export const DEFAULT_STYLE: StrokeStyle = {
  brushId: 1,
  size: 6,
  color: "#201e1d",
  mode: "ink",
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
