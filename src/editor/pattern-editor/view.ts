/**
 * Drawing the pattern editor: the tile, its neighbours, and the preview.
 *
 * **The neighbours are the point.** A pattern is a thing that repeats, and an
 * 8×8 grid on its own tells you nothing about whether the repeat is seamless
 * — upstream draws the tile surrounded by copies of itself for exactly that
 * reason, and so does this. The red box says which of them is the one you are
 * editing; the copies are dimmed here, which upstream's are not, because on
 * this editor's dark chrome an undimmed field of identical tiles reads as one
 * big pattern with a box drawn on it rather than as a tile among its own
 * repeats.
 *
 * Everything is in CSS pixels and the canvas is scaled by the device ratio,
 * so a pattern pixel is a crisp rectangle rather than a resampled one.
 */

import { patternBit } from "../../lib/paint";
import { brushPreviewCells } from "./brushes";
import {
  BOUNDARY_PX,
  CANVAS_PX,
  selectionBounds,
  type PatternEditorState,
} from "./state";

const INK = "#201e1d";
const GROUND = "#ffffff";
const GRID_LINE = "#d7d3d3";
const BOUNDARY = "#ec3013";

/** Where the tile being edited sits, and how big its cells are. */
export interface Layout {
  cell: number;
  tile: number;
  x: number;
  y: number;
}

export function layoutOf(state: PatternEditorState): Layout {
  const cell = (state.zoom * BOUNDARY_PX) / state.pattern.size;
  const tile = cell * state.pattern.size;
  const inset = (CANVAS_PX - BOUNDARY_PX) / 2;
  return {
    cell,
    tile,
    x: inset + (BOUNDARY_PX - tile) / 2 + state.offset.x * cell,
    y: inset + (BOUNDARY_PX - tile) / 2 + state.offset.y * cell,
  };
}

/** Which cell of the pattern a canvas point falls on, wrapped into it. */
export function cellAt(
  state: PatternEditorState,
  x: number,
  y: number,
): { row: number; col: number } {
  const layout = layoutOf(state);
  const size = state.pattern.size;
  const col = Math.floor((x - layout.x) / layout.cell);
  const row = Math.floor((y - layout.y) / layout.cell);
  return {
    row: ((row % size) + size) % size,
    col: ((col % size) + size) % size,
  };
}

export function sizeCanvas(canvas: HTMLCanvasElement, css: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  canvas.style.width = `${css}px`;
  canvas.style.height = `${css}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawEditor(canvas: HTMLCanvasElement, state: PatternEditorState): void {
  const ctx = sizeCanvas(canvas, CANVAS_PX);
  if (!ctx) return;
  const layout = layoutOf(state);
  const grid = state.preview ?? state.pattern;

  ctx.fillStyle = "#eae9e9";
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  const left = Math.ceil(layout.x / layout.tile) + 1;
  const right = Math.ceil((CANVAS_PX - layout.x) / layout.tile) + 1;
  const up = Math.ceil(layout.y / layout.tile) + 1;
  const down = Math.ceil((CANVAS_PX - layout.y) / layout.tile) + 1;

  for (let ty = -up; ty < down; ty++) {
    for (let tx = -left; tx < right; tx++) {
      const ox = layout.x + tx * layout.tile;
      const oy = layout.y + ty * layout.tile;
      if (ox > CANVAS_PX || oy > CANVAS_PX) continue;
      if (ox + layout.tile < 0 || oy + layout.tile < 0) continue;
      drawTile(ctx, state, grid.pixels, ox, oy, layout.cell, tx === 0 && ty === 0);
    }
  }

  drawGhost(ctx, state, layout);
  drawSelection(ctx, state, layout);

  // The box stays where the tile *belongs*, not where a drag has taken it:
  // it is what says which copy will be saved, and a box that travelled with
  // the pan would say nothing at all.
  const inset = (CANVAS_PX - BOUNDARY_PX) / 2;
  ctx.strokeStyle = BOUNDARY;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    inset + (BOUNDARY_PX - layout.tile) / 2,
    inset + (BOUNDARY_PX - layout.tile) / 2,
    layout.tile,
    layout.tile,
  );
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  state: PatternEditorState,
  pixels: number[][],
  ox: number,
  oy: number,
  cell: number,
  primary: boolean,
): void {
  const size = state.pattern.size;
  ctx.save();
  if (!primary) ctx.globalAlpha = 0.45;

  ctx.fillStyle = GROUND;
  ctx.fillRect(ox, oy, cell * size, cell * size);
  ctx.fillStyle = INK;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (pixels[row]?.[col] === 1) ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell);
    }
  }

  // A lattice, but only while a cell is big enough for one to mean anything.
  if (primary && cell >= 5) {
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= size; i++) {
      ctx.moveTo(ox + i * cell + 0.5, oy);
      ctx.lineTo(ox + i * cell + 0.5, oy + cell * size);
      ctx.moveTo(ox, oy + i * cell + 0.5);
      ctx.lineTo(ox + cell * size, oy + i * cell + 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The tip under the pointer, drawn on every copy of the tile.
 *
 * On every copy because the cells are wrapped: a tip that hangs off the right
 * edge is about to paint on the left as well, and a preview that showed only
 * one of those would be a preview of half the edit.
 */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  state: PatternEditorState,
  layout: Layout,
): void {
  if (!state.hover || state.mode !== "draw" || state.preview) return;
  const size = state.pattern.size;
  ctx.save();
  ctx.fillStyle = state.erasing ? "rgba(236, 48, 19, 0.4)" : "rgba(32, 30, 29, 0.35)";
  for (const cell of brushPreviewCells(state, state.hover.row, state.hover.col)) {
    const row = ((cell.row % size) + size) % size;
    const col = ((cell.col % size) + size) % size;
    for (let ty = -1; ty <= 1; ty++) {
      for (let tx = -1; tx <= 1; tx++) {
        ctx.fillRect(
          layout.x + tx * layout.tile + col * layout.cell,
          layout.y + ty * layout.tile + row * layout.cell,
          layout.cell,
          layout.cell,
        );
      }
    }
  }
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  state: PatternEditorState,
  layout: Layout,
): void {
  const box = selectionBounds(state);
  if (!box) return;
  const x = layout.x + box.c0 * layout.cell;
  const y = layout.y + box.r0 * layout.cell;
  const w = (box.c1 - box.c0 + 1) * layout.cell;
  const h = (box.r1 - box.r0 + 1) * layout.cell;
  ctx.save();
  ctx.fillStyle = "rgba(236, 48, 19, 0.12)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = BOUNDARY;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/**
 * The preview: the pattern as it will look on the canvas, at the project's
 * own scale.
 *
 * `cell` is world pixels per pattern pixel — the same number the brush's
 * scale slider sets — so what this shows is the pattern at the size it will
 * actually be revealed at, rather than at whatever size fits the box.
 */
export function drawPreview(
  canvas: HTMLCanvasElement,
  state: PatternEditorState,
  cell: number,
  color: string,
  width: number,
  height: number,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;

  const size = state.pattern.size;
  const grid = state.preview ?? state.pattern;
  const step = Math.max(1, cell);
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!patternBit({ size, pixels: grid.pixels }, col, row)) continue;
      ctx.fillRect(col * step, row * step, step, step);
    }
  }
}
