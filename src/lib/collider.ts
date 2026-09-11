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
 *   only its artwork to go on, so the default is the spaces its *base* covers.
 *   Under an orthogonal template that is the whole picture, which is what a
 *   sprite on a square grid occupies. Under an isometric one it is the bottom
 *   tile-height of it, for the same reason the extrusion rule is about level
 *   zero: up the screen is away, so the spaces the top of a tall sprite
 *   crosses are the spaces *behind* it rather than the ground it stands on.
 */

import { parseVoxel } from "./extrude";
import { cellKey, cellsUnderBox, Grid, pointsBounds } from "./grid";
import type {
  Cell,
  Collider,
  Extrusion,
  Layer,
  Placement,
  Point,
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

  const cells = groundCells(grid, box);
  if (cells.length > MAX_COLLIDER_CELLS) {
    return boxCollider(box, grid.cellToWorld(anchor));
  }
  return { cells: cells.map((cell) => offsetOf(cell, anchor)), blocking: true };
}

/**
 * The spaces a flat picture stands on.
 *
 * Every space it is drawn over, on a square grid: a sprite there occupies
 * what it covers, and a side-on project wants its full height as ground
 * anyway.
 *
 * On a diamond grid, the spaces under its **base**. The projection puts
 * *away* up the screen, so a 64 × 96 tower drawn over a 64 × 32 tile sweeps
 * its bounding box across fourteen diamonds, twelve of which are the hillside
 * behind it. Taking the bottom tile-height of the picture is the flat-artwork
 * reading of the rule an extrusion gets exactly: the ground it rests on, not
 * the air it occupies.
 *
 * Within that strip a space counts when its **middle** is under the artwork,
 * rather than when the two merely overlap. A diamond the base clips a corner
 * off is a space beside the tower, and blocking it is what makes a character
 * stop a tile short of everything. The middle can miss every space — a small
 * picture dropped between four of them — so the space under the middle of the
 * base is the floor, and a collider is never empty for want of a rounding.
 */
function groundCells(grid: Grid, box: Rect): Cell[] {
  if (grid.projection !== "isometric") return cellsUnderBox(grid, box);

  const height = Math.min(box.height, grid.tileHeight);
  const base: Rect = {
    x: box.x,
    y: box.y + box.height - height,
    width: box.width,
    height,
  };

  const standing = cellsUnderBox(grid, base).filter((cell) =>
    inside(base, grid.cellCentre(cell)),
  );
  if (standing.length > 0) return standing;
  return [
    grid.worldToCell({
      x: base.x + base.width / 2,
      y: base.y + base.height / 2,
    }),
  ];
}

/** Strictly inside, so a middle on the base's own edge is not under it. */
function inside(rect: Rect, p: Point): boolean {
  return (
    p.x > rect.x &&
    p.x < rect.x + rect.width &&
    p.y > rect.y &&
    p.y < rect.y + rect.height
  );
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
 * One placed unit of a PSD: the placements it is made of, and the space they
 * hang from.
 *
 * The first one found, in layer order. A collider is a fact about the file
 * rather than about any one placement of it, so where two copies of a PSD
 * disagree about their own size the first is as good an answer as the second
 * — and both of them are the same artwork.
 */
export function unitOfKey(
  layers: readonly Layer[],
  key: string,
): { anchor: Cell; placements: Placement[] } | null {
  for (const layer of layers) {
    const first = layer.placements.find((p) => p.psdKey === key);
    if (!first) continue;
    const unit = first.instance ?? first.id;
    return {
      anchor: first.anchor,
      placements: layer.placements.filter(
        (p) => p.psdKey === key && (p.instance ?? p.id) === unit,
      ),
    };
  }
  return null;
}

/**
 * What a key blocks, whether or not the document has been told yet.
 *
 * Every placed key has a record in practice — one is written when the PSD
 * lands and backfilled on open — but "in practice" is not a thing a panel can
 * be written against: it would mean an inspector with nothing to show, and a
 * toggle with nothing to toggle, in exactly the moment somebody first goes
 * looking for the collider. So the default is derived on demand here as well
 * as written, and the two agree because they are the same function.
 */
export function resolveCollider(
  grid: Grid,
  layers: readonly Layer[],
  colliders: Record<string, Collider> | undefined,
  key: string,
  extrusion?: Extrusion,
): Collider {
  const held = colliders?.[key];
  if (held) return held;
  const unit = unitOfKey(layers, key);
  return defaultCollider(
    grid,
    unit?.anchor ?? { cx: 0, cy: 0 },
    placementsBox(unit?.placements ?? []),
    extrusion,
  );
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
