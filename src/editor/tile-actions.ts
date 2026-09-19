/**
 * **Import Tiled**, and cutting a PSD into a palette.
 *
 * The two ways something gets onto a tile layer, and they are the same door
 * from opposite sides. A map somebody already made in Tiled arrives with its
 * tilesets and its ground in one file; a PSD dropped on the layer arrives as
 * a picture and becomes a tileset with nothing standing on it yet. Both end
 * at the same two records — a `TiledTileset` in the document and gids in
 * `Layer.tiles` — because there is only one shape a tile layer holds.
 *
 * The button is at the foot of the layer's own list in the left sidebar, for
 * the reason New Background is: nothing on a tile layer can be put down by
 * aiming at the canvas until there is a palette to aim *with*, and a file
 * somebody already made is not a gesture at all.
 *
 * **A tileset's artwork becomes a PSD like everything else.** Every picture
 * that enters this editor is written out as a Photoshop document and run
 * through psd-to-json — see `Docs/psd-pipeline.md` — and a tileset is not the
 * exception. So a `.tmx` referring to `tiles.png` beside it brings that PNG
 * in by the ordinary route, and what the tileset then names is the artwork
 * psd-to-json exported, under `assets/`. The upshot is the one the whole
 * pipeline exists for: a tileset can be opened in Photoshop and brought home
 * again, and the map that draws from it never knows.
 *
 * **Gids are renumbered on the way in.** A map off somebody's disk starts its
 * `firstgid`s at one, and this project may already have palettes using those
 * numbers. A gid means *the nth tile across every tileset in the map*, so the
 * imported sets take the next free block and every gid in the imported layers
 * is moved by the same amount — see `remap`.
 */

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { droppedFile, fromBase64, psd } from "../lib/ipc";
import * as log from "../lib/log";
import { parseManifest, placeableLayers } from "../lib/manifest";
import {
  addTileset,
  addTilesets,
  nextFirstGid,
  paintTiles,
  tilesetsOf,
  type TilesetSource,
} from "../lib/tile-layers";
import { chunksOf } from "../lib/tiled/chunks";
import { tileFlags, tileId } from "../lib/tiled/gid";
import { readTiledMap } from "../lib/tiled/read";
import {
  PSD_LAYER_PROPERTY,
  PSD_PROPERTY,
  type TiledMap,
  type TiledTileLayer,
  type TiledTileset,
} from "../lib/tiled/types";
import type { Layer } from "../lib/types";
import { openPsdProgress } from "./psd-progress";
import type { WorldScene } from "../game/world-scene";

/** What both routes need from the shell. */
export interface TileDeps {
  projectId: string;
  store: DocStore;
  grid: Grid;
  scene: () => WorldScene | null;
  /** Make this the layer new work lands on — `placePsd` reads it. */
  focusLayer: (layerId: string) => void;
  /** Re-read the panels once the document and the palettes have moved. */
  onChanged?: () => void;
}

/**
 * Bring in a `.tmx` or a `.tmj`.
 *
 * The whole thing is one undo step. An import is one thing somebody did, and
 * a stack offering to take back the fourth of six tilesets would be a stack
 * describing the loop rather than the act — the same reading `history.group`
 * is for everywhere else.
 */
export async function importTiledMap(
  deps: TileDeps,
  layerId: string,
): Promise<void> {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: "Tiled map", extensions: ["tmx", "tmj", "json"] }],
  });
  if (typeof path !== "string") return;

  deps.focusLayer(layerId);
  const progress = openPsdProgress(
    "Importing a Tiled map",
    fileName(path),
    "Reading the map…",
  );
  try {
    const { map, skipped } = await readTiledMap(fileName(path), await text(path));
    if (skipped.length > 0) {
      log.warn(
        `Left behind, because this editor has no reading for them: ${skipped.join(", ")}`,
      );
    }
    if (map.layers.length === 0) {
      log.warn("That map has no tile layers in it.");
      return;
    }
    warnAboutShape(deps, map);

    const tilesets = await bringInTilesets(deps, map, path, progress);
    await progress.stage("Placing the tiles…");
    deps.store.history.group(() => {
      addTilesets(deps.store, tilesets.made);
      writeLayers(deps, layerId, map.layers, tilesets.shift);
    });
    log.info(
      `${fileName(path)} — ${map.layers.length} ` +
        `${map.layers.length === 1 ? "layer" : "layers"}, ` +
        `${tilesets.made.length} ${tilesets.made.length === 1 ? "tileset" : "tilesets"}`,
    );
    deps.onChanged?.();
  } catch (err) {
    log.error("Could not import that map:", err);
  } finally {
    progress.close();
  }
}

/**
 * What the imported map disagrees with this project about, said once.
 *
 * Said rather than refused. A map whose tiles are a different size still
 * draws — a tile is placed by Tiled's own rule, with its bottom edge on the
 * space's bottom edge, so one that is taller than the grid overhangs upward
 * exactly as it does in Tiled — and a map whose orientation differs is a map
 * somebody may well have meant to bring in anyway. What is not acceptable is
 * either of those being a surprise.
 */
function warnAboutShape(deps: TileDeps, map: TiledMap): void {
  const wanted = deps.store.projection === "isometric" ? "isometric" : "orthogonal";
  if (map.orientation !== wanted) {
    log.warn(
      `That map is ${map.orientation} and this project is ${wanted}. The ` +
        "tiles come in, but they will not line up with the grid.",
    );
  }
  const cell = `${Math.round(deps.grid.tileWidth)} × ${Math.round(deps.grid.tileHeight)}`;
  if (
    map.tilewidth !== Math.round(deps.grid.tileWidth) ||
    map.tileheight !== Math.round(deps.grid.tileHeight)
  ) {
    log.warn(
      `That map's tiles are ${map.tilewidth} × ${map.tileheight} and this ` +
        `project's spaces are ${cell}. Each tile is drawn standing on its ` +
        "space, so taller ones overhang the way they do in Tiled.",
    );
  }
}

/** The tilesets a map brought with it, once their artwork is in the project. */
interface BroughtIn {
  made: TiledTileset[];
  /** How far every gid in the map has to move. See `remap`. */
  shift: number;
}

async function bringInTilesets(
  deps: TileDeps,
  map: TiledMap,
  /** Where the map was read from, which is what its image paths are relative
   *  to. Carried as an argument rather than stashed on the map, because a
   *  `TiledMap` is Tiled's record and a path into this machine is not in it. */
  mapPath: string,
  progress: { stage: (said: string) => Promise<void> },
): Promise<BroughtIn> {
  // One block for the whole map rather than one per set, so the gids inside
  // it keep the distances they had and a single number moves all of them.
  const shift = nextFirstGid(tilesetsOf(deps.store)) - 1;
  const made: TiledTileset[] = [];

  for (const tileset of map.tilesets) {
    if (tileset.source) {
      log.warn(
        `${tileset.source} is an external tileset. Save the map with its ` +
          "tilesets embedded and import it again.",
      );
      continue;
    }
    if (!tileset.image) {
      log.warn(`${tileset.name} has no image and was left out.`);
      continue;
    }
    await progress.stage(`Bringing in ${tileset.name}…`);
    const brought = await importTilesetImage(deps, mapPath, tileset);
    if (brought) made.push({ ...brought, firstgid: tileset.firstgid + shift });
  }
  return { made, shift };
}

/**
 * One tileset's picture, in by the ordinary door.
 *
 * `importPath` with no marks: a tileset has nothing to be anchored to,
 * because nothing on a tile layer stands anywhere — the placement exists so
 * the artwork loads and so the file is listed under the layer, and the
 * renderer skips it the way it skips a pattern layer's palette.
 */
async function importTilesetImage(
  deps: TileDeps,
  mapPath: string,
  tileset: TiledTileset,
): Promise<TiledTileset | null> {
  const scene = deps.scene();
  if (!scene) return null;
  const source = siblingOf(mapPath, tileset.image);
  const result = await psd.importPath(deps.projectId, source, tileset.name);
  const manifest = parseManifest(result.manifest);
  const art = placeableLayers(manifest)[0];
  if (!art) {
    log.warn(`${tileset.name} came in with no placeable layer in it.`);
    return null;
  }

  // Onto the layer the button was on, so the palette is listed where it is
  // used. `at` is the origin and the scale is 1: neither is ever read, since
  // a tile layer's placements are not drawn.
  await scene.placePsd(result.key, result.manifest, { cx: 0, cy: 0 }, 1);

  return {
    ...tileset,
    source: undefined,
    image: artworkPath(result.key, art.filePath),
    imagewidth: art.width || tileset.imagewidth || result.width,
    imageheight: art.height || tileset.imageheight || result.height,
    properties: [
      ...(tileset.properties ?? []).filter(
        (p) => p.name !== PSD_PROPERTY && p.name !== PSD_LAYER_PROPERTY,
      ),
      { name: PSD_PROPERTY, type: "string", value: result.key },
      { name: PSD_LAYER_PROPERTY, type: "string", value: art.path },
    ],
  };
}

/**
 * Where the imported layers land.
 *
 * The layer the button was pressed on takes the first of them when it has
 * nothing on it yet — which is the case every time, because the row is only
 * offered on a tile layer and the first thing anybody does with a fresh one
 * is press it. Everything after that becomes a layer of its own, named after
 * the layer in the map. Tiled lists layers back-first and this editor stores
 * them top-first, so each new one goes on top and the stack comes out the way
 * round it was drawn.
 *
 * A layer that was already here keeps **its own** name. The map's name is a
 * suggestion for a layer being made; it is not a reason to rename one
 * somebody has already called something.
 */
function writeLayers(
  deps: TileDeps,
  layerId: string,
  layers: readonly TiledTileLayer[],
  shift: number,
): void {
  const target = deps.store.layer(layerId);
  let into = target && isEmptyTiles(target) ? layerId : null;

  for (const layer of layers) {
    const host =
      into ?? deps.store.addLayer(freeName(deps.store, layer.name), "tile").id;
    into = null;
    const name = deps.store.layer(host)?.name ?? layer.name;
    deps.store.editLayer(host, (held) => ({
      ...held,
      // Whether the layer was shown is a fact the file carried, and there is
      // nothing here with a better answer.
      visible: layer.visible,
      tiles: { ...remap(layer, shift), name },
    }));
  }
}

/** Whether a layer has no tiles on it — so an import may claim it. */
function isEmptyTiles(layer: Layer): boolean {
  if (!layer.tiles) return true;
  return chunksOf(layer.tiles).every((chunk) =>
    chunk.data.every((gid) => gid === 0),
  );
}

/**
 * Every gid in a layer moved by the same amount, flags and all.
 *
 * The flags are the reason this is not `gid + shift`: the top four bits say
 * the tile is flipped or turned, and adding to a gid carrying them would
 * carry into the tile id. So each one is taken apart and put back together —
 * see `lib/tiled/gid.ts`.
 */
function remap(layer: TiledTileLayer, shift: number): TiledTileLayer {
  if (shift === 0) return layer;
  return {
    ...layer,
    chunks: chunksOf(layer).map((chunk) => ({
      ...chunk,
      data: chunk.data.map((gid) =>
        gid === 0 ? 0 : ((tileId(gid) + shift) | tileFlags(gid)) >>> 0,
      ),
    })),
  };
}

/**
 * Cut a PSD already on a tile layer into a palette.
 *
 * What a drop onto a tile layer ends at. The file is placed like any other —
 * that is what loads its artwork and lists it under the layer — and then this
 * says what it *is*: a tileset, divided on the project's own grid boundaries.
 * A file that is already one is handed back unchanged, because the gids
 * standing on it would all be wrong if it were cut again.
 */
export function cutPsdIntoTileset(
  deps: TileDeps,
  layerId: string,
  psdKey: string,
): TiledTileset | null {
  const scene = deps.scene();
  const layer = deps.store.layer(layerId);
  const placement = layer?.placements.find((p) => p.psdKey === psdKey);
  if (!scene || !placement) return null;

  const art = scene
    .psdLayers(psdKey)
    .find((held) => held.path === placement.layerPath);
  const source: TilesetSource = {
    psdKey,
    layerPath: placement.layerPath,
    name: psdKey,
    image: artworkPath(psdKey, art?.filePath),
    imagewidth: art?.width || placement.naturalWidth || placement.width,
    imageheight: art?.height || placement.naturalHeight || placement.height,
  };
  const made = addTileset(deps.store, deps.grid, source);
  log.info(
    `${psdKey}.psd is a palette — ${made.columns} × ` +
      `${made.columns > 0 ? Math.round(made.tilecount / made.columns) : 0} tiles`,
  );
  deps.onChanged?.();
  return made;
}

/** Take every tile off a layer, leaving its palettes alone. */
export function clearTiles(deps: TileDeps, layerId: string): void {
  const layer = deps.store.layer(layerId);
  if (!layer?.tiles) return;
  const doomed = chunksOf(layer.tiles).flatMap((chunk) =>
    chunk.data.flatMap((gid, i) =>
      gid === 0
        ? []
        : [
            {
              x: chunk.x + (i % chunk.width),
              y: chunk.y + Math.floor(i / chunk.width),
              gid: 0,
            },
          ],
    ),
  );
  paintTiles(deps.store, layerId, doomed);
}

// ── paths ───────────────────────────────────────────────────────────────────

/**
 * Where psd-to-json put a layer's artwork, relative to the project.
 *
 * What a tileset's `image` names, so that a `.tmj` written beside the project
 * points at a real picture. A layer with no exported file of its own — which
 * only a group would be — falls back to naming the directory, which is wrong
 * in a way somebody can see rather than wrong silently.
 */
function artworkPath(psdKey: string, filePath: string | undefined): string {
  return `assets/${psdKey}/${filePath ?? ""}`;
}

/**
 * A file beside the map, as the map's own relative path names it.
 *
 * A tileset's `image` is relative to the map file, which is Tiled's rule, so
 * the only way to find the picture is from where the map was. An absolute
 * path in the file is taken as it stands.
 */
function siblingOf(mapPath: string, relative: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(relative)) return relative;
  const cut = Math.max(mapPath.lastIndexOf("/"), mapPath.lastIndexOf("\\"));
  return cut < 0 ? relative : `${mapPath.slice(0, cut)}/${relative}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The map file, as text. Read by path, the way a dropped file is. */
async function text(path: string): Promise<string> {
  const file = await droppedFile(path);
  return new TextDecoder().decode(fromBase64(file.dataBase64));
}

/** A layer name nothing else in the scene is using. */
function freeName(store: DocStore, wanted: string): string {
  const taken = new Set(store.layers.map((l) => l.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const name = `${wanted} ${n}`;
    if (!taken.has(name)) return name;
  }
}
