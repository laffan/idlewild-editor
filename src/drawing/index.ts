/**
 * The drawing layer — the seam Hush's notebook engine plugs into.
 *
 * Hush's freehand layer has its own renderer, camera, hit-testing, stroke
 * model and layer stack, so it is superimposed over the game canvas rather
 * than merged into it: a stack of 2D canvases above Phaser's, with its camera
 * slaved to Phaser's so the two never drift.
 *
 * What comes across, per the port plan:
 *   drawing/engine/    stroke, stroke-render, stroke-geometry, stroke-atlas,
 *                      stroke-erase, selection, gestures, layers, brushes/
 *   re-anchor.ts       camera-following origin shifts — the infinite canvas
 *   region-select.ts   lasso and marquee over strokes
 *   sync-shim.ts       identity diff between the store and engine.strokes
 *   stroke-paint.ts    per-stroke re-render into a foreign context
 *
 * What does not: the shelf, pocket, splits, proof pages, flowchart, markdown,
 * text and image shapes, and ML Kit handwriting recognition — none of it is
 * drawing, and none of it belongs in a game editor.
 *
 * `DrawingState` is replaced by StrokeStore below, which keeps only what the
 * engine actually needs and writes through to the game document. Hush's
 * load-bearing invariant comes with it: strokes are immutable once stored, so
 * the sync shim's identity diff and structurally shared undo both hold.
 */

export { StrokeStore } from "./stroke-store";
export { rasteriseStrokes, strokesToPsd } from "./rasterise";
export type { DrawingTool, StrokeStyle } from "./types";
