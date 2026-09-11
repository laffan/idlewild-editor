/**
 * The model behind Extrude mode: a prototype solid built out of grid spaces.
 *
 * A shape is a set of **voxels** — integer `(cx, cy, cz)` triples, where
 * `cx`/`cy` are the project's own grid coordinates and `cz` counts levels
 * upward from the ground. Everything the mode does is an edit to that set, so
 * the whole model is integer arithmetic and the projection only appears when
 * something has to be drawn.
 *
 * That is also why the two templates need no second code path. Isometric has
 * a level height and reads as a stack of cubes; orthogonal has a level height
 * of zero, so every voxel stays on the ground and a pull along a grid axis is
 * exactly "fill the spaces that way". One set of operations, two shapes of
 * space — the same bargain `Grid` already makes.
 *
 * **Why not three.js.** The view is one fixed axonometric projection of
 * axis-aligned boxes, so every face is a quad whose corners are known exactly
 * and hidden-surface removal is "is there a neighbour on that side?". A
 * painter's sort over `cx + cy + cz` is not an approximation of the right
 * answer here, it *is* the right answer. A second renderer would mean a
 * second camera slaved to Phaser's, a WebGL context beside Phaser's own, and
 * a readback path to get the pixels into a PSD — for geometry that comes out
 * of six integers.
 */

import { Grid, pointsBounds } from "./grid";
import type { Cell, Point, Rect } from "./types";

/**
 * The greybox palette.
 *
 * Prototype geometry is grey by convention and by argument: an extruded block
 * stands in for artwork nobody has drawn yet, and giving it a colour would be
 * saying something about it that is not true. The light comes from the
 * top-left, so the wall facing away from it is the darker of the two.
 *
 * Here rather than beside the renderer because two things draw the same
 * solid — the canvas while it is being pulled, and the rasteriser that writes
 * it into a PSD — and a shape that changed colour on the way out would be a
 * different shape.
 */
export const SHADE_COLORS: Record<"top" | "right" | "left", string> = {
  top: "#eae7e7",
  right: "#bab6b6",
  left: "#8f8b8b",
};

/** The hairline between two spaces, which is what gives the solid its edges. */
export const EDGE_COLOR = "#605d5d";

/** A grid space at a height. `cz` 0 is the space itself, resting on the ground. */
export interface Voxel {
  cx: number;
  cy: number;
  cz: number;
}

/**
 * The six directions a face can be pulled.
 *
 * `+cx` / `+cy` are the grid's own axes, so under an isometric template they
 * read as the two screen diagonals and under an orthogonal one as right and
 * down. `+z` is up off the ground, and only a projection with height has it.
 */
export type AxisId = "+cx" | "-cx" | "+cy" | "-cy" | "+z" | "-z";

const STEPS: Record<AxisId, Voxel> = {
  "+cx": { cx: 1, cy: 0, cz: 0 },
  "-cx": { cx: -1, cy: 0, cz: 0 },
  "+cy": { cx: 0, cy: 1, cz: 0 },
  "-cy": { cx: 0, cy: -1, cz: 0 },
  "+z": { cx: 0, cy: 0, cz: 1 },
  "-z": { cx: 0, cy: 0, cz: -1 },
};

/**
 * Which two corners of `cellPolygon` an axis's side face hangs from.
 *
 * Both projections put the same directions at the same indices — a diamond's
 * vertices are top, right, bottom, left and a square's are the four corners
 * clockwise from the top-left — so `right → bottom` faces `+cx` either way.
 */
const EDGES: Record<"+cx" | "-cx" | "+cy" | "-cy", [number, number]> = {
  "+cx": [1, 2],
  "+cy": [2, 3],
  "-cx": [3, 0],
  "-cy": [0, 1],
};

/**
 * A ceiling on how many spaces one shape may hold.
 *
 * A pull is previewed on every pointer move, so an unbounded drag over a
 * large plate would rebuild a set of hundreds of thousands of voxels sixty
 * times a second. A pull takes the steps that still fit under this, and none
 * at all once there is no room.
 */
export const MAX_VOXELS = 40_000;

/** And how far one gesture may pull, however far the finger travels. */
const MAX_STEPS = 64;

export type VoxelSet = ReadonlySet<string>;

export function voxelKey(v: Voxel): string {
  return `${v.cx},${v.cy},${v.cz}`;
}

export function parseVoxel(key: string): Voxel {
  const [cx, cy, cz] = key.split(",").map(Number);
  return { cx, cy, cz };
}

/**
 * The face currently in the user's hands.
 *
 * `virtual` is the state a shape starts in: the spaces of the grid selection
 * are held as a plate that is not part of the solid yet, so the first pull is
 * what lays them down. Everything after that is a real face of real voxels,
 * and `facing` is the way it was last pulled — which is the side of each
 * voxel the highlight draws and the next pull leaves from.
 */
export interface Patch {
  voxels: Voxel[];
  virtual: boolean;
  facing: AxisId;
}

export interface ExtrudeState {
  shape: VoxelSet;
  patch: Patch;
}

/** How tall one level stands, in world pixels. Flat projections have none. */
export function levelHeight(grid: Grid): number {
  // Half a tile's width, which is what makes one voxel read as a cube on the
  // usual 2:1 diamond: the top face is `size × size/2` and the two visible
  // walls stand `size/2` below it.
  return grid.projection === "isometric" ? grid.tileWidth / 2 : 0;
}

/** The directions a pull may take. Height is isometric-only. */
export function axesFor(grid: Grid): AxisId[] {
  const flat: AxisId[] = ["+cx", "-cx", "+cy", "-cy"];
  return levelHeight(grid) > 0 ? [...flat, "+z", "-z"] : flat;
}

/** Where one step along an axis lands, in world pixels. */
export function axisStep(grid: Grid, axis: AxisId): Point {
  if (axis === "+z") return { x: 0, y: -levelHeight(grid) };
  if (axis === "-z") return { x: 0, y: levelHeight(grid) };
  // `cellToWorld` is linear with no offset term in either projection, so it
  // can be read on a difference as well as on a position.
  const step = STEPS[axis];
  return grid.cellToWorld({ cx: step.cx, cy: step.cy });
}

/**
 * Which way a drag is pulling, and how far.
 *
 * Every axis is a direction on screen, and the one the finger is going is
 * whichever of them the drag projects furthest along. Under an isometric
 * template those directions are 63° apart — down-right, straight down,
 * down-left — which is enough to tell a pull sideways from a pull downward
 * without asking the user to be precise about it.
 *
 * @param delta the drag so far, in screen pixels.
 */
export function pickPull(
  grid: Grid,
  delta: Point,
  zoom: number,
): { axis: AxisId; steps: number } | null {
  let best: { axis: AxisId; steps: number; reach: number } | null = null;
  for (const axis of axesFor(grid)) {
    const step = axisStep(grid, axis);
    const length = Math.hypot(step.x, step.y);
    if (length === 0) continue;
    // Into world units, so a pull is the same number of spaces however far
    // the camera is zoomed out.
    const reach =
      (delta.x * (step.x / length) + delta.y * (step.y / length)) / zoom;
    if (reach <= 0) continue;
    const steps = Math.min(MAX_STEPS, Math.round(reach / length));
    if (steps < 1) continue;
    if (!best || reach > best.reach) best = { axis, steps, reach };
  }
  return best ? { axis: best.axis, steps: best.steps } : null;
}

/** The plate a grid selection starts as: its spaces, not yet solid. */
export function groundPatch(cells: readonly Cell[]): Patch {
  return {
    voxels: cells.map((c) => ({ cx: c.cx, cy: c.cy, cz: 0 })),
    virtual: true,
    facing: "+z",
  };
}

/**
 * What a fresh selection inside extrude mode picks up.
 *
 * The topmost voxel of every selected space that has one — which is the top
 * surface of the shape over that patch of ground, and what "select the top
 * few tiles" means. Spaces with nothing on them are ignored, so a selection
 * that overlaps the shape and the bare grid takes the shape. A selection over
 * nothing at all is a new plate, the same way the mode began.
 */
export function surfacePatch(shape: VoxelSet, cells: readonly Cell[]): Patch {
  const tops = new Map<string, Voxel>();
  for (const key of shape) {
    const v = parseVoxel(key);
    const id = `${v.cx},${v.cy}`;
    const top = tops.get(id);
    if (!top || v.cz > top.cz) tops.set(id, v);
  }

  const voxels: Voxel[] = [];
  for (const cell of cells) {
    const top = tops.get(`${cell.cx},${cell.cy}`);
    if (top) voxels.push(top);
  }
  return voxels.length ? { voxels, virtual: false, facing: "+z" } : groundPatch(cells);
}

function offset(v: Voxel, step: Voxel, k: number): Voxel {
  return { cx: v.cx + step.cx * k, cy: v.cy + step.cy * k, cz: v.cz + step.cz * k };
}

/**
 * A voxel split into the two coordinates that run *across* an axis and the
 * one that runs along it, and back again.
 *
 * Sweeping a face is a rectangle in the plane the face lies in, and searching
 * for a face is a walk along the axis it points down. Writing both against
 * `u`, `v` and `w` is what lets one pair of functions serve all six
 * directions instead of three copies with the coordinates permuted.
 */
function across(axis: AxisId, voxel: Voxel): { u: number; v: number; w: number } {
  if (axis === "+cx" || axis === "-cx") {
    return { u: voxel.cy, v: voxel.cz, w: voxel.cx };
  }
  if (axis === "+cy" || axis === "-cy") {
    return { u: voxel.cx, v: voxel.cz, w: voxel.cy };
  }
  return { u: voxel.cx, v: voxel.cy, w: voxel.cz };
}

function rebuild(axis: AxisId, u: number, v: number, w: number): Voxel {
  if (axis === "+cx" || axis === "-cx") return { cx: w, cy: u, cz: v };
  if (axis === "+cy" || axis === "-cy") return { cx: u, cy: w, cz: v };
  return { cx: u, cy: v, cz: w };
}

/**
 * Where the shape's `axis` face is, at every spot in the plane it faces.
 *
 * The outermost voxel along the axis, per position: nothing lies beyond it in
 * that direction, so its face on that side is by definition the exposed one.
 * That is the whole of "the wall you can see" — read down `+z` it is the top
 * of each column, and read along `+cx` it is the face of whichever block
 * sticks out furthest that way.
 *
 * One pass over the shape rather than a search per position, because this
 * runs on every pointer move of a sweep.
 */
function exposed(shape: VoxelSet, axis: AxisId): Map<string, number> {
  const outward = across(axis, STEPS[axis]).w;
  const best = new Map<string, number>();
  for (const key of shape) {
    const { u, v, w } = across(axis, parseVoxel(key));
    const id = `${u},${v}`;
    const held = best.get(id);
    if (held === undefined || (outward > 0 ? w > held : w < held)) {
      best.set(id, w);
    }
  }
  return best;
}

/**
 * What a sweep between two faces of the same orientation takes hold of.
 *
 * The rectangle is measured in the plane of the face rather than on the
 * ground, which is the whole point: a sweep up the side of a tower covers a
 * run of levels, and one across its roof covers a patch of spaces. Positions
 * with nothing exposed at them are simply left out, so an irregular wall
 * stays irregular.
 */
export function facePatch(
  shape: VoxelSet,
  axis: AxisId,
  from: Voxel,
  to: Voxel,
): Patch {
  const a = across(axis, from);
  const b = across(axis, to);
  const u0 = Math.min(a.u, b.u);
  const u1 = Math.max(a.u, b.u);
  const v0 = Math.min(a.v, b.v);
  const v1 = Math.max(a.v, b.v);
  if ((u1 - u0 + 1) * (v1 - v0 + 1) > MAX_VOXELS) {
    return { voxels: [], virtual: false, facing: axis };
  }

  const best = exposed(shape, axis);
  const voxels: Voxel[] = [];
  for (let u = u0; u <= u1; u++) {
    for (let v = v0; v <= v1; v++) {
      const w = best.get(`${u},${v}`);
      if (w !== undefined) voxels.push(rebuild(axis, u, v, w));
    }
  }
  return { voxels, virtual: false, facing: axis };
}

/**
 * Pull the held face, and hand back the shape and the face that leaves.
 *
 * Three things can happen, and which one it is falls out of what is already
 * there rather than out of a mode the user has to pick:
 *
 * - A **plate** becomes solid as it is pulled. The first step lays the
 *   selected spaces themselves down, so one step up and one step down are the
 *   same single layer and every further step goes the way it was pulled.
 * - A face pulled **away** from the solid adds spaces ahead of it.
 * - A face pulled **into** the solid takes them away, which is what makes a
 *   face pushed back the way it came undo itself. Only when *every* space
 *   ahead of the face is occupied: a top face pulled sideways off the edge of
 *   a block is someone growing the block, not carving it.
 */
export function extrude(
  state: ExtrudeState,
  axis: AxisId,
  steps: number,
): ExtrudeState {
  const held = state.patch.voxels;
  if (steps < 1 || held.length === 0) return state;

  const step = STEPS[axis];
  const shape = new Set(state.shape);

  if (state.patch.virtual) {
    const reach = clampSteps(steps, shape.size, held.length);
    if (reach < 1) return state;
    for (const v of held) {
      for (let k = 0; k < reach; k++) shape.add(voxelKey(offset(v, step, k)));
    }
    return { shape, patch: faceAt(held, step, reach - 1, axis) };
  }

  const carve = held.every((v) => shape.has(voxelKey(offset(v, step, 1))));
  if (!carve) {
    const reach = clampSteps(steps, shape.size, held.length);
    if (reach < 1) return state;
    for (const v of held) {
      for (let k = 1; k <= reach; k++) shape.add(voxelKey(offset(v, step, k)));
    }
    return { shape, patch: faceAt(held, step, reach, axis) };
  }

  for (const v of held) {
    for (let k = 0; k < steps; k++) shape.delete(voxelKey(offset(v, step, k)));
  }
  const exposed = held
    .map((v) => offset(v, step, steps))
    .filter((v) => shape.has(voxelKey(v)));
  if (exposed.length) return { shape, patch: { voxels: exposed, virtual: false, facing: axis } };
  // Carved right through: leave the user holding whatever is still standing
  // on those spaces, or the bare ground where nothing is.
  return { shape, patch: surfacePatch(shape, held.map((v) => ({ cx: v.cx, cy: v.cy }))) };
}

function faceAt(held: readonly Voxel[], step: Voxel, k: number, axis: AxisId): Patch {
  return { voxels: held.map((v) => offset(v, step, k)), virtual: false, facing: axis };
}

/**
 * However far the finger went, only what still fits under the ceiling.
 *
 * Zero when there is no room left, and the pull is then refused outright
 * rather than rounded up to one more step — otherwise every further drag
 * would add another plate's worth past a ceiling that is there to bound the
 * work a pointer move can ask for.
 */
function clampSteps(steps: number, size: number, plate: number): number {
  return Math.min(steps, Math.floor((MAX_VOXELS - size) / plate));
}

/** One face of one voxel, as the world-space quad that draws it. */
export interface Face {
  points: Point[];
  /** Which of the three surfaces it is, so the renderer can shade it. */
  shade: "top" | "right" | "left";
  /** Painter's key: the larger draws later, nearer the viewer. */
  depth: number;
  /**
   * The voxel it belongs to, and which of its sides this is.
   *
   * Which is what makes this list a hit-test as well as a drawing: walked
   * front to back, the first face containing a point is the one the user can
   * see there, so picking asks the same question the screen already answered.
   * The axis comes with it because a face is only half-identified by the
   * voxel — the wall you clicked and the roof above it are different things
   * to take hold of.
   */
  voxel: Voxel;
  axis: AxisId;
  /** Whether it faces away from this camera: only X-ray mode draws these. */
  rear: boolean;
}

/**
 * The three sides that face away from this fixed camera.
 *
 * Every voxel has six, and three of them — the walls towards `-cx` and `-cy`
 * and the underside — are behind the solid from here. They are never drawn in
 * the ordinary view and never exported, but they are real faces of the shape
 * and there is no other way to pull the far side of a box outward, which is
 * what backface mode is for.
 */
export function isRear(axis: AxisId): boolean {
  return axis === "-cx" || axis === "-cy" || axis === "-z";
}

/** Which of the three shades a side takes. Opposite walls share one. */
export function shadeFor(axis: AxisId): "top" | "right" | "left" {
  if (axis === "+z" || axis === "-z") return "top";
  return axis === "+cx" || axis === "-cx" ? "right" : "left";
}

function lift(points: readonly Point[], level: number, height: number): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y - level * height }));
}

/**
 * The quad on one side of one voxel.
 *
 * On a projection with no height every face is the space itself, which is
 * what makes an orthogonal extrusion a patch of filled ground rather than a
 * stack of zero-height walls.
 */
export function faceOf(grid: Grid, v: Voxel, axis: AxisId): Point[] {
  const height = levelHeight(grid);
  const poly = grid.cellPolygon(v);
  if (height === 0) return poly;
  if (axis === "+z") return lift(poly, v.cz + 1, height);
  if (axis === "-z") return lift(poly, v.cz, height);

  const [i, j] = EDGES[axis];
  const a = poly[i];
  const b = poly[j];
  return [
    { x: a.x, y: a.y - (v.cz + 1) * height },
    { x: b.x, y: b.y - (v.cz + 1) * height },
    { x: b.x, y: b.y - v.cz * height },
    { x: a.x, y: a.y - v.cz * height },
  ];
}

/**
 * Every exposed face of the shape, back to front.
 *
 * A face is emitted only where there is no neighbour against it, so an
 * interior face costs nothing. The sort is `cx + cy + cz` ascending: step once
 * along the view ray and all three rise together, so a voxel in front of
 * another always sorts after it. Within one voxel the order is rear walls,
 * front walls, then the top it sits under — which is why the three groups get
 * a half-step either side of the voxel's own depth.
 *
 * Ordinarily only three of a voxel's six sides are wanted: the top and the
 * walls towards `+cx` and `+cy`, which are the ones this camera can see.
 * `includeRear` adds the other three, for X-ray mode and for nothing else —
 * Apply rasterises the ordinary view, so it must never ask for them. A flat
 * projection has none to add: its spaces have no sides, so there is nothing
 * behind them to reach.
 */
export function shapeFaces(
  grid: Grid,
  shape: VoxelSet,
  includeRear = false,
): Face[] {
  const solid = levelHeight(grid) > 0;
  const faces: Face[] = [];

  const add = (v: Voxel, axis: AxisId, depth: number): void => {
    const step = STEPS[axis];
    if (shape.has(voxelKey(offset(v, step, 1)))) return;
    faces.push({
      points: faceOf(grid, v, axis),
      shade: shadeFor(axis),
      depth,
      voxel: v,
      axis,
      rear: isRear(axis),
    });
  };

  for (const key of shape) {
    const v = parseVoxel(key);
    const depth = v.cx + v.cy + v.cz;
    // Only where there is height. A flat extrusion is a patch of ground with
    // nothing behind it, so its "rear" faces are the same squares again.
    if (includeRear && solid) {
      add(v, "-cx", depth - 0.5);
      add(v, "-cy", depth - 0.5);
      add(v, "-z", depth - 0.5);
    }
    if (solid) {
      add(v, "+cx", depth);
      add(v, "+cy", depth);
    }
    add(v, "+z", depth + 0.5);
  }
  return faces.sort((a, b) => a.depth - b.depth);
}

/** The held face, as the polygons that outline it. */
export function patchFaces(grid: Grid, patch: Patch): Point[][] {
  // A plate is the ground it was selected on, so it draws where the grid is
  // rather than a level up.
  const axis = patch.virtual ? "-z" : patch.facing;
  return patch.voxels.map((v) => faceOf(grid, v, axis));
}

/**
 * The world-space box around the whole solid.
 *
 * Taken from every voxel rather than from the visible faces: the underside of
 * the lowest layer is never drawn, and a box that stopped at what is drawn
 * would clip it off the bottom of the exported PSD.
 */
export function shapeBounds(grid: Grid, shape: VoxelSet): Rect | null {
  const height = levelHeight(grid);
  const points: Point[] = [];
  for (const key of shape) {
    const v = parseVoxel(key);
    const poly = grid.cellPolygon(v);
    points.push(...lift(poly, v.cz, height), ...lift(poly, v.cz + 1, height));
  }
  return points.length ? pointsBounds(points) : null;
}

/**
 * The same solid, moved bodily across the grid.
 *
 * What a placement that has been dragged since it was applied needs: the
 * voxels were written against the space the artwork was anchored to, and
 * reopening it has to put them back under the artwork wherever it now is.
 */
export function translateShape(shape: VoxelSet, by: Cell): Set<string> {
  const moved = new Set<string>();
  for (const key of shape) {
    const v = parseVoxel(key);
    moved.add(voxelKey({ cx: v.cx + by.cx, cy: v.cy + by.cy, cz: v.cz }));
  }
  return moved;
}

/** The grid spaces the solid stands on — its footprint, one entry each. */
export function shapeCells(shape: VoxelSet): Cell[] {
  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const key of shape) {
    const v = parseVoxel(key);
    const id = `${v.cx},${v.cy}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cells.push({ cx: v.cx, cy: v.cy });
  }
  return cells;
}

/** What the bottom bar says about the shape, in the units the project uses. */
export function describeShape(grid: Grid, shape: VoxelSet): string {
  if (shape.size === 0) return "nothing yet";
  const spaces = shapeCells(shape).length;
  const footprint = `${spaces} ${spaces === 1 ? "space" : "spaces"}`;
  if (levelHeight(grid) === 0) return footprint;

  let low = Infinity;
  let high = -Infinity;
  for (const key of shape) {
    const { cz } = parseVoxel(key);
    low = Math.min(low, cz);
    high = Math.max(high, cz);
  }
  const levels = high - low + 1;
  return `${footprint} · ${levels} ${levels === 1 ? "level" : "levels"}`;
}
