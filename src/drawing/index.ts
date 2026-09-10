/**
 * The drawing layer — Hush's notebook ink, superimposed over the game canvas.
 *
 * Hush's freehand layer has its own renderer, camera, hit-testing and stroke
 * model, so it sits *over* Phaser's canvas rather than inside it: a stage of
 * 2D canvases with its camera slaved to Phaser's. It is a tool for getting
 * data into the other layers — sketch, select, then hand the selection on as
 * a PSD or as a boundary.
 *
 * What came across from `hush/src/notebook/drawing/`:
 *   engine/stroke-geometry.js  → geometry.ts  streamline, stamp angle, the
 *                                slice walk, the lasso's point-in-polygon
 *   engine/stroke-atlas.js     → atlas.ts     brush atlases + tint cache,
 *                                with Hush's own brush-N.png masks
 *   engine/stroke-render.js    → render.ts    the per-stamp loop
 *   engine/stroke.js           → tools.ts     draw / erase sessions
 *   engine/selection.js        → tools.ts     the lasso
 *   drawing-layer*.ts          → surface.ts, drawing-layer.ts
 *   re-anchor.ts               → surface.ts   the backing that follows the
 *                                camera, which is what makes it infinite
 *   stroke-paint.ts            → rasterise.ts stroke → PSD
 *
 * What did not, because none of it is drawing: the shelf, the pocket,
 * splits, proof pages, flowcharts, markdown, text and image shapes, brush
 * slots and their flyouts, theme-tracking colour sentinels, the highlight
 * bake target, and ML Kit handwriting recognition.
 *
 * `DrawingState` is replaced by `StrokeStore`, which keeps only what the
 * engine needs and writes through to the game document — so strokes persist
 * with the project and show up in the layer panel's counts. Hush's
 * load-bearing invariant comes with it: strokes are immutable once stored.
 */

export { DrawingLayer, type DrawingCallbacks } from "./drawing-layer";
export { StrokeStore } from "./stroke-store";
export { rasteriseStrokes, strokesToPsd } from "./rasterise";
export { strokesToZonePoints } from "./to-zone";
export { strokesBox } from "./geometry";
export type { Viewport } from "./surface";
export { BRUSHES } from "./atlas";
export { DEFAULT_STYLE, type DrawingTool, type StrokeStyle } from "./types";
