/**
 * An infinite tile layer, and the sparse patches it is really made of.
 *
 * Infinite is not a feature this feature asked Tiled for; it is the only
 * shape that fits. There is no world bound in this editor — the lattice is
 * recomputed from the camera over exactly the cells in view, and a project
 * has no edge to hit — so a tile layer with a `width` and a `height` would
 * have to name some rectangle and call it the world. Tiled had the same
 * problem and solved it with chunks, so the document holds chunks.
 *
 * A chunk is sixteen spaces square, which is Tiled's own default, aligned to
 * multiples of sixteen from the origin. A space that has never held a tile
 * is in no chunk at all, and a chunk that has been emptied is dropped rather
 * than kept as two hundred and fifty-six zeroes — which is what keeps a
 * document holding a long thin road from also holding the desert it crosses.
 *
 * **Every write replaces.** The hard rule at the top of README-TECHNICAL
 * applies here like everywhere else: `writeTiles` builds a new layer sharing
 * every chunk it did not touch, which is what makes undo a pointer copy.
 */

import type { TiledChunk, TiledTileLayer } from "./types";

/** The side of one chunk, in tiles. Tiled's default, and the one it writes. */
export const CHUNK_SIZE = 16;

/** One space and what is on it. `gid` of 0 means take whatever is there off. */
export interface TileWrite {
  x: number;
  y: number;
  gid: number;
}

/** The chunk origin covering a tile coordinate. Floors, so negatives work. */
function chunkOrigin(v: number): number {
  return Math.floor(v / CHUNK_SIZE) * CHUNK_SIZE;
}

function chunkKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** A fresh, empty tile layer — what the `+` menu's Tile layer arrives with. */
export function emptyTileLayer(id: number, name: string): TiledTileLayer {
  return {
    type: "tilelayer",
    id,
    name,
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    startx: 0,
    starty: 0,
    chunks: [],
  };
}

/**
 * The chunks of a layer, whichever way it arrived.
 *
 * A finite layer — what Tiled writes for a map with a fixed size, and what a
 * `.tmx` off somebody else's disk most often is — carries one flat `data`
 * array instead. It is cut into chunks here, once, on the way in, so that
 * everything downstream has one shape to read rather than two.
 */
export function chunksOf(layer: TiledTileLayer): readonly TiledChunk[] {
  if (layer.chunks) return layer.chunks;
  if (!layer.data) return [];
  return cut(layer.data, layer.x, layer.y, layer.width, layer.height);
}

/** A flat row-major block of gids, as the chunks covering it. */
function cut(
  data: readonly number[],
  left: number,
  top: number,
  width: number,
  height: number,
): TiledChunk[] {
  const held = new Map<string, TiledChunk>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const gid = data[row * width + col] ?? 0;
      if (gid === 0) continue;
      const x = left + col;
      const y = top + row;
      const ox = chunkOrigin(x);
      const oy = chunkOrigin(y);
      const key = chunkKey(ox, oy);
      let chunk = held.get(key);
      if (!chunk) {
        chunk = {
          x: ox,
          y: oy,
          width: CHUNK_SIZE,
          height: CHUNK_SIZE,
          data: new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(0),
        };
        held.set(key, chunk);
      }
      chunk.data[(y - oy) * CHUNK_SIZE + (x - ox)] = gid;
    }
  }
  return [...held.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A layer that is chunked, whatever it was.
 *
 * What an import runs every layer through. A finite layer keeps its gids and
 * loses its rectangle, which is the honest conversion: the rectangle was a
 * statement about a map with edges, and this one has none.
 */
export function chunked(layer: TiledTileLayer): TiledTileLayer {
  if (layer.chunks) return layer;
  const chunks = chunksOf(layer);
  const { data: _finite, ...rest } = layer;
  return withChunks(rest, chunks);
}

/** The gid on a space, or 0 where nothing has been put down. */
export function tileAt(layer: TiledTileLayer, x: number, y: number): number {
  const ox = chunkOrigin(x);
  const oy = chunkOrigin(y);
  for (const chunk of chunksOf(layer)) {
    if (chunk.x !== ox || chunk.y !== oy) continue;
    return chunk.data[(y - chunk.y) * chunk.width + (x - chunk.x)] ?? 0;
  }
  return 0;
}

/**
 * Put tiles down, or take them off, in one write.
 *
 * One call for the whole gesture rather than one per space, because a stamp
 * of a nine-tile selection and a bucket fill over a room are both *one thing
 * somebody did* — and because each call replaces the layer, so writing space
 * by space would be a hundred documents for one drag and a hundred entries in
 * the undo stack.
 *
 * Returns the layer unchanged, by identity, when nothing about it moved. That
 * is what lets a paint drag over ground it has already covered leave no step
 * behind — `UndoHistory.end` tests the group's entry by identity, which the
 * immutability rule is what buys.
 */
export function writeTiles(
  layer: TiledTileLayer,
  writes: readonly TileWrite[],
): TiledTileLayer {
  if (writes.length === 0) return layer;

  const held = new Map<string, TiledChunk>();
  for (const chunk of chunksOf(layer)) held.set(chunkKey(chunk.x, chunk.y), chunk);

  const touched = new Set<string>();
  let moved = false;

  for (const { x, y, gid } of writes) {
    const ox = chunkOrigin(x);
    const oy = chunkOrigin(y);
    const key = chunkKey(ox, oy);
    const found = held.get(key);
    if (!found && gid === 0) continue;

    const index = (y - oy) * CHUNK_SIZE + (x - ox);
    if (found && found.data[index] === gid) continue;

    // Copied on first touch rather than written through: the chunk in hand
    // may still be the one a snapshot on the undo stack is holding.
    let chunk = found;
    if (!touched.has(key)) {
      chunk = found
        ? { ...found, data: [...found.data] }
        : {
            x: ox,
            y: oy,
            width: CHUNK_SIZE,
            height: CHUNK_SIZE,
            data: new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(0),
          };
      held.set(key, chunk);
      touched.add(key);
    }
    chunk!.data[index] = gid;
    moved = true;
  }

  if (!moved) return layer;

  // A chunk emptied out is dropped rather than kept as 256 zeroes. Tiled does
  // the same, and a document that remembered every space ever rubbed out
  // would grow without bound over a long session.
  const kept = [...held.values()]
    .filter((chunk) => chunk.data.some((gid) => gid !== 0))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const { data: _finite, ...rest } = layer;
  return withChunks(rest, kept);
}

/**
 * A layer carrying these chunks, with the four numbers Tiled reports about
 * them brought into line.
 *
 * `startx`/`starty` and `width`/`height` are derived rather than stored: they
 * are a *description* of where the content is, and a description that has to
 * be maintained by hand is one that goes stale the first time a write forgets
 * it. Tiled writes them, so a file this editor produces writes them too, and
 * they are worked out here on every write instead of being trusted.
 */
function withChunks(
  layer: Omit<TiledTileLayer, "chunks">,
  chunks: readonly TiledChunk[],
): TiledTileLayer {
  if (chunks.length === 0) {
    return { ...layer, startx: 0, starty: 0, width: 0, height: 0, chunks: [] };
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const chunk of chunks) {
    left = Math.min(left, chunk.x);
    top = Math.min(top, chunk.y);
    right = Math.max(right, chunk.x + chunk.width);
    bottom = Math.max(bottom, chunk.y + chunk.height);
  }
  return {
    ...layer,
    startx: left,
    starty: top,
    width: right - left,
    height: bottom - top,
    chunks: [...chunks],
  };
}

/** Every space with something on it, inside a rectangle of tile coordinates. */
export function tilesInRange(
  layer: TiledTileLayer,
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
): TileWrite[] {
  const left = Math.min(from.cx, to.cx);
  const right = Math.max(from.cx, to.cx);
  const top = Math.min(from.cy, to.cy);
  const bottom = Math.max(from.cy, to.cy);
  const out: TileWrite[] = [];
  for (const chunk of chunksOf(layer)) {
    if (chunk.x > right || chunk.x + chunk.width <= left) continue;
    if (chunk.y > bottom || chunk.y + chunk.height <= top) continue;
    for (let row = 0; row < chunk.height; row++) {
      const y = chunk.y + row;
      if (y < top || y > bottom) continue;
      for (let col = 0; col < chunk.width; col++) {
        const x = chunk.x + col;
        if (x < left || x > right) continue;
        const gid = chunk.data[row * chunk.width + col] ?? 0;
        if (gid !== 0) out.push({ x, y, gid });
      }
    }
  }
  return out;
}

/** How many spaces on this layer have something on them. */
export function tileCount(layer: TiledTileLayer | undefined): number {
  if (!layer) return 0;
  let n = 0;
  for (const chunk of chunksOf(layer)) {
    for (const gid of chunk.data) if (gid !== 0) n++;
  }
  return n;
}
