/**
 * Global tile ids: the number in a tile layer's data, and what is packed into
 * it.
 *
 * A gid is not an index. The low 28 bits are a tile's id **across every
 * tileset in the map**, offset by the tileset's `firstgid`; the top four are
 * flags saying the tile is flipped or turned. Zero means the space is empty,
 * which is why every emptiness test in this feature is `gid === 0` rather
 * than a null.
 *
 * That packing is the whole reason this file exists rather than a couple of
 * inline masks. `0x80000000` does not fit in a signed 32-bit integer, so
 * every operation here goes through `>>> 0` to come back unsigned —
 * JavaScript's bitwise operators work on signed 32-bit values and a flipped
 * tile read without it is a large negative number that matches no tileset.
 */

import type { TiledTileset } from "./types";

export const FLIPPED_HORIZONTALLY = 0x80000000;
export const FLIPPED_VERTICALLY = 0x40000000;
export const FLIPPED_DIAGONALLY = 0x20000000;
export const ROTATED_HEXAGONAL_120 = 0x10000000;

/** Every flag at once, which is what clearing them masks against. */
const ALL_FLAGS =
  (FLIPPED_HORIZONTALLY |
    FLIPPED_VERTICALLY |
    FLIPPED_DIAGONALLY |
    ROTATED_HEXAGONAL_120) >>>
  0;

/** The tile this gid names, with the four flags taken off. */
export function tileId(gid: number): number {
  return (gid & ~ALL_FLAGS) >>> 0;
}

/** The four flags on their own, ready to put back on another tile. */
export function tileFlags(gid: number): number {
  return (gid & ALL_FLAGS) >>> 0;
}

/** A gid from a tile and a set of flags. */
export function withFlags(id: number, flags: number): number {
  return ((id & ~ALL_FLAGS) | (flags & ALL_FLAGS)) >>> 0;
}

/**
 * The tileset a gid belongs to: the one with the largest `firstgid` that is
 * still no larger than the gid.
 *
 * Tiled's own rule, and it is a search rather than an index because a map's
 * tilesets are not required to be in order and a set removed from the middle
 * leaves a gap rather than renumbering everything after it.
 */
export function tilesetForGid(
  tilesets: readonly TiledTileset[],
  gid: number,
): TiledTileset | undefined {
  const id = tileId(gid);
  if (id === 0) return undefined;
  let found: TiledTileset | undefined;
  for (const tileset of tilesets) {
    if (tileset.firstgid > id) continue;
    if (!found || tileset.firstgid > found.firstgid) found = tileset;
  }
  return found;
}

/** Where a tile sits in its tileset's image, in columns and rows. */
export interface TileCell {
  col: number;
  row: number;
}

/** The local id of a gid within its own tileset, or null if it has none. */
export function localId(
  tilesets: readonly TiledTileset[],
  gid: number,
): { tileset: TiledTileset; id: number } | null {
  const tileset = tilesetForGid(tilesets, gid);
  if (!tileset) return null;
  return { tileset, id: tileId(gid) - tileset.firstgid };
}

/**
 * The patch of a tileset's image one local id names.
 *
 * `spacing` and `margin` are the gutters a tileset cut by another program may
 * carry; both are zero for a tileset this editor makes, because a PSD placed
 * on a tile layer is divided on the project's own grid boundaries with
 * nothing between the spaces.
 */
export function tileRect(
  tileset: TiledTileset,
  id: number,
): { x: number; y: number; width: number; height: number } {
  const col = tileset.columns > 0 ? id % tileset.columns : 0;
  const row = tileset.columns > 0 ? Math.floor(id / tileset.columns) : 0;
  return {
    x: tileset.margin + col * (tileset.tilewidth + tileset.spacing),
    y: tileset.margin + row * (tileset.tileheight + tileset.spacing),
    width: tileset.tilewidth,
    height: tileset.tileheight,
  };
}

/** The gid of the tile at a column and row of a tileset. */
export function gidAt(tileset: TiledTileset, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= tileset.columns) return 0;
  const id = row * tileset.columns + col;
  if (id >= tileset.tilecount) return 0;
  return (tileset.firstgid + id) >>> 0;
}

/**
 * How many tiles fit across and down an image cut at this size.
 *
 * The floor rather than the ceiling, both ways: a strip of image narrower
 * than a whole tile is not a tile, and a tileset whose last column is half
 * there would hand the renderer a frame running off the edge of the texture.
 */
export function tileGrid(
  imagewidth: number,
  imageheight: number,
  tilewidth: number,
  tileheight: number,
  spacing = 0,
  margin = 0,
): { columns: number; rows: number } {
  const across = imagewidth - margin * 2 + spacing;
  const down = imageheight - margin * 2 + spacing;
  const columns = Math.max(0, Math.floor(across / (tilewidth + spacing)));
  const rows = Math.max(0, Math.floor(down / (tileheight + spacing)));
  return { columns, rows };
}
