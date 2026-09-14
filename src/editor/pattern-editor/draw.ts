/**
 * What a gesture does to the grid.
 *
 * The one rule running through all of it is **wrapping**: every write is taken
 * modulo the pattern's size, so a tip that hangs off an edge paints the
 * opposite edge as well. That is the whole of what makes a pattern drawn here
 * seamless — you draw across the boundary and the repeat takes care of
 * itself, rather than drawing a tile and then going back to fix its four
 * edges.
 */

import {
  copyPattern,
  invertPattern,
  offsetPattern,
  resizePattern,
  type PatternData,
} from "../../lib/library";
import { brushCells } from "./brushes";
import {
  capture,
  selectionBounds,
  MAX_SIZE,
  MIN_SIZE,
  type PatternEditorState,
} from "./state";

/** Lay the tip at a cell, writing `value` into every cell it covers. */
export function applyBrush(
  state: PatternEditorState,
  grid: PatternData,
  row: number,
  col: number,
  value: number,
): void {
  const size = grid.size;
  for (const cell of brushCells(state, row, col)) {
    const r = ((cell.row % size) + size) % size;
    const c = ((cell.col % size) + size) % size;
    const line = grid.pixels[r];
    if (line) line[c] = value;
  }
}

/**
 * The tip walked from one cell to another, as a fresh grid.
 *
 * Bresenham, as upstream has it, and the tip laid at every step rather than
 * at the ends — a 6-wide brush dragged diagonally has to leave a band, not
 * two blobs with a gap.
 */
export function lineInto(
  state: PatternEditorState,
  base: PatternData,
  from: { row: number; col: number },
  to: { row: number; col: number },
  value: number,
): PatternData {
  const grid = copyPattern(base);
  let x = from.col;
  let y = from.row;
  const dx = Math.abs(to.col - x);
  const dy = Math.abs(to.row - y);
  const sx = x < to.col ? 1 : -1;
  const sy = y < to.row ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    applyBrush(state, grid, y, x, value);
    if (x === to.col && y === to.row) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return grid;
}

/** Every one becomes a zero and back. An undo step of its own. */
export function invert(state: PatternEditorState): void {
  capture(state);
  state.pattern = invertPattern(state.pattern);
}

/** Change the grid, keeping what is drawn — see `resizePattern`. */
export function resize(state: PatternEditorState, size: number): void {
  const next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
  if (next === state.pattern.size) return;
  capture(state);
  state.pattern = resizePattern(state.pattern, next);
  state.selection = null;
}

/** Move the whole pattern by whole cells, wrapping. */
export function nudge(state: PatternEditorState, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  capture(state);
  state.pattern = offsetPattern(state.pattern, dx, dy);
}

/**
 * Commit a drag of the tile.
 *
 * The drag itself only moves where the copies are *drawn* — nothing is
 * written until the gesture ends, which is what lets you push the pattern
 * around looking for a phase you like and land on one. The snapshot was taken
 * when the drag opened, so this is one undo step.
 */
export function commitOffset(state: PatternEditorState): void {
  const { x, y } = state.offset;
  state.offset = { x: 0, y: 0 };
  if (x === 0 && y === 0) return;
  state.pattern = offsetPattern(state.pattern, x, y);
}

/** Set every cell of the selection. */
export function setSelection(state: PatternEditorState, value: number): void {
  const box = selectionBounds(state);
  if (!box) return;
  capture(state);
  const grid = copyPattern(state.pattern);
  for (let row = box.r0; row <= box.r1; row++) {
    for (let col = box.c0; col <= box.c1; col++) {
      const line = grid.pixels[row];
      if (line) line[col] = value;
    }
  }
  state.pattern = grid;
}

/** The selection's cells, as a grid — what a custom tip is made from. */
export function selectionBits(state: PatternEditorState): number[][] | null {
  const box = selectionBounds(state);
  if (!box) return null;
  const bits: number[][] = [];
  for (let row = box.r0; row <= box.r1; row++) {
    const out: number[] = [];
    for (let col = box.c0; col <= box.c1; col++) {
      out.push(state.pattern.pixels[row]?.[col] === 1 ? 1 : 0);
    }
    bits.push(out);
  }
  return bits.some((r) => r.includes(1)) ? bits : null;
}

/** A grid of bits as a pattern of its own, squared off and centred. */
export function bitsToPattern(bits: number[][]): PatternData {
  const height = bits.length;
  const width = bits[0]?.length ?? 0;
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.max(width, height)));
  const pixels: number[][] = [];
  const ox = Math.floor((size - width) / 2);
  const oy = Math.floor((size - height) / 2);
  for (let row = 0; row < size; row++) {
    const out: number[] = [];
    for (let col = 0; col < size; col++) {
      out.push(bits[row - oy]?.[col - ox] === 1 ? 1 : 0);
    }
    pixels.push(out);
  }
  return { size, pixels };
}

/** The pattern as a 1:1 PNG data URL — one canvas pixel per pattern pixel. */
export function patternPngUrl(pattern: PatternData): string {
  const canvas = document.createElement("canvas");
  canvas.width = pattern.size;
  canvas.height = pattern.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pattern.size, pattern.size);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < pattern.size; row++) {
    for (let col = 0; col < pattern.size; col++) {
      if (pattern.pixels[row]?.[col] === 1) ctx.fillRect(col, row, 1, 1);
    }
  }
  return canvas.toDataURL("image/png");
}
