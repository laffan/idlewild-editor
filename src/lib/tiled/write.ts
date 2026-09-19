/**
 * Writing a Tiled map: the document's tile layers, as a `.tmj`.
 *
 * The rule this whole feature is built on is that tile data is
 * indistinguishable from Tiled's, and a writer is where that claim is
 * actually kept or broken. Three things make it true here.
 *
 * **The records are Tiled's.** Nothing is translated on the way out, because
 * nothing was translated on the way in: what the document holds under
 * `Layer.tiles` and `GameDoc.tilesets` is already a Tiled tile layer and a
 * Tiled tileset — see `tiled/types.ts` — so a map is assembled rather than
 * converted, and `doc.json` and a `.tmj` carry the same bytes for the same
 * facts.
 *
 * **Keys come out in Tiled's order**, which is alphabetical, because that is
 * the order Tiled's own JSON writer emits and a diff between one of its files
 * and one of ours should show nothing. `sorted` is the whole of it.
 *
 * **Layers come out back-first.** This editor stores layers top-first,
 * matching Hush and matching the panel; Tiled lists them in draw order, back
 * to front. That is one reversal and it is the only place the two disagree —
 * getting it wrong would export a map whose sky is under its ground.
 *
 * Whitespace is the one thing here that is not load-bearing: `JSON.parse`
 * does not see it and neither does Tiled. One space of indent is what this
 * writes.
 */

import { chunksOf } from "./chunks";
import type { TiledMap, TiledTileLayer, TiledTileset } from "./types";
import { TILED_FORMAT_VERSION, TILED_VERSION } from "./types";

/** What assembling a map needs to know about the project it comes from. */
export interface MapShape {
  orientation: "orthogonal" | "isometric";
  tilewidth: number;
  tileheight: number;
}

/**
 * A Tiled map holding these layers.
 *
 * `width` and `height` describe the ground the content actually covers, which
 * on an infinite map is a report rather than a bound — Tiled writes them and
 * so does this, worked out from the layers rather than stored, for the reason
 * a chunked layer's own four numbers are.
 *
 * Layer ids are **renumbered from one**. A map is a document of its own, and
 * two layers that came in from two different files can easily share an id;
 * `nextlayerid` is then one past the highest, which is what Tiled's counter
 * would be after writing them.
 */
export function tiledMap(
  shape: MapShape,
  layers: readonly TiledTileLayer[],
  tilesets: readonly TiledTileset[],
): TiledMap {
  // Back-first, which is Tiled's draw order and the reverse of this editor's.
  const ordered = [...layers].reverse().map((layer, index) => ({
    ...layer,
    id: index + 1,
  }));

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const layer of ordered) {
    for (const chunk of chunksOf(layer)) {
      left = Math.min(left, chunk.x);
      top = Math.min(top, chunk.y);
      right = Math.max(right, chunk.x + chunk.width);
      bottom = Math.max(bottom, chunk.y + chunk.height);
    }
  }
  const empty = !Number.isFinite(left);

  return {
    type: "map",
    version: TILED_FORMAT_VERSION,
    tiledversion: TILED_VERSION,
    orientation: shape.orientation,
    renderorder: "right-down",
    compressionlevel: -1,
    infinite: true,
    width: empty ? 0 : right - left,
    height: empty ? 0 : bottom - top,
    tilewidth: shape.tilewidth,
    tileheight: shape.tileheight,
    nextlayerid: ordered.length + 1,
    nextobjectid: 1,
    tilesets: [...tilesets].sort((a, b) => a.firstgid - b.firstgid),
    layers: ordered,
  };
}

/**
 * The map as a `.tmj`.
 *
 * `undefined` fields are dropped rather than written as null — Tiled leaves
 * an absent field out, and `"chunks": null` is not something it would ever
 * produce.
 */
export function tiledMapJson(map: TiledMap): string {
  return JSON.stringify(sorted(map), null, 1) + "\n";
}

/**
 * The same object with every key in alphabetical order, all the way down.
 *
 * `JSON.stringify` writes keys in insertion order, so the order is decided
 * here by rebuilding each object rather than by the order the records happen
 * to have been constructed in — which is what makes the output stable
 * whatever route a map took to get here.
 */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const held = (value as Record<string, unknown>)[key];
    if (held === undefined) continue;
    out[key] = sorted(held);
  }
  return out;
}
