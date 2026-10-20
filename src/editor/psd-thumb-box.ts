/**
 * The little picture at the head of a row: a placed PSD's, or one of its
 * layers'.
 *
 * Three lists draw them — the layer list in Draw, the directory Code and Play
 * make of the same column, and Edit Layers in the inspector — so the box is
 * built once. It holds an icon until the picture arrives and keeps the icon
 * for something with nothing drawn in it. A picture already fetched is drawn
 * at once, so a list rebuilt by an edit does not blink back to icons — see
 * `lib/psd-thumbs.ts` for the cache behind both.
 */

import type { LayerThumb } from "../lib/ipc-psd";
import { h, icon } from "../lib/dom";
import {
  psdLayerThumbs,
  psdThumb,
  readyPsdLayerThumbs,
  readyPsdThumb,
} from "../lib/psd-thumbs";
import { manifestName } from "./psd-layer-owner";

type Glyph = string | readonly string[];

const byPath = new WeakMap<readonly LayerThumb[], Map<string, string>>();

function box(fallback: Glyph, ready: string | undefined, later: () => Promise<string>): HTMLElement {
  const el = h("span", { class: "layer-item-thumb" }, icon(fallback, 13));
  const show = (url: string) => {
    if (url) el.replaceChildren(h("img", { src: url, alt: "", draggable: "false" }));
  };
  if (ready !== undefined) show(ready);
  else void later().then(show);
  return el;
}

/** A placed PSD's picture: the whole file, cropped to its artwork. */
export function psdThumbBox(key: string, fallback: Glyph): HTMLElement {
  return box(fallback, readyPsdThumb(key), () => psdThumb(key));
}

/**
 * One layer's picture, picked out of the file's set by `pick` — by index for
 * Edit Layers, which lists the file itself, and by manifest path for the
 * directory, which lists what psd-to-json made of it.
 */
export function psdLayerThumbBox(
  key: string,
  pick: (rows: readonly LayerThumb[]) => string | undefined,
  fallback: Glyph,
): HTMLElement {
  const ready = readyPsdLayerThumbs(key);
  return box(fallback, ready && (pick(ready) ?? ""), () =>
    psdLayerThumbs(key).then((rows) => pick(rows) ?? ""),
  );
}

/**
 * The manifest path of every row, beside its picture.
 *
 * A manifest names a layer by the second pipe segment of each name from the
 * top level down — `S | roof` inside `G | tower` is `tower/roof` — and the
 * rows come top-first and depth-first, so the path to a row is the names of
 * the rows above it at each shallower depth. A row the parser ignores (no
 * pipe) takes no path, and neither does anything inside it.
 */
export function thumbsByPath(rows: readonly LayerThumb[]): Map<string, string> {
  // Every row of a directory asks for its own path out of the same answer,
  // so the map is built once per answer rather than once per row.
  const known = byPath.get(rows);
  if (known) return known;
  const out = new Map<string, string>();
  byPath.set(rows, out);
  const trail: Array<string | null> = [];
  for (const row of rows) {
    trail.length = row.depth;
    trail.push(manifestName(row.name));
    if (trail.some((part) => part === null)) continue;
    out.set(trail.join("/"), row.url);
  }
  return out;
}
