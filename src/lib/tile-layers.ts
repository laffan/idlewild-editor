/**
 * What a tile layer holds, and the edits that put something on one.
 *
 * `layer-kinds.ts`'s fourth section, in a file of its own because a tile
 * layer is the one kind whose payload is not ours: `Layer.tiles` is a Tiled
 * tile layer and `GameDoc.tilesets` is Tiled's tileset array, both verbatim
 * — see `lib/tiled/`. So the functions over them are about *the document's*
 * relationship to those records, which is a different subject from a
 * pattern's rule or a backdrop's two colours, and putting it next door keeps
 * both files under the line limit.
 *
 * What there is to *pick from* is next door in `tile-palettes.ts`, split off
 * when the two together went over the line limit: this file is about what is
 * standing on the ground — stamps, the writes a gesture makes, and the spaces
 * a tile is in — and that one is about `GameDoc.tilesets`, which is where a
 * tile's number points. The dependency runs this way only.
 *
 * Everything here writes through `DocStore.editLayer` and `DocStore.editDoc`,
 * the same two hatches `layer-kinds.ts` and `extrusions.ts` use.
 */

import type { DocStore } from "./doc-store";
import { cellsUnderBox, type Grid } from "./grid";
import { propertyOf, tilesetsOf } from "./tile-palettes";
import {
  chunksOf,
  emptyTileLayer,
  tileAt,
  tileCount,
  writeTiles,
  type TileWrite,
} from "./tiled/chunks";
import { gidAt, tileId } from "./tiled/gid";
import {
  PSD_PROPERTY,
  type TiledTileLayer,
  type TiledTileset,
} from "./tiled/types";
import type { Cell, Layer, Projection, Rect } from "./types";

/**
 * Whether this project can have tile layers at all.
 *
 * A tileset is a picture cut into equal spaces, and a blank project has no
 * spaces to cut on: its cells are single world pixels, which would make every
 * tile one pixel square and the palette a photograph of itself. So the kind
 * is offered on the two projections that have a lattice and withheld on the
 * one that does not — withheld rather than broken, which is the same call the
 * New Project sheet makes about isometric platformers.
 */
export function tileLayersAllowed(projection: Projection): boolean {
  return projection === "isometric" || projection === "orthogonal";
}

/**
 * A layer's tiles, filled in.
 *
 * A tile layer that has never been painted on has no `tiles` at all, the way
 * a pattern layer that has never been touched has no `pattern`. Every reader
 * asks for this rather than writing `?? empty` at each call site.
 */
export function tileLayer(layer: Layer | undefined): TiledTileLayer {
  return layer?.tiles ?? emptyTileLayer(1, layer?.name ?? "Tiles");
}

/**
 * Put tiles down on a layer, or take them off. One write for one gesture.
 *
 * **Nothing at all when nothing moved**, and the check is here rather than
 * inside `editLayer`: `writeTiles` answers by identity when a write changed
 * no space, and committing anyway would put a document on the undo stack
 * that is indistinguishable from the one under it. A paint drag writes on
 * every pointer move and crosses ground it has already covered on most of
 * them, so this is the common case rather than the careful one.
 */
export function paintTiles(
  store: DocStore,
  layerId: string,
  writes: readonly TileWrite[],
): void {
  if (writes.length === 0) return;
  const layer = store.layer(layerId);
  if (!layer) return;
  const before = tileLayer(layer);
  const after = writeTiles(before, writes);
  if (after === before && layer.tiles) return;
  store.editLayer(layerId, (held) => ({ ...held, tiles: after }));
}

/**
 * A rectangular run of a tileset's tiles, as picked in the palette.
 *
 * Rectangular because that is what Tiled's own palette hands its tools, and
 * because a stamp has to have a shape: what is selected is laid down in the
 * same arrangement it was picked up in, so an L-shaped selection would have
 * to decide what the missing corner does to the ground under it.
 */
export interface TileStamp {
  /** The tileset the run was picked from, by its `firstgid`. */
  firstgid: number;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Whether a stamp has anything in it. */
export function stampIsEmpty(stamp: TileStamp | null): boolean {
  return !stamp || stamp.cols < 1 || stamp.rows < 1;
}

/**
 * The whole run, laid down as one stamp.
 *
 * **A stamp is the run, not a tile of it.** Picking a 3 × 2 patch of palette
 * and tapping once puts all six tiles down, their top-left corner on the
 * space under the pointer — which is what the word means, what Tiled does,
 * and the only reading under which picking a corner piece and its two
 * neighbours is a useful thing to do. The first version laid one tile per
 * space and wrapped through the run as the pointer crossed the ground, so a
 * tap put down a sixth of what was in hand.
 *
 * **Along a drag it tiles seamlessly**, and that falls out of the same rule
 * rather than being a second one: the block's corner is snapped to a lattice
 * of the run's own size, anchored at the space the gesture began on. Every
 * press lands a whole block, neighbouring blocks meet exactly, and crossing
 * the same ground twice writes the same thing.
 *
 * Empty spaces in the run are left out rather than written as zeroes: a run
 * dragged past the edge of a palette should stamp the tiles it caught, not
 * punch holes with the rest.
 */
export function stampWrites(
  tilesets: readonly TiledTileset[],
  stamp: TileStamp,
  origin: Cell,
  at: Cell,
): TileWrite[] {
  const tileset = tilesets.find((t) => t.firstgid === stamp.firstgid);
  if (!tileset || stampIsEmpty(stamp)) return [];
  const corner = blockCorner(stamp, origin, at);
  const out: TileWrite[] = [];
  for (let row = 0; row < stamp.rows; row++) {
    for (let col = 0; col < stamp.cols; col++) {
      const gid = gidAt(tileset, stamp.col + col, stamp.row + row);
      if (gid !== 0) out.push({ x: corner.cx + col, y: corner.cy + row, gid });
    }
  }
  return out;
}

/**
 * Where the block's top-left corner goes for a press on this space.
 *
 * `Math.floor` rather than a truncation, so ground left of or above the space
 * the gesture began on snaps the same way as ground right of and below it —
 * a truncating divide would put two blocks over each other at the origin.
 */
export function blockCorner(stamp: TileStamp, origin: Cell, at: Cell): Cell {
  return {
    cx: origin.cx + Math.floor((at.cx - origin.cx) / stamp.cols) * stamp.cols,
    cy: origin.cy + Math.floor((at.cy - origin.cy) / stamp.rows) * stamp.rows,
  };
}

/**
 * The run tiled over a rectangle of ground — what a solid sweep fills with.
 *
 * Repeated from the rectangle's own top-left corner, so two sweeps over the
 * same ground come out aligned the same way. One tile per space here rather
 * than a block per space: what is being asked for is a *field* of the run,
 * and a block laid on every space would write each of them `cols × rows`
 * times over.
 */
export function stampRange(
  tilesets: readonly TiledTileset[],
  stamp: TileStamp,
  from: Cell,
  to: Cell,
): TileWrite[] {
  const left = Math.min(from.cx, to.cx);
  const right = Math.max(from.cx, to.cx);
  const top = Math.min(from.cy, to.cy);
  const bottom = Math.max(from.cy, to.cy);
  const out: TileWrite[] = [];
  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) {
      const gid = tiledGid(tilesets, stamp, { cx: left, cy: top }, { cx, cy });
      if (gid !== 0) out.push({ x: cx, y: cy, gid });
    }
  }
  return out;
}

/**
 * Which tile of the run belongs on a space, when the run is being *tiled*
 * rather than stamped.
 *
 * `%` is signed in JavaScript, so ground left of or above the origin needs
 * the second modulo to come back positive — without it the index is negative
 * and the space gets nothing at all.
 */
export function tiledGid(
  tilesets: readonly TiledTileset[],
  stamp: TileStamp,
  origin: Cell,
  at: Cell,
): number {
  const tileset = tilesets.find((t) => t.firstgid === stamp.firstgid);
  if (!tileset || stampIsEmpty(stamp)) return 0;
  const dx = (((at.cx - origin.cx) % stamp.cols) + stamp.cols) % stamp.cols;
  const dy = (((at.cy - origin.cy) % stamp.rows) + stamp.rows) % stamp.rows;
  return gidAt(tileset, stamp.col + dx, stamp.row + dy);
}

/**
 * The tiles a dragged box caught.
 *
 * `cellsUnderBox` is the same function the marquee's own hit-testing uses, so
 * what is caught is exactly the ground the box covered — a diamond of the
 * lattice on an isometric project rather than the rectangle that was dragged.
 *
 * **Only spaces that hold something.** A tile layer's whole subject is what
 * is standing on it, so catching the empty ground between two tiles would be
 * a selection of nothing wearing an outline — and moving it would carry a
 * hole across the map.
 */
export function tilesUnderBox(
  layer: Layer | undefined,
  grid: Grid,
  box: Rect,
): Cell[] {
  if (!layer?.tiles) return [];
  const held = tileLayer(layer);
  return cellsUnderBox(grid, box).filter(
    (cell) => tileAt(held, cell.cx, cell.cy) !== 0,
  );
}

/**
 * Take a run of tiles off the layer — what Delete does to a selection.
 *
 * A gid of 0 is an empty space, so erasing is the same write as painting with
 * nothing in hand: one call, one step, and the chunks that end up empty are
 * dropped on the way out. See `writeTiles`.
 */
export function eraseTiles(
  store: DocStore,
  layerId: string,
  cells: readonly Cell[],
): void {
  paintTiles(
    store,
    layerId,
    cells.map((cell) => ({ x: cell.cx, y: cell.cy, gid: 0 })),
  );
}

/**
 * Carry a run of tiles to another patch of ground.
 *
 * **Read first, then clear, then write**, and the order is the whole of it: a
 * move whose source and destination overlap — which every drag of one space
 * is — would otherwise clear tiles it had already written. The gids are
 * lifted into a list before anything is touched, so the three steps are one
 * write and the overlap takes care of itself.
 *
 * One step of undo, because it is one thing somebody did.
 */
export function moveTiles(
  store: DocStore,
  layerId: string,
  cells: readonly Cell[],
  by: { cx: number; cy: number },
): Cell[] {
  if (by.cx === 0 && by.cy === 0) return [...cells];
  const layer = store.layer(layerId);
  if (!layer) return [...cells];
  const held = tileLayer(layer);
  const lifted = cells.map((cell) => ({
    cell,
    gid: tileAt(held, cell.cx, cell.cy),
  }));

  const writes: TileWrite[] = lifted.map(({ cell }) => ({
    x: cell.cx,
    y: cell.cy,
    gid: 0,
  }));
  for (const { cell, gid } of lifted) {
    writes.push({ x: cell.cx + by.cx, y: cell.cy + by.cy, gid });
  }
  paintTiles(store, layerId, writes);
  return cells.map((cell) => ({ cx: cell.cx + by.cx, cy: cell.cy + by.cy }));
}

/** Every space on a layer that has something on it. */
export function tiledCells(layer: Layer | undefined): Cell[] {
  if (!layer?.tiles) return [];
  const out: Cell[] = [];
  for (const chunk of chunksOf(layer.tiles)) {
    for (let i = 0; i < chunk.data.length; i++) {
      if (chunk.data[i] === 0) continue;
      out.push({
        cx: chunk.x + (i % chunk.width),
        cy: chunk.y + Math.floor(i / chunk.width),
      });
    }
  }
  return out;
}

/**
 * The spaces on a layer holding tiles cut from one PSD.
 *
 * Every tileset that file was cut into, merged or separate, and every gid in
 * their blocks: a palette a file has been cut into twice is two blocks of
 * numbers and the tiles standing on either of them are that file's.
 *
 * What asks is the moment the file **leaves the layer** — carried to another
 * one in the layer panel, or taken off it outright. A tile is a number and a
 * number means the nth tile across every tileset in the map, so the tiles do
 * not become wrong when the file goes; they become *orphans*, drawing from a
 * palette whose artwork nothing on this layer loads any more. The document
 * still describes them perfectly and the canvas draws nothing, which is the
 * worst of the two possible wrongs.
 */
export function tilesFromPsd(
  store: DocStore,
  layerId: string,
  psdKey: string,
): Cell[] {
  const layer = store.layer(layerId);
  if (!layer?.tiles) return [];
  const blocks = tilesetsOf(store)
    .filter((tileset) => propertyOf(tileset, PSD_PROPERTY) === psdKey)
    .map((tileset) => ({
      from: tileset.firstgid,
      to: tileset.firstgid + tileset.tilecount,
    }));
  if (blocks.length === 0) return [];

  const out: Cell[] = [];
  for (const chunk of chunksOf(layer.tiles)) {
    for (let i = 0; i < chunk.data.length; i++) {
      const gid = chunk.data[i];
      if (gid === 0) continue;
      // The flags, off: a flipped tile is the same tile, and a gid compared
      // with them still on is a number in nobody's block.
      const id = tileId(gid);
      if (!blocks.some((block) => id >= block.from && id < block.to)) continue;
      out.push({
        cx: chunk.x + (i % chunk.width),
        cy: chunk.y + Math.floor(i / chunk.width),
      });
    }
  }
  return out;
}

/** What the layer row says under a tile layer's name. */
export function describeTiles(layer: Layer): string {
  const n = tileCount(layer.tiles);
  return `${n} ${n === 1 ? "tile" : "tiles"}`;
}
