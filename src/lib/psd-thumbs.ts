/**
 * A placed file's thumbnail, for its row in the layer list.
 *
 * Rust composites the file — visible layers, without the orienting marks —
 * crops it to the artwork and shrinks it (`psd_flatten::psd_art_thumbnail`).
 * That is a parse of the whole PSD, so each file is asked for **once** and
 * the answer kept: the layer list is rebuilt on every document change, and a
 * row that went back to Rust each time would be re-reading a file that had
 * not changed.
 *
 * **What makes an answer stale is the file being rewritten**, and every
 * rewrite comes home through `PsdPlacements.reload` or `rename`, which call
 * `forgetPsdThumb`. The next row drawn for that file asks again.
 *
 * Keyed by project as well as by file, because two projects can each have a
 * `tower.psd` and the cache outlives a project being closed.
 *
 * **A file's layers** are cached the same way, beside it: one call answers
 * every row of the stack (`psd_flatten::psd_layer_thumbnails`), it is asked
 * for once, and the same rewrite forgets both.
 */

import { psd, type LayerThumb } from "./ipc-psd";
import { openProject } from "./print";

/** Big enough for a 26px row thumbnail on a 2× screen, with room to spare. */
const SIZE = 64;

/** What has been asked for, settled or not. */
const asked = new Map<string, Promise<string>>();
/** And what has come back, so a row rebuilt later can draw it at once. */
const settled = new Map<string, string>();
/** The same two, for a file's layers. */
const layersAsked = new Map<string, Promise<LayerThumb[]>>();
const layersSettled = new Map<string, LayerThumb[]>();

function cacheKey(key: string): string | null {
  const id = openProject()?.id;
  return id ? `${id}/${key}` : null;
}

/** The thumbnail if it has already arrived — "" for a file with nothing to show. */
export function readyPsdThumb(key: string): string | undefined {
  const at = cacheKey(key);
  return at === null ? undefined : settled.get(at);
}

/**
 * The thumbnail, asked for once per file. Never rejects: a file that cannot
 * be read answers "", and its row keeps the icon it would have had anyway.
 */
export function psdThumb(key: string): Promise<string> {
  const id = openProject()?.id;
  const at = cacheKey(key);
  if (!id || at === null) return Promise.resolve("");
  let pending = asked.get(at);
  if (!pending) {
    pending = psd.artThumbnail(id, key, SIZE).then(
      (url) => url,
      () => "",
    );
    asked.set(at, pending);
    void pending.then((url) => {
      // Only if it is still the question being asked: a rewrite that landed
      // while this was in flight has forgotten it, and the old picture must
      // not come back in under the new file's name.
      if (asked.get(at) === pending) settled.set(at, url);
    });
  }
  return pending;
}

/** A file's layers, if they have already arrived. */
export function readyPsdLayerThumbs(key: string): LayerThumb[] | undefined {
  const at = cacheKey(key);
  return at === null ? undefined : layersSettled.get(at);
}

/**
 * A picture of every row of a file's layer list, index for index with
 * `psd.readLayers`. Asked for once per file; never rejects — a file that
 * cannot be read answers no rows, and each row keeps its icon.
 */
export function psdLayerThumbs(key: string): Promise<LayerThumb[]> {
  const id = openProject()?.id;
  const at = cacheKey(key);
  if (!id || at === null) return Promise.resolve([]);
  let pending = layersAsked.get(at);
  if (!pending) {
    pending = psd.layerThumbnails(id, key, SIZE).then(
      (rows) => rows,
      () => [],
    );
    layersAsked.set(at, pending);
    void pending.then((rows) => {
      if (layersAsked.get(at) === pending) layersSettled.set(at, rows);
    });
  }
  return pending;
}

/** The file on disk has changed: whatever was drawn of it is out of date. */
export function forgetPsdThumb(key: string): void {
  const at = cacheKey(key);
  if (at === null) return;
  asked.delete(at);
  settled.delete(at);
  layersAsked.delete(at);
  layersSettled.delete(at);
}
