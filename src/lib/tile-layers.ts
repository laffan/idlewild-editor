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
  emptyTileLayer,
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
import type { Cell, Layer, Placement, Projection } from "./types";

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
 *
 * That permanence is also why there is no way to take a palette out again.
 * There was an `×` over each one for a while, and it was the wrong control in
 * the wrong place: removing a tileset has to take every tile made of it off
 * the map with it — a gid whose picture has gone draws nothing and cannot be
 * told from a tile whose artwork simply has not loaded yet — and that is not
 * a thing to offer as a glyph in a header. An unused palette costs a record.
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
  /**
   * How big the artwork is *shown* against its own pixels — the ratio a
   * placement already carries between `width` and `naturalWidth`.
   *
   * This is the difference between a palette that comes out right and one cut
   * into four times as many tiles as anybody can see. Everything this editor
   * writes is painted at **twice** the size it is shown at — see
   * `IMPORT_SCALE` — so a PSD covering three grid spaces is six grid-widths
   * of pixels, and cutting it at the grid's own pitch would divide each space
   * into four. A file that came in from a Tiled map is 1:1 and passes 1.
   */
  scale?: number;
}

/**
 * Cut a PSD into a tileset on the project's own grid boundaries.
 *
 * "Divided along the same boundaries as the main canvas" is a statement about
 * the artwork **as it is shown**, which is why `source.scale` is here: a
 * space in the palette has to be a space on the ground, so what is picked up
 * is what is put down. A PSD covering three grid spaces is cut into three
 * tiles whether its pixels are at 1:1 or at retina.
 *
 * On an isometric project the pitch is the diamond's **bounding box** —
 * `tileWidth` by `tileHeight`, 2:1 — because a picture is cut into rectangles
 * whatever shape is drawn inside them, and Tiled cuts an isometric tileset
 * the same way.
 *
 * What goes into the record is the pitch in the file's **own pixels**, which
 * is what `tilewidth` means in a Tiled tileset. A map whose tileset pitch
 * differs from its own is an ordinary thing in Tiled and `tile-render.ts`
 * knows what to do with one.
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

  const scale = source.scale && source.scale > 0 ? source.scale : 1;
  const tilewidth = Math.max(1, Math.round(grid.tileWidth / scale));
  const tileheight = Math.max(1, Math.round(grid.tileHeight / scale));
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

/** One layer of a placed PSD, as much of it as cutting a palette needs. */
export interface TilesetArt {
  path: string;
  filePath?: string;
  width: number;
  height: number;
  /** psd-to-json's own word for what the layer is. Only "sprite" is a
   *  picture, which is what `tilesetArt` falls back to. */
  category?: string;
}

/**
 * Which layer of a loaded PSD a palette is cut from.
 *
 * The placement's own layer where the file still has one, and the first
 * picture in the file otherwise. The fallback is what makes carrying a file
 * onto a tile layer work: a placement made on an object layer names the one
 * layer of the file it stood for, and a PSD with several has one placement
 * each — so the first sprite is the palette, and the others are the same file
 * arriving again and finding it already cut.
 */
export function tilesetArt(
  layers: readonly TilesetArt[],
  layerPath: string,
): TilesetArt | undefined {
  return (
    layers.find((held) => held.path === layerPath) ??
    layers.find((held) => held.category === "sprite")
  );
}

/**
 * Every PSD on a tile layer has a palette, and this is what makes it true.
 *
 * A **sweep** rather than a hook on placing, and that is the whole lesson of
 * the first version: `PsdPlacements.place` is only one of the ways a file
 * arrives on a layer. Carrying one there from the layer panel goes through
 * `DocStore.movePlacements` and never touches it, so a PSD dragged onto a
 * tile layer vanished — the renderer refuses to draw a tile layer's
 * placements, and there was no palette to show instead. Any *future* route
 * onto a layer would have had the same hole.
 *
 * So nothing hooks placing. This asks the document what is true — which
 * placements are on tile layers, and which of them have no palette yet — and
 * is called wherever the answer can have changed: after a document change,
 * and when the manifests arrive. Both are cheap, because a file that already
 * has one is a map lookup.
 *
 * `art` is asked rather than passed, because a palette needs the *file's*
 * facts — its exported artwork and its size — and those come from the parsed
 * manifest rather than from the document. It answers undefined for a key that
 * has not loaded yet, which is not a failure: the load fires
 * `onPsdsLoaded`, and that is one of the two moments this runs.
 *
 * Answers whether anything was cut, so a caller inside a change handler can
 * tell a repair from a no-op.
 */
export function syncTilesets(
  store: DocStore,
  grid: Grid,
  art: (psdKey: string, layerPath: string) => TilesetArt | undefined,
): boolean {
  let cut = false;
  for (const layer of store.layers) {
    if (layer.kind !== "tile") continue;
    for (const placement of layer.placements) {
      if (tilesetForPsd(store, placement.psdKey, placement.layerPath)) continue;
      const found = art(placement.psdKey, placement.layerPath);
      if (!found) continue;
      cut = cutIntoTileset(store, grid, layer, placement, found) !== null || cut;
    }
  }
  return cut;
}

/**
 * One PSD on a tile layer, cut into a palette.
 *
 * The scale is read off the **placement** rather than assumed, because that
 * is the one place the answer is: `width` against `naturalWidth` is how much
 * of a grid space one of the file's pixels covers, and it is what makes a
 * palette come out with as many tiles as the artwork has spaces. See
 * `TilesetSource.scale`.
 *
 * `addTileset` hands back the set that is already there for a file that has
 * been cut before, so a second call is free and leaves every gid standing on
 * the first one pointing where it did.
 */
export function cutIntoTileset(
  store: DocStore,
  grid: Grid,
  layer: Layer,
  placement: Pick<Placement, "psdKey" | "width" | "naturalWidth">,
  art: TilesetArt | undefined,
): TiledTileset | null {
  if (!art) return null;
  const natural = placement.naturalWidth || placement.width || 0;
  const made = addTileset(store, grid, {
    psdKey: placement.psdKey,
    layerPath: art.path,
    name: placement.psdKey,
    // Where psd-to-json put the artwork, relative to the project — what a
    // `.tmj` written beside it has to name to point at a real picture.
    image: `assets/${placement.psdKey}/${art.filePath ?? ""}`,
    imagewidth: art.width,
    imageheight: art.height,
    scale: natural > 0 ? placement.width / natural : 1,
  });
  const rows = made.columns > 0 ? Math.round(made.tilecount / made.columns) : 0;
  log.info(
    `${placement.psdKey}.psd is a palette on ${layer.name} — ${made.columns} × ` +
      `${rows} tiles of ${made.tilewidth} × ${made.tileheight}`,
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

/** What the layer row says under a tile layer's name. */
export function describeTiles(layer: Layer): string {
  const n = tileCount(layer.tiles);
  return `${n} ${n === 1 ? "tile" : "tiles"}`;
}
