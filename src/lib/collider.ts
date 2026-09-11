/**
 * What a placed PSD blocks.
 *
 * Until this existed the only thing in a document that stopped a character
 * was a fill marked not-walkable or a boundary drawn by hand: every image on
 * the grid was scenery, and a tower was something to walk through. A collider
 * is the missing half — the grid spaces a file occupies as far as the game is
 * concerned, kept beside the artwork rather than derived from its pixels.
 *
 * It is stored per PSD key and in **offsets from the anchor** — see
 * `Collider` in `types.ts` for why both. Everything here is the arithmetic
 * that takes it from that form into the two shapes play mode wants: a set of
 * cells for a top-down character to route around, and a list of world boxes
 * for a side-on one to stand on.
 *
 * The defaults are the point of the file. A collider nobody has touched
 * should already be the right answer for most things, and what "right" means
 * differs by how the PSD was made:
 *
 * - **An extrusion** is a solid whose shape is known exactly, so the default
 *   follows the same 3D logic the mode is built on: the spaces its voxels
 *   rest on at ground level. Under an isometric template that is the blocks
 *   which touch the ground — a bridge pulled up and out over a road blocks
 *   its piers rather than the road. Under an orthogonal one every voxel is at
 *   level zero already, so the whole shape is a collider and nothing needed a
 *   second rule to say so.
 * - **Anything else** — an import, a converted sketch, a converted fill — has
 *   only its artwork to go on, so the default is the spaces that artwork
 *   covers, which is what the footprint mark in the file already says.
 */

import { parseVoxel } from "./extrude";
import { cellKey, cellsUnderBox, Grid, pointsBounds } from "./grid";
import type {
  Cell,
  Collider,
  Extrusion,
  Layer,
  Placement,
  Rect,
} from "./types";

/**
 * A ceiling on the spaces one collider may hold.
 *
 * The same argument the extrusion ceiling makes: a default is derived from a
 * box that somebody may have resized to the width of a continent, and a
 * hundred thousand blocked cells is a document nobody can play and a save
 * nobody can read. Past this the collider falls back to the box itself.
 */
export const MAX_COLLIDER_CELLS = 4_096;

/** The ground level a voxel has to touch to count as standing on it. */
const GROUND_LEVEL = 0;

/** A collider that blocks the whole of what the artwork covers. */
export function boxCollider(box: Rect, anchorWorld: { x: number; y: number }): Collider {
  return {
    cells: [],
    rect: {
      x: box.x - anchorWorld.x,
      y: box.y - anchorWorld.y,
      width: box.width,
      height: box.height,
    },
    blocking: true,
  };
}

/**
 * What a PSD blocks before anyone says otherwise.
 *
 * Blocking, in every case. A placed thing being solid is the assumption that
 * makes the toggle in the inspector worth having — a document where nothing
 * collides until each file is visited one at a time is the state this feature
 * exists to end — and it is the same default a fresh fill takes.
 *
 * @param extrusion the solid behind the key, when it has one.
 * @param box the world-space box the artwork covers, for when it does not.
 * @param anchor the space the artwork hangs from: what the offsets are from.
 */
export function defaultCollider(
  grid: Grid,
  anchor: Cell,
  box: Rect | null,
  extrusion?: Extrusion,
): Collider {
  // No lattice to block spaces on: a blank project's cells are single world
  // pixels, so the collider that means anything is the box itself.
  if (!grid.snaps) {
    return box
      ? boxCollider(box, grid.cellToWorld(anchor))
      : { cells: [], blocking: true };
  }

  if (extrusion) {
    return { cells: groundOffsets(extrusion, anchor), blocking: true };
  }
  if (!box) return { cells: [], blocking: true };

  const cells = cellsUnderBox(grid, box);
  if (cells.length > MAX_COLLIDER_CELLS) {
    return boxCollider(box, grid.cellToWorld(anchor));
  }
  return { cells: cells.map((cell) => offsetOf(cell, anchor)), blocking: true };
}

/**
 * The spaces an extruded solid stands on, as offsets.
 *
 * Level zero and nothing else. A shape that was pulled up into the air and
 * had its lowest spaces rubbed out has nothing at ground level, and blocks
 * nothing — which is the honest reading of an arch, and the one the mode's
 * own geometry already implies.
 */
export function groundOffsets(extrusion: Extrusion, anchor: Cell): Cell[] {
  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const key of extrusion.voxels) {
    const voxel = parseVoxel(key);
    if (voxel.cz !== GROUND_LEVEL) continue;
    const id = `${voxel.cx},${voxel.cy}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // The voxels were written against the extrusion's own anchor; the
    // collider is measured from the artwork's, and Apply writes both at once
    // so the two agree at the moment this is derived.
    cells.push(offsetOf(voxel, extrusion.anchor));
  }
  // Anchors differ only when this is called for a shape that has since been
  // carried across the grid; shifting by the difference keeps it under its
  // own artwork either way.
  if (anchor.cx === extrusion.anchor.cx && anchor.cy === extrusion.anchor.cy) {
    return cells;
  }
  const dx = extrusion.anchor.cx - anchor.cx;
  const dy = extrusion.anchor.cy - anchor.cy;
  return cells.map((c) => ({ cx: c.cx + dx, cy: c.cy + dy }));
}

function offsetOf(cell: Cell, anchor: Cell): Cell {
  return { cx: cell.cx - anchor.cx, cy: cell.cy - anchor.cy };
}

/** The spaces a collider blocks, where its placement actually stands. */
export function colliderCells(collider: Collider, anchor: Cell): Cell[] {
  return collider.cells.map((cell) => ({
    cx: cell.cx + anchor.cx,
    cy: cell.cy + anchor.cy,
  }));
}

/**
 * The same, in world pixels: one box per space, or the one box a collider on
 * a blank project is.
 *
 * Boxes rather than outlines because both consumers want boxes — a
 * platformer stands on rectangles, and a top-down character asks whether a
 * cell centre falls inside one. The diamond of an isometric space is
 * reduced to its bounding box for the platformer's sake, which is the same
 * reduction a non-walkable fill already goes through there.
 */
export function colliderBoxes(
  grid: Grid,
  collider: Collider,
  anchor: Cell,
): Rect[] {
  if (collider.rect) {
    const world = grid.cellToWorld(anchor);
    return [
      {
        x: collider.rect.x + world.x,
        y: collider.rect.y + world.y,
        width: collider.rect.width,
        height: collider.rect.height,
      },
    ];
  }
  return colliderCells(collider, anchor).map((cell) =>
    pointsBounds(grid.cellPolygon(cell)),
  );
}

/** What a collider blocks, said the way the inspector says it. */
export function describeCollider(grid: Grid, collider: Collider): string {
  if (collider.rect) {
    return `${Math.round(collider.rect.width)} × ${Math.round(
      collider.rect.height,
    )} px`;
  }
  const n = collider.cells.length;
  if (n === 0) return grid.snaps ? "no spaces" : "nothing";
  return `${n} ${n === 1 ? "space" : "spaces"}`;
}

/** One placed PSD's collider, where it stands. */
export interface PlacedCollider {
  key: string;
  anchor: Cell;
  collider: Collider;
}

/**
 * Every collider the document currently has on the grid.
 *
 * One per *unit*, not per placement: a PSD with three layers is three
 * placements sharing one anchor, and counting its collider three times would
 * be three copies of the same box in a platformer's solid list. Hidden
 * layers are left out, the same rule fills and boundaries follow — a layer
 * turned off is not in the game.
 *
 * A key with no record blocks nothing. That is the state a document written
 * before colliders existed opens in, for the half-second before the scene's
 * migration fills the defaults in, and it is the safe way round: a project
 * that has always played one way does not become unplayable between the file
 * being read and the migration running.
 */
export function documentColliders(
  layers: readonly Layer[],
  colliders: Record<string, Collider> | undefined,
  options: { includeHidden?: boolean } = {},
): PlacedCollider[] {
  if (!colliders) return [];
  const out: PlacedCollider[] = [];
  for (const layer of layers) {
    if (!layer.visible && !options.includeHidden) continue;
    const seen = new Set<string>();
    for (const placement of layer.placements) {
      const unit = placement.instance ?? placement.id;
      if (seen.has(unit)) continue;
      seen.add(unit);
      const collider = colliders[placement.psdKey];
      if (!collider || !collider.blocking) continue;
      out.push({ key: placement.psdKey, anchor: placement.anchor, collider });
    }
  }
  return out;
}

/** The blocked cells of every collider in the document, as `cx,cy` keys. */
export function blockedColliderCells(
  layers: readonly Layer[],
  colliders: Record<string, Collider> | undefined,
): Set<string> {
  const blocked = new Set<string>();
  for (const placed of documentColliders(layers, colliders)) {
    for (const cell of colliderCells(placed.collider, placed.anchor)) {
      blocked.add(cellKey(cell));
    }
  }
  return blocked;
}

/**
 * The box a unit of placements covers, which is what an unextruded PSD's
 * default collider is derived from.
 *
 * Kept here rather than reaching for `game/instance.ts` so that the default
 * can be worked out anywhere the document is — including the migration,
 * which runs before anything is on the canvas.
 */
export function placementsBox(placements: readonly Placement[]): Rect | null {
  if (placements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
