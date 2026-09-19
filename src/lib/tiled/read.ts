/**
 * Reading a Tiled map: `.tmj` and `.tmx`, into the same records.
 *
 * Two formats because those are the two Tiled saves, and somebody with a map
 * already made has whichever one they have. They are the same document said
 * twice — the JSON is a transcription of the XML — so this file parses both
 * into `TiledMap` and everything after it reads one shape.
 *
 * **Four encodings**, and all four are on the way in only. Tile data arrives
 * as a CSV list, as raw XML `<tile>` elements, as base64, or as base64 run
 * through zlib or gzip; what is written back out is always a plain array of
 * numbers, which is what Tiled itself writes for a JSON map and the one form
 * that is readable in a diff. zstd is the one Tiled offers that is refused,
 * because the platform has no decompressor for it and a wrong answer would
 * be a map full of plausible rubbish.
 *
 * Asynchronous because decompression is: `DecompressionStream` is the only
 * inflate the webview has, and it is a stream. Everything else here would be
 * synchronous and is not worth a second code path.
 */

import { chunked } from "./chunks";
import {
  PSD_PROPERTY,
  TILED_FORMAT_VERSION,
  TILED_VERSION,
  type TiledChunk,
  type TiledMap,
  type TiledProperty,
  type TiledTileLayer,
  type TiledTileset,
} from "./types";

/** What a read gives back: the map, and what of the file was left behind. */
export interface TiledRead {
  map: TiledMap;
  /** Layer kinds this editor has no reading for, by name. */
  skipped: string[];
}

/** Whether a filename is one of the two Tiled writes. */
export function isTiledFile(name: string): boolean {
  return /\.(tmx|tmj|json)$/i.test(name);
}

/**
 * Parse whichever of the two this is.
 *
 * The extension decides, and the first non-space character is the tie-break
 * for a `.json` — Tiled will happily save a map as `.json`, and so will
 * everything else in the world, so a file that does not start with `{` is not
 * one even if its name says so.
 */
export async function readTiledMap(
  name: string,
  text: string,
): Promise<TiledRead> {
  const looksXml = text.trimStart().startsWith("<");
  if (/\.tmx$/i.test(name) || looksXml) return readTmx(text);
  return readTmj(text);
}

// ── JSON ────────────────────────────────────────────────────────────────────

async function readTmj(text: string): Promise<TiledRead> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON this editor can read.");
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.type !== undefined && raw.type !== "map") {
    throw new Error(
      `That is a Tiled ${String(raw.type)} rather than a map. Import a map.`,
    );
  }

  const skipped: string[] = [];
  const layers: TiledTileLayer[] = [];
  for (const entry of asArray(raw.layers)) {
    const layer = entry as Record<string, unknown>;
    if (layer.type !== "tilelayer") {
      skipped.push(`${String(layer.name ?? "unnamed")} (${String(layer.type)})`);
      continue;
    }
    layers.push(await tileLayerFromJson(layer));
  }

  return {
    map: assemble(raw, layers, asArray(raw.tilesets).map(tilesetFromJson)),
    skipped,
  };
}

async function tileLayerFromJson(
  layer: Record<string, unknown>,
): Promise<TiledTileLayer> {
  const encoding = asString(layer.encoding) || "csv";
  const compression = asString(layer.compression);
  const decode = (value: unknown, count: number): Promise<number[]> =>
    decodeData(value, encoding, compression, count);

  const width = asInt(layer.width);
  const height = asInt(layer.height);
  const chunks = layer.chunks
    ? await Promise.all(
        asArray(layer.chunks).map(async (entry) => {
          const chunk = entry as Record<string, unknown>;
          const w = asInt(chunk.width);
          const h = asInt(chunk.height);
          return {
            x: asInt(chunk.x),
            y: asInt(chunk.y),
            width: w,
            height: h,
            data: await decode(chunk.data, w * h),
          } satisfies TiledChunk;
        }),
      )
    : undefined;

  return chunked({
    type: "tilelayer",
    id: asInt(layer.id) || 0,
    name: asString(layer.name) || "Tiles",
    opacity: layer.opacity === undefined ? 1 : Number(layer.opacity),
    visible: layer.visible === undefined ? true : Boolean(layer.visible),
    x: asInt(layer.x),
    y: asInt(layer.y),
    width,
    height,
    ...(chunks
      ? { chunks }
      : { data: await decode(layer.data, width * height) }),
    ...(layer.properties ? { properties: propertiesFromJson(layer.properties) } : {}),
  });
}

function tilesetFromJson(entry: unknown): TiledTileset {
  const raw = entry as Record<string, unknown>;
  return {
    firstgid: asInt(raw.firstgid) || 1,
    ...(raw.source ? { source: asString(raw.source) } : {}),
    name: asString(raw.name) || "tileset",
    image: asString(raw.image),
    imagewidth: asInt(raw.imagewidth),
    imageheight: asInt(raw.imageheight),
    tilewidth: asInt(raw.tilewidth),
    tileheight: asInt(raw.tileheight),
    spacing: asInt(raw.spacing),
    margin: asInt(raw.margin),
    columns: asInt(raw.columns),
    tilecount: asInt(raw.tilecount),
    ...(raw.properties ? { properties: propertiesFromJson(raw.properties) } : {}),
  };
}

function propertiesFromJson(value: unknown): TiledProperty[] {
  return asArray(value).map((entry) => {
    const raw = entry as Record<string, unknown>;
    return {
      name: asString(raw.name),
      ...(raw.type ? { type: raw.type as TiledProperty["type"] } : {}),
      value: (raw.value ?? "") as string | number | boolean,
    };
  });
}

// ── XML ─────────────────────────────────────────────────────────────────────

async function readTmx(text: string): Promise<TiledRead> {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const failure = doc.querySelector("parsererror");
  const map = doc.documentElement;
  if (failure || !map || map.tagName !== "map") {
    throw new Error("That file is not a Tiled map this editor can read.");
  }

  const skipped: string[] = [];
  for (const kind of ["objectgroup", "imagelayer", "group"]) {
    for (const el of Array.from(map.children).filter((c) => c.tagName === kind)) {
      skipped.push(`${el.getAttribute("name") ?? "unnamed"} (${kind})`);
    }
  }

  const layers: TiledTileLayer[] = [];
  for (const el of Array.from(map.children).filter((c) => c.tagName === "layer")) {
    layers.push(await tileLayerFromXml(el));
  }

  const tilesets = Array.from(map.children)
    .filter((c) => c.tagName === "tileset")
    .map(tilesetFromXml);

  return {
    map: assemble(
      {
        orientation: map.getAttribute("orientation"),
        infinite: map.getAttribute("infinite") === "1",
        width: map.getAttribute("width"),
        height: map.getAttribute("height"),
        tilewidth: map.getAttribute("tilewidth"),
        tileheight: map.getAttribute("tileheight"),
        nextlayerid: map.getAttribute("nextlayerid"),
        nextobjectid: map.getAttribute("nextobjectid"),
      },
      layers,
      tilesets,
    ),
    skipped,
  };
}

async function tileLayerFromXml(el: Element): Promise<TiledTileLayer> {
  const data = el.querySelector(":scope > data");
  const encoding = data?.getAttribute("encoding") ?? "xml";
  const compression = data?.getAttribute("compression") ?? "";
  const width = Number(el.getAttribute("width") ?? 0) || 0;
  const height = Number(el.getAttribute("height") ?? 0) || 0;

  const readBlock = async (host: Element, count: number): Promise<number[]> => {
    if (encoding === "xml") {
      return Array.from(host.querySelectorAll(":scope > tile")).map(
        (tile) => Number(tile.getAttribute("gid") ?? 0) >>> 0,
      );
    }
    return decodeData(host.textContent ?? "", encoding, compression, count);
  };

  const chunkEls = data
    ? Array.from(data.querySelectorAll(":scope > chunk"))
    : [];
  const chunks =
    chunkEls.length > 0
      ? await Promise.all(
          chunkEls.map(async (chunk) => {
            const w = Number(chunk.getAttribute("width") ?? 0) || 0;
            const h = Number(chunk.getAttribute("height") ?? 0) || 0;
            return {
              x: Number(chunk.getAttribute("x") ?? 0) || 0,
              y: Number(chunk.getAttribute("y") ?? 0) || 0,
              width: w,
              height: h,
              data: await readBlock(chunk, w * h),
            } satisfies TiledChunk;
          }),
        )
      : undefined;

  const visible = el.getAttribute("visible");
  const opacity = el.getAttribute("opacity");
  return chunked({
    type: "tilelayer",
    id: Number(el.getAttribute("id") ?? 0) || 0,
    name: el.getAttribute("name") ?? "Tiles",
    opacity: opacity === null ? 1 : Number(opacity),
    visible: visible === null ? true : visible !== "0",
    x: Number(el.getAttribute("x") ?? 0) || 0,
    y: Number(el.getAttribute("y") ?? 0) || 0,
    width,
    height,
    ...(chunks
      ? { chunks }
      : { data: data ? await readBlock(data, width * height) : [] }),
    ...propertiesFromXml(el),
  });
}

function tilesetFromXml(el: Element): TiledTileset {
  const image = el.querySelector(":scope > image");
  const source = el.getAttribute("source");
  const tilewidth = Number(el.getAttribute("tilewidth") ?? 0) || 0;
  const tileheight = Number(el.getAttribute("tileheight") ?? 0) || 0;
  return {
    firstgid: Number(el.getAttribute("firstgid") ?? 1) || 1,
    ...(source ? { source } : {}),
    name: el.getAttribute("name") ?? "tileset",
    image: image?.getAttribute("source") ?? "",
    imagewidth: Number(image?.getAttribute("width") ?? 0) || 0,
    imageheight: Number(image?.getAttribute("height") ?? 0) || 0,
    tilewidth,
    tileheight,
    spacing: Number(el.getAttribute("spacing") ?? 0) || 0,
    margin: Number(el.getAttribute("margin") ?? 0) || 0,
    columns: Number(el.getAttribute("columns") ?? 0) || 0,
    tilecount: Number(el.getAttribute("tilecount") ?? 0) || 0,
    ...propertiesFromXml(el),
  };
}

function propertiesFromXml(el: Element): { properties?: TiledProperty[] } {
  const host = el.querySelector(":scope > properties");
  if (!host) return {};
  const properties = Array.from(host.querySelectorAll(":scope > property")).map(
    (property) => ({
      name: property.getAttribute("name") ?? "",
      type: (property.getAttribute("type") ?? undefined) as TiledProperty["type"],
      value: property.getAttribute("value") ?? property.textContent ?? "",
    }),
  );
  return properties.length > 0 ? { properties } : {};
}

// ── the parts both halves share ─────────────────────────────────────────────

/**
 * The map both readers end at.
 *
 * `infinite` is forced true whatever the file said, because a finite layer
 * has already been cut into chunks by the time it gets here — see
 * `chunksOf`. Keeping the flag as it arrived would be a map describing itself
 * in a shape it no longer has.
 */
function assemble(
  raw: Record<string, unknown>,
  layers: TiledTileLayer[],
  tilesets: TiledTileset[],
): TiledMap {
  const orientation = asString(raw.orientation) || "orthogonal";
  if (orientation !== "orthogonal" && orientation !== "isometric") {
    throw new Error(
      `${orientation} maps are not supported — this editor is orthogonal or ` +
        "isometric.",
    );
  }
  return {
    type: "map",
    version: TILED_FORMAT_VERSION,
    tiledversion: TILED_VERSION,
    orientation,
    renderorder: "right-down",
    compressionlevel: -1,
    infinite: true,
    width: asInt(raw.width),
    height: asInt(raw.height),
    tilewidth: asInt(raw.tilewidth),
    tileheight: asInt(raw.tileheight),
    nextlayerid: Math.max(asInt(raw.nextlayerid), layers.length + 1),
    nextobjectid: Math.max(asInt(raw.nextobjectid), 1),
    tilesets,
    layers,
  };
}

/** The PSD a tileset says it came from, when it is one of ours. */
export function psdOfTileset(tileset: TiledTileset): string | null {
  const held = tileset.properties?.find((p) => p.name === PSD_PROPERTY);
  return typeof held?.value === "string" && held.value ? held.value : null;
}

async function decodeData(
  value: unknown,
  encoding: string,
  compression: string,
  count: number,
): Promise<number[]> {
  if (Array.isArray(value)) return value.map((gid) => Number(gid) >>> 0);
  const text = String(value ?? "").trim();
  if (text === "") return new Array<number>(Math.max(0, count)).fill(0);
  if (encoding === "csv") {
    return text
      .split(",")
      .map((part) => Number(part.trim()) >>> 0)
      .filter((gid) => Number.isFinite(gid));
  }
  if (encoding !== "base64") {
    throw new Error(`Tile data encoded as ${encoding} is not supported.`);
  }
  return unpack(await inflate(base64Bytes(text), compression));
}

/** Base64 to bytes, without going through the DOM's `atob` twice. */
function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function inflate(bytes: Uint8Array, compression: string): Promise<Uint8Array> {
  if (!compression) return bytes;
  const format =
    compression === "gzip" ? "gzip" : compression === "zlib" ? "deflate" : null;
  if (!format) {
    throw new Error(
      `Tile data compressed with ${compression} is not supported — save the ` +
        "map with CSV, base64 or zlib.",
    );
  }
  const stream = new DecompressionStream(format);
  const out = new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(stream),
  );
  return new Uint8Array(await out.arrayBuffer());
}

/** Four little-endian bytes per gid, which is what Tiled packs. */
function unpack(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 3 < bytes.byteLength; i += 4) {
    out.push(view.getUint32(i, true) >>> 0);
  }
  return out;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asInt(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
}
