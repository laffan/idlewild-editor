/**
 * Drawing the shape editor.
 *
 * Three layers, in this order and for this reason: the ground the shape sits
 * on, the shape as it will be *saved*, and then the editing furniture over
 * it. The middle one is drawn exactly the way the canvas and the palette draw
 * it — through `drawShape`, holes cut with `destination-out` and all — so
 * what is in the box is what will come out of it. An editor that previewed
 * its own approximation of a shape would be an editor you had to save from to
 * find out what you had made.
 */

import { drawShape } from "../../lib/shape-path";
import type { Point } from "../../lib/types";
import { controlPoint, pathBounds, pathsBounds, rotateHandle, toPx, boxHandles } from "./geometry";
import {
  CANVAS_PX,
  INNER_PX,
  MARGIN_PX,
  hasCurve,
  selectedPaths,
  toShapeData,
  type ShapeEditorState,
} from "./state";

const ACCENT = "#ec3013";
const INK = "#201e1d";
const GRID = "#e2dfdf";
const RULE = "#c9c5c5";

export function sizeCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(CANVAS_PX * dpr);
  canvas.height = Math.round(CANVAS_PX * dpr);
  canvas.style.width = `${CANVAS_PX}px`;
  canvas.style.height = `${CANVAS_PX}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawShapeEditor(
  canvas: HTMLCanvasElement,
  state: ShapeEditorState,
  ghost: Point | null,
): void {
  const ctx = sizeCanvas(canvas);
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
  drawGround(ctx);

  // The shape itself, through the same painter the canvas uses.
  drawShape(
    ctx,
    toShapeData(state.paths),
    { x: MARGIN_PX, y: MARGIN_PX, width: INNER_PX, height: INNER_PX },
    "rgba(32, 30, 29, 0.82)",
  );

  drawOutlines(ctx, state);
  if (state.transforming) drawTransformBox(ctx, state);
  drawAnchors(ctx, state);
  if (state.pen) drawPen(ctx, state.pen);
  if (ghost) drawGhost(ctx, ghost);
}

/**
 * The path being tapped out, as it stands.
 *
 * The run so far and a ring on the first corner, because tapping that one
 * again is what closes the shape and a gesture nobody can see is a gesture
 * nobody finds.
 */
function drawPen(ctx: CanvasRenderingContext2D, corners: readonly Point[]): void {
  if (corners.length === 0) return;
  const at = corners.map(toPx);

  if (at.length > 1) {
    ctx.beginPath();
    ctx.moveTo(at[0].x, at[0].y);
    for (let i = 1; i < at.length; i++) ctx.lineTo(at[i].x, at[i].y);
    if (at.length > 2) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineTo(at[0].x, at[0].y);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  at.forEach((p, i) => {
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === 0 ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (i !== 0 || at.length < 3) return;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function drawGround(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = INNER_PX / 8;
  for (let i = 0; i <= 8; i++) {
    const at = MARGIN_PX + i * step;
    ctx.moveTo(at + 0.5, MARGIN_PX);
    ctx.lineTo(at + 0.5, MARGIN_PX + INNER_PX);
    ctx.moveTo(MARGIN_PX, at + 0.5);
    ctx.lineTo(MARGIN_PX + INNER_PX, at + 0.5);
  }
  ctx.stroke();

  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const mid = MARGIN_PX + INNER_PX / 2;
  ctx.moveTo(mid, MARGIN_PX);
  ctx.lineTo(mid, MARGIN_PX + INNER_PX);
  ctx.moveTo(MARGIN_PX, mid);
  ctx.lineTo(MARGIN_PX + INNER_PX, mid);
  ctx.stroke();

  // The tile: everything inside it is what a grid space will get.
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(MARGIN_PX, MARGIN_PX, INNER_PX, INNER_PX);
  ctx.setLineDash([]);
}

/** Each subpath's own outline: the current one in the accent, the rest grey. */
function drawOutlines(ctx: CanvasRenderingContext2D, state: ShapeEditorState): void {
  const selected = new Set(selectedPaths(state));
  state.paths.forEach((path, index) => {
    if (path.vertices.length === 0) return;
    ctx.beginPath();
    const first = toPx(path.vertices[0]);
    ctx.moveTo(first.x, first.y);
    const count = path.closed ? path.vertices.length : path.vertices.length - 1;
    for (let i = 0; i < count; i++) {
      const from = path.vertices[i];
      const to = path.vertices[(i + 1) % path.vertices.length];
      const b = toPx(to);
      if (hasCurveBetween(from, to)) {
        const c1 = toPx(controlPoint(from, "right"));
        const c2 = toPx(controlPoint(to, "left"));
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      } else {
        ctx.lineTo(b.x, b.y);
      }
    }
    if (path.closed) ctx.closePath();

    const isCurrent = index === state.current;
    ctx.lineWidth = isCurrent ? 2 : 1.5;
    ctx.strokeStyle = isCurrent ? ACCENT : selected.has(index) ? "#dd2b0f" : "#7d7979";
    if (path.hole) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function hasCurveBetween(
  from: { ctrlRight?: { x: number; y: number } },
  to: { ctrlLeft?: { x: number; y: number } },
): boolean {
  const live = (c?: { x: number; y: number }) => !!c && (c.x !== 0 || c.y !== 0);
  return live(from.ctrlRight) || live(to.ctrlLeft);
}

/** The current path's points, and the handles of the curved ones. */
function drawAnchors(ctx: CanvasRenderingContext2D, state: ShapeEditorState): void {
  const path = state.paths[state.current];
  if (!path) return;

  for (const vertex of path.vertices) {
    if (!hasCurve(vertex)) continue;
    const at = toPx(vertex);
    for (const side of ["left", "right"] as const) {
      const tip = toPx(controlPoint(vertex, side));
      ctx.strokeStyle = "#9b9797";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#605d5d";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  path.vertices.forEach((vertex, index) => {
    const at = toPx(vertex);
    const picked = state.selectedPoints.has(index);
    ctx.fillStyle = picked ? ACCENT : "#ffffff";
    ctx.strokeStyle = picked ? ACCENT : INK;
    ctx.lineWidth = 1.5;
    if (hasCurve(vertex)) {
      ctx.beginPath();
      ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(at.x - 4.5, at.y - 4.5, 9, 9);
      ctx.strokeRect(at.x - 4.5, at.y - 4.5, 9, 9);
    }
  });
}

/** The resize and rotate handles, while ⌘ is down or the toggle is on. */
function drawTransformBox(ctx: CanvasRenderingContext2D, state: ShapeEditorState): void {
  const wanted = selectedPaths(state).map((i) => state.paths[i]);
  if (wanted.length === 0) return;
  const box = wanted.length > 1 ? pathsBounds(wanted) : pathBounds(wanted[0]);

  const a = toPx({ x: box.x, y: box.y });
  const b = toPx({ x: box.x + box.width, y: box.y + box.height });
  ctx.strokeStyle = "#3a7bd5";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.setLineDash([]);

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#3a7bd5";
  for (const handle of boxHandles(box)) {
    const at = toPx(handle);
    ctx.fillRect(at.x - 4, at.y - 4, 8, 8);
    ctx.strokeRect(at.x - 4, at.y - 4, 8, 8);
  }

  const turn = toPx(rotateHandle(box));
  const top = toPx({ x: box.x + box.width / 2, y: box.y });
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(turn.x, turn.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(turn.x, turn.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Where a click on an edge would drop a point. */
function drawGhost(ctx: CanvasRenderingContext2D, at: Point): void {
  const p = toPx(at);
  ctx.fillStyle = "rgba(236, 48, 19, 0.6)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

/** The shape on its own, at the size a grid space will show it. */
export function drawShapePreview(
  canvas: HTMLCanvasElement,
  state: ShapeEditorState,
  color: string,
  cell: number,
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

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const shape = toShapeData(state.paths);
  const step = Math.max(8, cell);
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      drawShape(ctx, shape, { x, y, width: step, height: step }, color);
    }
  }

  // The lattice over it, so the tiling is legible as tiles rather than as one
  // continuous picture.
  ctx.strokeStyle = "rgba(32, 30, 29, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
}
