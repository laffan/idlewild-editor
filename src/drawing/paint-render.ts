/**
 * Laying down a mark that is made of something other than flat colour.
 *
 * Three of them, and they are the whole of what the Pattern brush, the Shape
 * brush and a paint-carrying Fill do on the canvas:
 *
 * **A patterned stroke** is not stamped. It is the set of *lattice cells* the
 * tip passed over, with the pattern's own ones filled and its zeroes left
 * alone. The lattice is pinned to the world — cell `(cx, cy)` is always at
 * `(cx × scale, cy × scale)` — so drawing over your own tail changes nothing,
 * two strokes that cross line up exactly, and the result reads as an area
 * that was already filled and is being *revealed*. That is what separates
 * this from the old Pixels tool, which was the pencil with a checkered tip
 * and therefore a stamp whose phase followed the hand.
 *
 * **A patterned region** is the same lattice under a clip. Cheap rather than
 * cell by cell, because an area fill can be a hundred thousand cells and a
 * `CanvasPattern` is one call whatever its size — see `patternFillStyle`,
 * which pins the same lattice through the pattern's own matrix.
 *
 * **A shape stroke** stamps a library shape into a box at each recorded
 * point. Its points are grid spaces rather than a path, which is why it is
 * its own stroke mode: what is stored is where the stamps went, and a
 * smoothing pass over that would move the tiles off their spaces.
 */

import {
  fillLatticeCells,
  latticeCell,
  patternFillStyle,
  patternScaleOf,
  paintPattern,
  paintShape,
  type PaintSpec,
} from "../lib/paint";
import { drawShape } from "../lib/shape-path";
import type { StreamPoint } from "./geometry";
import type { Bounds } from "./types";

/** How big one shape stamp is, and how the space sits inside it. */
export interface StampGeometry {
  width: number;
  height: number;
  diamond?: boolean;
}

/** A lattice cell, as the key a set holds it under. */
function key(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Every lattice cell a disc of radius `r` covers as it travels the path.
 *
 * Sampled rather than solved. The disc is walked along each segment in steps
 * no longer than half its own radius, and at each step the cells whose
 * rectangle the disc actually reaches are added — so the answer is exact up
 * to a cell at the ends of a very fast flick, and costs a few dozen tests per
 * step instead of one per cell of the stroke's whole bounding box.
 *
 * Deduplicated, which is what makes the cost bounded: a stroke scribbled back
 * and forth over one patch is the cells of that patch, once.
 */
export function cellsUnderStroke(
  stream: readonly StreamPoint[],
  radius: number,
  scale: number,
): Set<string> {
  const cells = new Set<string>();
  if (stream.length === 0 || scale <= 0) return cells;

  const disc = (x: number, y: number, r: number): void => {
    const x0 = latticeCell(x - r, scale);
    const x1 = latticeCell(x + r, scale);
    const y0 = latticeCell(y - r, scale);
    const y1 = latticeCell(y + r, scale);
    const rr = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        // Nearest point of the cell's rectangle to the disc's centre: a cell
        // counts if the tip reaches any of it, not only its middle.
        const nx = Math.max(cx * scale, Math.min(x, (cx + 1) * scale));
        const ny = Math.max(cy * scale, Math.min(y, (cy + 1) * scale));
        const dx = nx - x;
        const dy = ny - y;
        if (dx * dx + dy * dy <= rr) cells.add(key(cx, cy));
      }
    }
  };

  const at = (p: StreamPoint, r: number) => disc(p.point[0], p.point[1], r);

  if (stream.length === 1) {
    at(stream[0], radius * pressureScale(stream[0].pressure));
    return cells;
  }

  for (let i = 1; i < stream.length; i++) {
    const a = stream[i - 1];
    const b = stream[i];
    const ax = a.point[0];
    const ay = a.point[1];
    const dx = b.point[0] - ax;
    const dy = b.point[1] - ay;
    const length = Math.hypot(dx, dy);
    const step = Math.max(radius * 0.5, scale * 0.5, 0.5);
    const count = Math.max(1, Math.ceil(length / step));
    for (let s = 0; s <= count; s++) {
      const t = s / count;
      const pressure = a.pressure + (b.pressure - a.pressure) * t;
      disc(ax + dx * t, ay + dy * t, radius * pressureScale(pressure));
    }
  }
  return cells;
}

/**
 * How much pressure narrows the tip.
 *
 * The pencil's own floor, so a Pattern stroke tapers like every other stroke
 * in this editor rather than being the one tool a Pencil cannot shade with.
 */
function pressureScale(pressure: number): number {
  return 0.6 + 0.4 * pressure;
}

/** The box a set of lattice cells covers, in world units. */
function cellsBox(cells: Set<string>, scale: number): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of cells) {
    const comma = k.indexOf(",");
    const cx = Number(k.slice(0, comma));
    const cy = Number(k.slice(comma + 1));
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
  }
  if (minX === Infinity) return null;
  return {
    x: minX * scale,
    y: minY * scale,
    width: (maxX - minX + 1) * scale,
    height: (maxY - minY + 1) * scale,
  };
}

/**
 * Paint the cells a patterned stroke reveals.
 *
 * Returns false when there is no pattern to reveal — a paint naming a row
 * this install does not have — so the caller can fall back to flat colour
 * rather than drawing nothing.
 */
export function paintPatternStroke(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  size: number,
  color: string,
  paint: PaintSpec,
): boolean {
  const pattern = paintPattern(paint);
  if (!pattern) return false;
  const scale = patternScaleOf(paint);
  const cells = cellsUnderStroke(stream, size * 0.5, scale);
  const box = cellsBox(cells, scale);
  if (!box) return true;

  ctx.save();
  ctx.fillStyle = color;
  fillLatticeCells(ctx, pattern, scale, box, paint.patternInvert, (cx, cy) =>
    cells.has(key(cx, cy)),
  );
  ctx.restore();
  return true;
}

/** The world box a closed outline covers. */
function streamBox(stream: readonly StreamPoint[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { point } of stream) {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Trace a closed outline into the current path. */
function traceOutline(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
): void {
  ctx.beginPath();
  ctx.moveTo(stream[0].point[0], stream[0].point[1]);
  for (let i = 1; i < stream.length; i++) {
    ctx.lineTo(stream[i].point[0], stream[i].point[1]);
  }
  ctx.closePath();
}

/**
 * Fill a closed outline with a pattern or a field of shapes.
 *
 * `nonzero`, as the flat fill uses, so an outline that crosses itself — which
 * a swept one does constantly — comes out filled rather than holed.
 */
export function paintRegion(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  color: string,
  paint: PaintSpec,
  stamp: StampGeometry,
): boolean {
  if (stream.length < 3) return true;
  const box = streamBox(stream);
  if (!box) return true;

  if (paint.kind === "pattern") {
    const pattern = paintPattern(paint);
    if (!pattern) return false;
    const scale = patternScaleOf(paint);
    const style = patternFillStyle(ctx, pattern, scale, color, paint.patternInvert);
    ctx.save();
    traceOutline(ctx, stream);
    if (style) {
      // Nearest-neighbour: a pattern pixel is a pixel, and a smoothed one is
      // a smudge that happens to repeat.
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = style;
      ctx.fill("nonzero");
    } else {
      ctx.clip("nonzero");
      ctx.fillStyle = color;
      fillLatticeCells(ctx, pattern, scale, box, paint.patternInvert);
    }
    ctx.restore();
    return true;
  }

  const shape = paintShape(paint);
  if (!shape) return false;
  const w = Math.max(1, stamp.width);
  const h = Math.max(1, stamp.height);
  ctx.save();
  traceOutline(ctx, stream);
  ctx.clip("nonzero");
  for (const at of stampsOver(box, stamp)) {
    drawShape(
      ctx,
      shape,
      { x: at.x, y: at.y, width: w, height: h, diamond: stamp.diamond },
      color,
    );
  }
  ctx.restore();
  return true;
}

/**
 * Stamp a shape into a box at each of the stroke's points.
 *
 * The points are the **corners of the boxes**, not their centres, and they
 * were recorded that way: a grid space is a place rather than a position, and
 * storing its corner is what lets the stamp be re-laid at exactly the size
 * the box was when it was drawn even if the project's grid changes under it.
 *
 * A hole in a shape is cut with `destination-out`, so two stamps that overlap
 * would have the second one's hole eat the first one's body. They are laid
 * one at a time anyway — a tile field is meant to be a field of tiles — and
 * the boxes come from a lattice, so overlaps do not arise.
 */
export function paintShapeStroke(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  color: string,
  paint: PaintSpec,
  stamp: StampGeometry | undefined,
): boolean {
  const shape = paintShape(paint);
  if (!shape) return false;
  const width = Math.max(1, stamp?.width ?? 32);
  const height = Math.max(1, stamp?.height ?? 32);
  const diamond = stamp?.diamond;
  ctx.save();
  for (const { point } of stream) {
    drawShape(
      ctx,
      shape,
      { x: point[0], y: point[1], width, height, diamond },
      color,
    );
  }
  ctx.restore();
  return true;
}

/**
 * Every grid space whose box meets a world box.
 *
 * Two lattices, because there are two kinds of grid and a shape fill has to
 * tile the one the project actually has. The square case is a division; the
 * isometric one walks the diamond lattice — `(cx − cy)` across and
 * `(cx + cy)` down, which is `Grid.cellToWorld` read from the drawing layer,
 * where there is no grid to ask. The range is found by inverting that at the
 * four corners of the box and padding by one, so nothing on an edge is lost.
 */
export function stampsOver(
  box: Bounds,
  stamp: StampGeometry,
): Array<{ x: number; y: number }> {
  const w = Math.max(1, stamp.width);
  const h = Math.max(1, stamp.height);
  const out: Array<{ x: number; y: number }> = [];

  if (!stamp.diamond) {
    const x0 = Math.floor(box.x / w);
    const x1 = Math.floor((box.x + box.width) / w);
    const y0 = Math.floor(box.y / h);
    const y1 = Math.floor((box.y + box.height) / h);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) out.push({ x: cx * w, y: cy * h });
    }
    return out;
  }

  let minCx = Infinity;
  let maxCx = -Infinity;
  let minCy = Infinity;
  let maxCy = -Infinity;
  for (const [px, py] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ]) {
    const a = px / (w / 2);
    const b = py / (h / 2);
    const cx = Math.round((a + b) / 2);
    const cy = Math.round((b - a) / 2);
    if (cx < minCx) minCx = cx;
    if (cx > maxCx) maxCx = cx;
    if (cy < minCy) minCy = cy;
    if (cy > maxCy) maxCy = cy;
  }
  for (let cy = minCy - 1; cy <= maxCy + 1; cy++) {
    for (let cx = minCx - 1; cx <= maxCx + 1; cx++) {
      // The centre of the diamond, then back to the box's own corner.
      out.push({
        x: (cx - cy) * (w / 2) - w / 2,
        y: (cx + cy) * (h / 2) - h / 2,
      });
    }
  }
  return out;
}
