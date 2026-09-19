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
 * Everything here writes through `DocStore.editLayer` and `DocStore.editDoc`,
 * the same two hatches `layer-kinds.ts` and `extrusions.ts` use.
 */

import type { DocStore } from "./doc-store";
import type { Grid } from "./grid";
import * as log from "./log";
import {
  chunksOf,
  emptyTileLayer,
  tileAt,
  tileCount,
  writeTiles,
  type TileWrite,
} from "./tiled/chunks";
import { gidAt, tileGrid } from "./tiled/gid";
import {
  PSD_LAYER_PROPERTY,
  PSD_PROPERTY,
  type TiledTileLayer,
  type TiledTileset,
} from "./tiled/types";
import type { Cell, Layer, Projection } from "./types";

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

/** Every tileset in the project, in the order their gids run. */
export function tilesetsOf(store: DocStore): readonly TiledTileset[] {
  return store.doc.tilesets ?? [];
}

/** The tileset made from a PSD, if this project has one. */
export function tilesetForPsd(
  store: DocStore,
  psdKey: string,
  layerPath?: string,
): TiledTileset | undefined {
  return tilesetsOf(store).find((tileset) => {
    if (propertyOf(tileset, PSD_PROPERTY) !== psdKey) return false;
    if (layerPath === undefined) return true;
    return (propertyOf(tileset, PSD_LAYER_PROPERTY) ?? "root") === layerPath;
  });
}

/** The value of one of a tileset's custom properties. */
export function propertyOf(
  tileset: TiledTileset,
  name: string,
): string | undefined {
  const held = tileset.properties?.find((p) => p.name === name);
  return typeof held?.value === "string" ? held.value : undefined;
}

/**
 * The next free `firstgid`: one past the last tile of the last set.
 *
 * Handed out rather than derived from the list's length, because a gid
 * already written on a layer means *the nth tile across every tileset in the
 * map* — so the numbers a set has been given are permanent for as long as
 * anything is standing on them, and a set added later takes the next block
 * rather than being inserted into the sequence.
 */
export function nextFirstGid(tilesets: readonly TiledTileset[]): number {
  let next = 1;
  for (const tileset of tilesets) {
    next = Math.max(next, tileset.firstgid + tileset.tilecount);
  }
  return next;
}

/** What making a tileset out of a placed PSD needs to know about it. */
export interface TilesetSource {
  /** The PSD key, which is what the palette and the renderer draw from. */
  psdKey: string;
  /** "root", or a layer path inside that PSD — the same string a placement
   *  carries, so the texture is found the same way. */
  layerPath: string;
  name: string;
  /** Where the artwork is, relative to a map written beside the project. */
  image: string;
  imagewidth: number;
  imageheight: number;
}

/**
 * Cut a PSD into a tileset on the project's own grid boundaries.
 *
 * The tile size is the grid's, which is the whole of what "divided along the
 * same boundaries as the main canvas" means: a space in the palette is a
 * space on the ground, so what is picked up is what is put down. On an
 * isometric project that is the diamond's **bounding box** — `tileWidth` by
 * `tileHeight`, 2:1 — because a picture is cut into rectangles whatever shape
 * is drawn inside them, and Tiled cuts an isometric tileset the same way.
 *
 * Returns the set already in the document. A second call for a PSD that is
 * already a tileset hands back the one that is there rather than making a
 * second: the gids standing on the first would all be wrong.
 */
export function addTileset(
  store: DocStore,
  grid: Grid,
  source: TilesetSource,
): TiledTileset {
  const held = tilesetForPsd(store, source.psdKey, source.layerPath);
  if (held) return held;

  const tilewidth = Math.max(1, Math.round(grid.tileWidth));
  const tileheight = Math.max(1, Math.round(grid.tileHeight));
  const { columns, rows } = tileGrid(
    source.imagewidth,
    source.imageheight,
    tilewidth,
    tileheight,
  );
  const made: TiledTileset = {
    firstgid: nextFirstGid(tilesetsOf(store)),
    name: source.name,
    image: source.image,
    imagewidth: source.imagewidth,
    imageheight: source.imageheight,
    tilewidth,
    tileheight,
    spacing: 0,
    margin: 0,
    columns,
    tilecount: columns * rows,
    properties: [
      { name: PSD_PROPERTY, type: "string", value: source.psdKey },
      { name: PSD_LAYER_PROPERTY, type: "string", value: source.layerPath },
    ],
  };
  addTilesets(store, [made]);
  return made;
}

/**
 * A PSD just placed on a tile layer, cut into a palette.
 *
 * What *placing* a file means depends on the kind of layer it lands on, and
 * on a tile layer it means this: the artwork divided on the project's own
 * grid boundaries, as a Tiled tileset. Every route in — a drop, a paste,
 * Import Assets, Add Image — goes through one `place`, so this is called
 * from there and nowhere else.
 *
 * `addTileset` hands back the set that is already there for a file that has
 * been cut before, so dropping the same PSD twice does not make a second
 * palette and leave every gid standing on the first one wrong.
 */
export function cutIntoTileset(
  store: DocStore,
  grid: Grid,
  layer: Layer,
  psdKey: string,
  art: { path: string; filePath?: string; width: number; height: number } | undefined,
): TiledTileset | null {
  if (!art) return null;
  const made = addTileset(store, grid, {
    psdKey,
    layerPath: art.path,
    name: psdKey,
    // Where psd-to-json put the artwork, relative to the project — what a
    // `.tmj` written beside it has to name to point at a real picture.
    image: `assets/${psdKey}/${art.filePath ?? ""}`,
    imagewidth: art.width,
    imageheight: art.height,
  });
  const rows = made.columns > 0 ? Math.round(made.tilecount / made.columns) : 0;
  log.info(
    `${psdKey}.psd is a palette on ${layer.name} — ${made.columns} × ${rows} ` +
      `tiles of ${made.tilewidth} × ${made.tileheight}`,
  );
  return made;
}

/** Put tilesets into the document, keeping the order their gids run in. */
export function addTilesets(
  store: DocStore,
  tilesets: readonly TiledTileset[],
): void {
  if (tilesets.length === 0) return;
  store.editDoc((doc) => ({
    ...doc,
    tilesets: [...(doc.tilesets ?? []), ...tilesets].sort(
      (a, b) => a.firstgid - b.firstgid,
    ),
  }));
}

/**
 * Take a tileset out, and every tile standing on it with it.
 *
 * The second half is not tidiness. A gid whose tileset has gone draws
 * nothing and cannot be told from a tile whose artwork simply has not loaded
 * yet, so leaving them would leave a layer that is half there with nothing on
 * screen to say why. The remaining sets keep their `firstgid`s — renumbering
 * them would move every tile in the project.
 */
export function removeTileset(store: DocStore, firstgid: number): void {
  const gone = tilesetsOf(store).find((t) => t.firstgid === firstgid);
  if (!gone) return;
  const from = gone.firstgid;
  const to = gone.firstgid + gone.tilecount;

  store.editDoc((doc) => ({
    ...doc,
    tilesets: (doc.tilesets ?? []).filter((t) => t.firstgid !== firstgid),
    scenes: doc.scenes.map((scene) => ({
      ...scene,
      layers: scene.layers.map((layer) => {
        if (!layer.tiles) return layer;
        const doomed: TileWrite[] = [];
        for (const chunk of chunksOf(layer.tiles)) {
          for (let i = 0; i < chunk.data.length; i++) {
            const gid = chunk.data[i];
            if (gid === 0) continue;
            const id = (gid & 0x0fffffff) >>> 0;
            if (id < from || id >= to) continue;
            doomed.push({
              x: chunk.x + (i % chunk.width),
              y: chunk.y + Math.floor(i / chunk.width),
              gid: 0,
            });
          }
        }
        if (doomed.length === 0) return layer;
        return { ...layer, tiles: writeTiles(layer.tiles, doomed) };
      }),
    })),
  }));
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
 * The writes that put a stamp down with its top-left corner on a space.
 *
 * The stamp tiles **from where the gesture started**, not from each space it
 * crosses: dragging a 2 × 2 stamp across the ground lays a continuous 2 × 2
 * pattern rather than a 2 × 2 block centred on every space the finger
 * touched, which is what Tiled does and the only reading under which a
 * multi-tile selection is worth having.
 */
export function stampWrites(
  tilesets: readonly TiledTileset[],
  stamp: TileStamp,
  origin: Cell,
  at: Cell,
): TileWrite[] {
  const tileset = tilesets.find((t) => t.firstgid === stamp.firstgid);
  if (!tileset || stampIsEmpty(stamp)) return [];
  // Which tile of the stamp this space is, counted from the origin and
  // wrapped — `%` is signed in JavaScript, so ground left of or above the
  // origin needs the second modulo to come back positive.
  const dx = (((at.cx - origin.cx) % stamp.cols) + stamp.cols) % stamp.cols;
  const dy = (((at.cy - origin.cy) % stamp.rows) + stamp.rows) % stamp.rows;
  const gid = gidAt(tileset, stamp.col + dx, stamp.row + dy);
  return gid === 0 ? [] : [{ x: at.cx, y: at.cy, gid }];
}

/** The same, over a whole rectangle of ground — what a box drag lays down. */
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
  const origin: Cell = { cx: left, cy: top };
  const out: TileWrite[] = [];
  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) {
      out.push(...stampWrites(tilesets, stamp, origin, { cx, cy }));
    }
  }
  return out;
}

/**
 * The most spaces one bucket fill will ever touch.
 *
 * A flood fill wants an edge to stop at and this canvas has none, so the
 * ceiling is the edge. It is a ceiling rather than a budget: filling an
 * unenclosed patch of empty ground is a gesture that cannot mean what it
 * looks like it means, and the difference between a slow fill and an editor
 * that has stopped answering is whether anything said no.
 */
export const MAX_FILL_SPACES = 4096;

/**
 * A bucket fill from one space, bounded by the ground in view.
 *
 * Two bounds, because one is not enough. The **like-for-like** rule is the
 * usual one: the fill spreads over spaces holding what the space it started
 * on holds, which on empty ground means every empty space. The **window** is
 * what stops that being the whole plane — it is the range the camera can see,
 * handed in by the caller, so a fill of open ground fills what you are
 * looking at and says so. `MAX_FILL_SPACES` is behind both in case a window
 * is handed in that is larger than anybody meant.
 */
export function bucketFill(
  layer: TiledTileLayer,
  start: Cell,
  window: { from: Cell; to: Cell },
): Cell[] {
  const left = Math.min(window.from.cx, window.to.cx);
  const right = Math.max(window.from.cx, window.to.cx);
  const top = Math.min(window.from.cy, window.to.cy);
  const bottom = Math.max(window.from.cy, window.to.cy);
  if (start.cx < left || start.cx > right) return [];
  if (start.cy < top || start.cy > bottom) return [];

  const target = tileAt(layer, start.cx, start.cy);
  const seen = new Set<string>([`${start.cx},${start.cy}`]);
  const out: Cell[] = [];
  const queue: Cell[] = [start];

  while (queue.length > 0 && out.length < MAX_FILL_SPACES) {
    const cell = queue.shift() as Cell;
    out.push(cell);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cx = cell.cx + dx;
      const cy = cell.cy + dy;
      if (cx < left || cx > right || cy < top || cy > bottom) continue;
      const key = `${cx},${cy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (tileAt(layer, cx, cy) !== target) continue;
      queue.push({ cx, cy });
    }
  }
  return out;
}

/** What the layer row says under a tile layer's name. */
export function describeTiles(layer: Layer): string {
  const n = tileCount(layer.tiles);
  return `${n} ${n === 1 ? "tile" : "tiles"}`;
}
