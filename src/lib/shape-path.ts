/**
 * Drawing a library shape, and measuring one.
 *
 * Ported from simple-tileset-generator's `shapeData.js`, with the same two
 * halves: trace a subpath into a 2D context, and cut the holes out
 * afterwards with `destination-out`.
 *
 * **Why holes are cut rather than filled even-odd.** An even-odd fill needs
 * every subpath in one `beginPath`, which means the whole shape has to be one
 * `fill()` — fine on a blank tile, wrong on a canvas that already has
 * something on it, because the hole would be *filled with nothing* rather
 * than *cleared*. Cutting is the reading that survives being drawn over
 * artwork, which is what a shape brush does every time. The legacy
 * `fillRule: "evenodd"` case is honoured for shapes written before holes were
 * explicit.
 *
 * Everything here works in a **box**: the shape's 0–1 coordinates times a
 * width and a height, offset to a corner. A square grid hands it a square; an
 * isometric one hands it a space's bounding box and asks for the diamond
 * inside it — see `ShapeBox`.
 */

import { isHole, pathsOf, type ShapeData, type SubPath, type Vertex } from "./library/types";
import type { Point, Rect } from "./types";

/**
 * Where a shape is being drawn: a box in whatever units the context has.
 *
 * `diamond` is the isometric case, and it is the difference between a shape
 * brush that works on this editor's headline projection and one that does
 * not. An isometric grid space is a **diamond** inscribed in that box, and
 * its neighbours' boxes overlap it by half — so a shape drawn into the box
 * covers four half-spaces and lines up with none of them. Drawn into the
 * diamond, *square* fills the space exactly, *half circle bottom* meets the
 * space below it, and the palette means the same thing on both projections.
 *
 * The box is still what is passed, because the diamond is inscribed in it and
 * a caller holding one holds the other.
 */
export interface ShapeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  diamond?: boolean;
}

/** Whether a vertex's handle is doing anything. */
function live(control: { x: number; y: number } | undefined): boolean {
  return !!control && (control.x !== 0 || control.y !== 0);
}

function at(v: Vertex, box: ShapeBox): Point {
  return { x: box.x + v.x * box.width, y: box.y + v.y * box.height };
}

/**
 * Lay one subpath into the current path. Does not begin or fill it — the
 * caller decides, because a hole and a body are traced identically and
 * composited differently.
 */
export function traceSubPath(
  ctx: CanvasRenderingContext2D | Path2D,
  path: SubPath,
  box: ShapeBox,
): void {
  const vertices = path.vertices;
  if (!vertices || vertices.length === 0) return;

  const segment = (from: Vertex, to: Vertex): void => {
    const a = at(from, box);
    const b = at(to, box);
    if (!live(from.ctrlRight) && !live(to.ctrlLeft)) {
      ctx.lineTo(b.x, b.y);
      return;
    }
    const c1 = {
      x: a.x + (from.ctrlRight?.x ?? 0) * box.width,
      y: a.y + (from.ctrlRight?.y ?? 0) * box.height,
    };
    const c2 = {
      x: b.x + (to.ctrlLeft?.x ?? 0) * box.width,
      y: b.y + (to.ctrlLeft?.y ?? 0) * box.height,
    };
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  };

  const first = at(vertices[0], box);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < vertices.length; i++) segment(vertices[i - 1], vertices[i]);

  if (path.closed === false) return;
  // The closing segment may itself be a curve, which `closePath` would draw
  // as a straight line — so it is drawn and *then* closed.
  segment(vertices[vertices.length - 1], vertices[0]);
  ctx.closePath();
}

/**
 * Paint a shape into a box, in the colour already on the context.
 *
 * `fill` is handed in rather than assumed so a caller can pass a
 * `CanvasPattern` — which is how the shape brush paints a shape *with* a
 * pattern rather than in flat colour.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeData,
  box: ShapeBox,
  fill?: string | CanvasPattern | CanvasGradient,
): void {
  const paths = pathsOf(shape);
  if (paths.length === 0) return;

  // The diamond is a shear, so it is a transform rather than a second
  // painter: the unit box's corners go to the diamond's four points, and
  // everything below draws in unit space exactly as it always did.
  if (box.diamond) {
    ctx.save();
    diamondTransform(ctx, box);
    drawShape(ctx, shape, { x: 0, y: 0, width: 1, height: 1 }, fill);
    ctx.restore();
    return;
  }

  if (fill !== undefined) ctx.fillStyle = fill;

  const holes = paths.map((_, i) => isHole(shape, i));
  const anyHole = holes.some(Boolean);

  if (shape.fillRule === "evenodd" && !anyHole) {
    ctx.beginPath();
    for (const path of paths) traceSubPath(ctx, path, box);
    ctx.fill("evenodd");
    return;
  }

  // The body, as one path: subpaths that merely overlap must not punch each
  // other out, which is what filling them one at a time with a translucent
  // colour would do.
  ctx.beginPath();
  paths.forEach((path, i) => {
    if (!holes[i]) traceSubPath(ctx, path, box);
  });
  ctx.fill("nonzero");

  if (!anyHole) return;
  const held = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  paths.forEach((path, i) => {
    if (holes[i]) traceSubPath(ctx, path, box);
  });
  ctx.fill("nonzero");
  ctx.globalCompositeOperation = held;
}

/**
 * Map the unit box onto the diamond inscribed in `box`.
 *
 * `(0,0)` goes to the top point, `(1,0)` to the right, `(1,1)` to the bottom
 * and `(0,1)` to the left — the order `Grid.cellPolygon` lists them in, so a
 * shape drawn through this and a space outlined on the canvas agree about
 * which corner is which.
 */
function diamondTransform(ctx: CanvasRenderingContext2D, box: ShapeBox): void {
  const hw = box.width / 2;
  const hh = box.height / 2;
  ctx.transform(hw, hh, -hw, hh, box.x + hw, box.y);
}

/**
 * A subpath as a polygon, with each curve walked at `steps` samples.
 *
 * Wanted twice: by the grid renderer, which fills a shape with Phaser's
 * Graphics and has no bezier of its own worth trusting at tile scale, and by
 * the shape editor's boolean cut, which is a polygon operation. Eight samples
 * per segment is upstream's default and is more than enough at a tile's size.
 */
export function subPathPolygon(path: SubPath, box: ShapeBox, steps = 8): Point[] {
  const vertices = path.vertices;
  if (!vertices || vertices.length === 0) return [];
  const out: Point[] = [];
  const push = (p: Point) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) return;
    out.push(p);
  };

  const walk = (from: Vertex, to: Vertex): void => {
    const a = at(from, box);
    const b = at(to, box);
    if (!live(from.ctrlRight) && !live(to.ctrlLeft)) {
      push(b);
      return;
    }
    const c1 = {
      x: a.x + (from.ctrlRight?.x ?? 0) * box.width,
      y: a.y + (from.ctrlRight?.y ?? 0) * box.height,
    };
    const c2 = {
      x: b.x + (to.ctrlLeft?.x ?? 0) * box.width,
      y: b.y + (to.ctrlLeft?.y ?? 0) * box.height,
    };
    for (let i = 1; i <= steps; i++) push(cubicAt(a, c1, c2, b, i / steps));
  };

  push(at(vertices[0], box));
  for (let i = 1; i < vertices.length; i++) walk(vertices[i - 1], vertices[i]);
  if (path.closed !== false) walk(vertices[vertices.length - 1], vertices[0]);
  return out;
}

/** Every subpath of a shape as a polygon, holes included and marked. */
export function shapePolygons(
  shape: ShapeData,
  box: ShapeBox,
  steps = 8,
): Array<{ points: Point[]; hole: boolean }> {
  return pathsOf(shape).map((path, i) => ({
    points: subPathPolygon(path, box, steps),
    hole: isHole(shape, i),
  }));
}

/** A point on a cubic, by de Casteljau's weights written out. */
export function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * The box a shape actually covers, in its own 0–1 space.
 *
 * Not always `0,0,1,1`: a shape somebody has dragged the points of can be
 * anywhere, and the editor's **Crop** offers to bring it back to the unit box
 * — which needs this to know by how much. Measured off the walked polygons
 * rather than the control points, because a control point sits outside the
 * curve it bends.
 */
export function shapeBounds(shape: ShapeData, steps = 12): Rect {
  const unit: ShapeBox = { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points } of shapePolygons(shape, unit, steps)) {
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The same shape moved and scaled inside its own 0–1 space.
 *
 * Handles move with their vertex and scale with it, which is what keeps a
 * curve a curve: a handle is an offset, so it takes the scale and not the
 * translation.
 */
export function transformShape<T extends ShapeData>(
  shape: T,
  scaleX: number,
  scaleY: number,
  dx: number,
  dy: number,
): T {
  const move = (v: Vertex): Vertex => {
    const out: Vertex = { x: v.x * scaleX + dx, y: v.y * scaleY + dy };
    if (v.ctrlLeft) out.ctrlLeft = { x: v.ctrlLeft.x * scaleX, y: v.ctrlLeft.y * scaleY };
    if (v.ctrlRight) out.ctrlRight = { x: v.ctrlRight.x * scaleX, y: v.ctrlRight.y * scaleY };
    return out;
  };
  const paths = pathsOf(shape).map((path) => ({
    vertices: path.vertices.map(move),
    closed: path.closed,
  }));
  const next = { ...shape, paths } as T;
  delete (next as ShapeData).vertices;
  delete (next as ShapeData).closed;
  return next;
}

/** A shape scaled and moved so that what it covers is exactly the 0–1 box. */
export function cropShape<T extends ShapeData>(shape: T): T {
  const box = shapeBounds(shape);
  if (box.width <= 0 || box.height <= 0) return shape;
  return transformShape(
    shape,
    1 / box.width,
    1 / box.height,
    -box.x / box.width,
    -box.y / box.height,
  );
}
