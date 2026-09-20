/**
 * A PSD on a tile layer, cut into a palette.
 *
 * The other half of `tile-layers.ts`, split off when the two together went
 * over the line limit — and the seam is a real one rather than a knife
 * through the middle. That file is about **what is standing on the ground**:
 * stamps, the writes a gesture makes, and the spaces a tile is in. This one
 * is about **what there is to pick from**: `GameDoc.tilesets`, which is
 * Tiled's own tileset array, how a placed PSD becomes an entry in it, and the
 * one choice there is to make about that — whether a file is cut as it looks
 * or one palette per layer.
 *
 * The dependency runs one way, palettes knowing nothing about tiles: a
 * palette is a fact about a file, and a tile is a number pointing into one.
 *
 * Everything here writes through `DocStore.editDoc`, the same hatch the rest
 * of the document's edits use.
 */

import type { DocStore } from "./doc-store";
import type { Grid } from "./grid";
import * as log from "./log";
import { tileGrid } from "./tiled/gid";
import {
  MERGED_LAYER,
  PSD_LAYER_PROPERTY,
  PSD_PROPERTY,
  type TiledTileset,
} from "./tiled/types";
import type { Layer, PaletteMode, Placement } from "./types";

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

/**
 * How a PSD on a tile layer is cut into a palette.
 *
 * **Merged unless the document says otherwise**, and the default is the whole
 * of this function's reason to exist. A PSD used to be cut one palette per
 * layer, which is right for a file whose layers are separate sets of tiles
 * and wrong for every file that is a sheet somebody drew in layers: a
 * building came into the sidebar as three sparse pictures, each missing the
 * other two's tiles, and the way to paint the building was to stamp from all
 * three onto the same space. So the file as it looks is the default, and the
 * layer-by-layer cut is the thing you ask for.
 *
 * Absent from the document for every project that has never asked, which is
 * what makes this a migration nobody has to run: a document written before
 * the choice existed answers `merged`, and its per-layer palettes are still
 * in `tilesets` with every gid standing on them still pointing where it did.
 */
export function paletteMode(store: DocStore, psdKey: string): PaletteMode {
  return store.doc.palettes?.[psdKey] === "separate" ? "separate" : "merged";
}

/** Whether a palette is the whole file rather than one layer of it. */
export function isMergedTileset(tileset: TiledTileset): boolean {
  return propertyOf(tileset, PSD_LAYER_PROPERTY) === MERGED_LAYER;
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
 * Answers **which** palettes it cut, rather than merely whether it cut any.
 * A caller inside a change handler needs to tell a repair from a no-op, and a
 * merged one needs more than that: its picture has to exist on disk and its
 * texture has to be in the scene, neither of which is psd-to-phaser's doing.
 * See `game/tiling.ts`.
 */
export function syncTilesets(
  store: DocStore,
  grid: Grid,
  art: PaletteSource,
): TiledTileset[] {
  const cut: TiledTileset[] = [];
  for (const layer of store.layers) {
    if (layer.kind !== "tile") continue;
    for (const placement of layer.placements) {
      const merged = paletteMode(store, placement.psdKey) === "merged";
      // A merged palette is one per **file**, so every layer of a PSD that
      // arrived as several placements asks the same question and the second
      // and third find it already answered. A separate one is one per layer,
      // as it has always been.
      const path = merged ? MERGED_LAYER : placement.layerPath;
      if (tilesetForPsd(store, placement.psdKey, path)) continue;
      const found = merged
        ? art.merged(placement.psdKey)
        : art.layer(placement.psdKey, placement.layerPath);
      if (!found) continue;
      const made = cutIntoTileset(store, grid, layer, placement, found);
      if (made) cut.push(made);
    }
  }
  return cut;
}

/**
 * Where the picture a palette is cut from comes from.
 *
 * Two questions rather than one, because the two answers come from different
 * places. A layer's artwork is in the manifest psd-to-phaser already holds;
 * the file as one picture is composited by the Rust side and written beside
 * those layers — see `src-tauri/src/psd_flatten.rs`. Both answer undefined
 * for a file that has not loaded yet, which is not a failure: the load fires
 * `onPsdsLoaded`, and that is one of the two moments `syncTilesets` runs.
 */
export interface PaletteSource {
  layer(psdKey: string, layerPath: string): TilesetArt | undefined;
  merged(psdKey: string): TilesetArt | undefined;
}

/**
 * The whole file, as a palette source.
 *
 * `path` is the sentinel rather than a layer name, which is what makes a
 * merged tileset findable as one — and `filePath` is the picture
 * `psd_flatten.rs` writes, which is a sibling of the layer sprites rather
 * than one of them. The size is the **PSD's canvas**, not the union of its
 * artwork: a palette is cut on the project's grid from the file's own corner,
 * so a picture trimmed to its contents would shift every tile in it.
 */
export function mergedArt(
  size: { width: number; height: number } | undefined,
): TilesetArt | undefined {
  if (!size || size.width <= 0 || size.height <= 0) return undefined;
  return {
    path: MERGED_LAYER,
    filePath: MERGED_FILE,
    width: size.width,
    height: size.height,
  };
}

/** What `psd_flatten.rs` calls the picture it writes. */
export const MERGED_FILE = "merged.png";

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
