/**
 * Tiled's own JSON, as records.
 *
 * The first rule of a tile layer is that its data is **indistinguishable from
 * data Tiled wrote**. So this file is not a design; it is a transcription of
 * the JSON map format, field for field, in the order and the spelling Tiled
 * uses — all lower case and unabbreviated, which is why nothing here is
 * camel-cased like the rest of the document. A record built here is written
 * into `doc.json` verbatim and comes back out of a `.tmj` unchanged, and that
 * only works while the names are theirs rather than ours.
 *
 * What is *not* here is everything Tiled can hold that this editor has no
 * reading for — object groups, image layers, terrains, wangsets, templates,
 * animations. An import says in the console what it left behind rather than
 * dropping it silently, because a map that came back from Tiled missing half
 * of itself with no word said is the worst of the three possible answers.
 *
 * See `Docs/tile-layers.md` for what each of these means here.
 */

/** A Tiled custom property. */
export interface TiledProperty {
  name: string;
  type?: "string" | "int" | "float" | "bool" | "color" | "file" | "object";
  value: string | number | boolean;
}

/**
 * One 16 × 16 patch of an infinite map's tile data.
 *
 * Infinite is the only shape that fits this editor. There is no world bound
 * here to fill — the lattice is recomputed from the camera over exactly the
 * cells in view — so a tile layer cannot have a `width` and a `height` that
 * mean anything, and a finite map would have to pick some rectangle and call
 * it the world. Tiled's answer to the same problem is chunks, so it is ours:
 * a sparse set of fixed patches, addressed in tiles, each holding one gid per
 * space, row-major.
 */
export interface TiledChunk {
  data: number[];
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * A tile layer.
 *
 * `chunks` on an infinite map and `data` on a finite one; a file may arrive
 * either way and both are read, but everything written out of here is
 * chunked — see `chunks.ts`.
 */
export interface TiledTileLayer {
  /** Always "tilelayer" here: the other three kinds are carried, not read. */
  type: "tilelayer";
  /** Unique across the map's layers, and Tiled's own counter mints it. */
  id: number;
  name: string;
  opacity: number;
  visible: boolean;
  /** "Horizontal offset in tiles. Always 0." — and Tiled writes it anyway. */
  x: number;
  y: number;
  /** The extent of the written chunks, which is what Tiled reports. */
  width: number;
  height: number;
  /** Where the content starts, in tiles. Infinite maps only. */
  startx?: number;
  starty?: number;
  chunks?: TiledChunk[];
  /** A finite layer's tiles, row-major. Read on the way in, never written. */
  data?: number[];
  properties?: TiledProperty[];
}

/**
 * A tileset, embedded in the map the way Tiled embeds one.
 *
 * `image` is a path relative to the map file, which for a map this editor
 * writes is the PSD's own exported artwork under `assets/`. Which PSD that
 * is cannot be recovered from a path, so it rides in a custom property —
 * `idlewild:psd` — which is an ordinary Tiled property and survives a round
 * trip through Tiled untouched. See `PSD_PROPERTY`.
 */
export interface TiledTileset {
  firstgid: number;
  /**
   * An external `.tsx` beside the map, on a tileset that has not been
   * resolved yet. Only ever set on the way *in* — `read.ts` leaves it for the
   * importer, which is the only thing here that can read another file — and
   * never written, because every tileset this editor holds is embedded.
   */
  source?: string;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  /** Pixels between adjacent tiles, and between the edge and the first. */
  spacing: number;
  margin: number;
  columns: number;
  tilecount: number;
  properties?: TiledProperty[];
}

/** The whole map: what a `.tmj` holds, and what one written from here is. */
export interface TiledMap {
  type: "map";
  version: string;
  tiledversion: string;
  orientation: "orthogonal" | "isometric";
  renderorder: "right-down";
  compressionlevel: number;
  infinite: boolean;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  tilesets: TiledTileset[];
  layers: TiledTileLayer[];
  properties?: TiledProperty[];
}

/**
 * The JSON format version this writes, and the Tiled release it claims.
 *
 * Both are Tiled's own strings rather than the editor's. A file claiming a
 * version of its own would be a file Tiled has to be lenient about, and
 * lenient is the opposite of indistinguishable. `1.10` is the format; the
 * `tiledversion` is the release that last changed it.
 */
export const TILED_FORMAT_VERSION = "1.10";
export const TILED_VERSION = "1.11.0";

/**
 * The property a tileset carries to say which PSD in this project it is.
 *
 * Prefixed with the app's name the way Tiled's own documentation suggests
 * custom properties are namespaced, so a map that has been round-tripped
 * through Tiled — where somebody may well have added properties of their own
 * — comes home able to say which file each tileset was.
 */
export const PSD_PROPERTY = "idlewild:psd";

/** And which layer of it, for a PSD holding more than one. */
export const PSD_LAYER_PROPERTY = "idlewild:layer";
