/**
 * Getting a PSD into — and back out of — psd-to-phaser's caches.
 *
 * The scene owns what to place and where; this owns the plugin's loading
 * contract, which has enough sharp edges to be worth keeping in one place:
 * the completion signal is the plugin's own event rather than the loader's,
 * every texture is namespaced on the PSD's key, and a key that has already
 * been loaded has to be evicted from three separate caches before it can be
 * loaded again.
 */

import Phaser from "phaser";
import type PsdToPhaser from "psd-to-phaser";
import { maskKey, scopeKeys, textureKey, textureNeeds } from "../lib/manifest";
import * as log from "../lib/log";

/** How long to wait on psd-to-phaser before placing anyway. */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * How long the loader is allowed to look finished before it is believed.
 *
 * `psdLoadComplete` and the loader's own COMPLETE fire in the same tick when
 * everything went well, and the plugin's event is the one that means the
 * textures are in — so COMPLETE waits a moment to let it win the race.
 */
const SETTLE_GRACE_MS = 60;

/**
 * The key the plugin's multi-PSD path parks a manifest in Phaser's JSON cache
 * under, which is *not* the PSD's own key.
 *
 * It matters twice. A load has to watch for the failure of `<key>_temp_json`
 * rather than of `<key>`, and — the trap — Phaser's loader silently drops a
 * `load.json` whose key is already in the cache, so a second load of the same
 * file would never fire its completion handler and the reload would hang for
 * ever. `evictPsd` clears it.
 */
function manifestKey(key: string): string {
  return `${key}_temp_json`;
}

/**
 * Ask psd-to-phaser to load a key, resolving when its textures are in.
 *
 * **Through `loadMultiple`, with one config in it.** The plugin has two
 * loading paths and they name textures differently: `load` keys a sprite on
 * `layer.name` alone, so two PSDs with a same-named layer share one texture,
 * and `loadMultiple` keys it `<psdKey>_<name>`. The shared-name case is not
 * hypothetical — `New layer` names its rows `layer-1` upward *within a file*,
 * so two files that each have one collide, and the collision is silent in the
 * worst way: Phaser's loader declines a key it already holds, the first file's
 * artwork answers for the second, and nothing anywhere says so. `place` reads
 * the same `isMultiplePsd` flag this path sets, so both halves agree.
 *
 * The signal is the plugin's own `psdLoadComplete`, not the Phaser loader's
 * COMPLETE: P2P loads `data.json` first and only queues the sprites once it
 * has parsed that, so the loader can complete a whole pass before any image
 * has been asked for. `psdLoadComplete` carries no key, so loads are run one
 * at a time.
 *
 * That event is not guaranteed to arrive, though, and waiting fifteen seconds
 * to find out is the difference between a slow reload and an editor that
 * looks broken. The plugin counts its own assets in and emits nothing at all
 * if one of them never lands — and a file Phaser *declines to queue* never
 * lands, which is the case `evictPsd` below exists to prevent. So the loader
 * going idle is taken as a second, weaker signal: if it has drained its queue
 * and the plugin still has not spoken, everything that was going to load has,
 * and `reportMissing` says which sprites did not make it.
 */
export async function loadPsd(
  scene: Phaser.Scene,
  p2p: PsdToPhaser | undefined,
  key: string,
  assetBase: string,
): Promise<void> {
  if (!p2p) {
    log.error("psd-to-phaser is not registered on this scene");
    return;
  }
  if (p2p.getData(key)) return;

  const base = `${assetBase}/assets/${key}`;
  await new Promise<void>((resolve) => {
    let settled = false;
    let graceTimer = 0;
    const json = manifestKey(key);

    const finish = () => {
      if (settled) return;
      settled = true;
      scene.events.off("psdLoadComplete", finish);
      scene.load.off(Phaser.Loader.Events.COMPLETE, onLoaderIdle);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      window.clearTimeout(timer);
      window.clearTimeout(graceTimer);
      resolve();
    };

    /**
     * A file did not arrive.
     *
     * Usually not fatal — one sprite that 404s should not cut short the
     * others, and the loader going idle settles the wait either way. The
     * exception is `data.json`, which the plugin queues under the manifest
     * key above: without it there is no manifest, nothing further will ever
     * be asked for, and the idle check below cannot tell that apart from a
     * manifest still in flight. So that one ends the wait where it stands.
     */
    const onError = (file: Phaser.Loader.File) => {
      log.error(`Could not load ${file.key} for ${key}: ${file.url}`);
      if (file.key !== json || p2p.getData(key)) return;
      // The manifest is the one file worth chasing: without it the PSD
      // places empty, and Phaser reports a request that never left, a 404
      // and a body it could not parse as the same bare event.
      void explain(String(file.url));
      finish();
    };

    /**
     * The loader has nothing left to do.
     *
     * It fires once per pass, and the first pass is `data.json` alone — the
     * sprites are queued from inside its completion handler, so a COMPLETE
     * seen before the plugin has parsed the manifest means nothing yet.
     */
    const onLoaderIdle = () => {
      if (settled || !p2p.getData(key)) return;
      window.clearTimeout(graceTimer);
      graceTimer = window.setTimeout(() => {
        if (!settled && !scene.load.isLoading()) finish();
      }, SETTLE_GRACE_MS);
    };

    // A PSD whose layers all lazy-load never starts a load at all, so never
    // block the editor on it indefinitely.
    const timer = window.setTimeout(() => {
      if (!settled) log.warn(`${key} did not finish loading; placing anyway`);
      finish();
    }, LOAD_TIMEOUT_MS);

    scene.events.once("psdLoadComplete", finish);
    scene.load.on(Phaser.Loader.Events.COMPLETE, onLoaderIdle);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    // At the origin, deliberately: the offset is applied to every layer's
    // coordinates inside the plugin's copy of the manifest, and this editor
    // positions placements itself from the document.
    p2p.load.loadMultiple(scene, [{ key, path: base, position: { x: 0, y: 0 } }]);
  });

  await loadMasks(scene, p2p, key, base);
  reportMissing(scene, p2p, key);
}

/**
 * The one thing `loadMultiple` does not fetch: a layer's mask.
 *
 * The plugin's multi-PSD loader queues sprites and tiles and skips masks
 * altogether, while `place` goes on looking for `<name>_mask` and warns when
 * it is not there — so a masked layer would arrive unmasked. The single-file
 * loader does fetch them, which is the behaviour being preserved here rather
 * than traded away for the namespacing above.
 *
 * The key stays unscoped because that is the key `place` reads. See `maskKey`.
 */
async function loadMasks(
  scene: Phaser.Scene,
  p2p: PsdToPhaser,
  key: string,
  base: string,
): Promise<void> {
  const wanted = masksOf(p2p, key).filter(
    (mask) => !scene.textures.exists(maskKey(mask.name)),
  );
  if (wanted.length === 0) return;

  for (const mask of wanted) {
    scene.load.image(maskKey(mask.name), `${base}/${mask.path}`);
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      scene.load.off(Phaser.Loader.Events.COMPLETE, finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, LOAD_TIMEOUT_MS);
    scene.load.on(Phaser.Loader.Events.COMPLETE, finish);
    if (!scene.load.isLoading()) scene.load.start();
  });
}

/** Every masked layer in a loaded PSD, by name and by where its mask is. */
function masksOf(
  p2p: PsdToPhaser | undefined,
  key: string,
): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  walk(originalLayers(p2p, key), (node) => {
    const path = node.maskPath;
    const name = node.name;
    if (typeof path === "string" && path && typeof name === "string" && name) {
      out.push({ name, path });
    }
  });
  return out;
}

/**
 * Ask the asset server the same question Phaser just failed to answer.
 *
 * Phaser's `loaderror` says only that a file did not arrive. The three
 * reasons want three different fixes and are indistinguishable from the
 * event: the request never left the webview, the server answered but had
 * nothing there, or it served something that is not JSON. One `fetch` after
 * the fact tells them apart, and it costs nothing on the path where
 * everything worked.
 */
async function explain(url: string): Promise<void> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.text();
    if (!response.ok) {
      log.error(`The asset server answered HTTP ${response.status} for ${url}`);
      return;
    }
    try {
      JSON.parse(body);
      log.error(
        `The asset server served ${body.length} bytes of valid JSON for ${url}, ` +
          "so it was the loader that refused it rather than the file that was missing.",
      );
    } catch {
      log.error(
        `The asset server served ${body.length} bytes that are not JSON: ` +
          body.slice(0, 120),
      );
    }
  } catch (err) {
    // Nothing arrived at all: the webview declined to make the request, or
    // there is no listener on the other end. `checkAssetServer` says which
    // at boot; this says it happened here too.
    log.error(
      `The asset server could not be reached at ${url} — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Say which of a PSD's layers have no texture behind them.
 *
 * A placement whose texture never arrived draws nothing, and "the image
 * disappeared" is not a diagnosis. This turns it into a line naming the
 * layer, which is usually enough to find the layer in Photoshop that caused
 * it.
 *
 * Which textures a layer is owed is `textureNeeds`'s answer rather than this
 * one's, and that matters here as much as it does at the gate: a sprite
 * *inside a tileset* is never loaded as a sprite — the plugin's categoriser
 * stops at the tileset — so counting it as missing warned about every
 * backdrop this editor writes, on a file that was perfectly well loaded.
 */
function reportMissing(
  scene: Phaser.Scene,
  p2p: PsdToPhaser,
  key: string,
): void {
  const missing = textureNeeds(originalLayers(p2p, key))
    .filter((need) =>
      !scopeKeys(key, need.keys).every((k) => scene.textures.exists(k)),
    )
    .map((need) => need.name);
  if (missing.length === 0) return;
  log.warn(
    `${key}: no texture loaded for ${missing.join(", ")} — ` +
      "those layers will draw nothing",
  );
}

/**
 * Forget everything cached under a PSD key, so the next load fetches the file
 * on disk rather than answering from memory.
 *
 * Four caches hold a loaded PSD and all four have to go, or a re-import
 * quietly shows the old artwork — or, worse, hangs: psd-to-phaser's parsed
 * manifest, Phaser's JSON cache entry for `data.json`, every texture the
 * plugin built, and every mask. The plugin exposes no `removeData`, so its
 * entry is overwritten with nothing — `loadPsd`'s `getData` check is what
 * reads it back.
 *
 * **The textures are namespaced on the PSD's key**, because every load goes
 * through `loadMultiple` — so a sweep for `<key>_*` is exact rather than a
 * guess, and there is no longer any question of a file's eviction reaching
 * another file's artwork. That used to be the hard part here: the plugin's
 * single-file loader keys a sprite on `layer.name`, so the names had to be
 * read out of the parsed manifest and then filtered against every *other*
 * loaded PSD's names, and a name still in use elsewhere was left stale rather
 * than blanked.
 *
 * Masks are the exception, and they are why the manifest is still read. The
 * plugin looks one up as `<name>_mask` on both paths, so a mask cannot be
 * namespaced — which means it can still be shared, and a shared one has to
 * survive this eviction. `keep` is the names another loaded PSD is using.
 */
export function evictPsd(
  scene: Phaser.Scene,
  p2p: PsdToPhaser | undefined,
  key: string,
  otherKeys: readonly string[] = [],
): void {
  const masks = new Set(layerNames(p2p, key).map(maskKey));
  for (const other of otherKeys) {
    if (other === key) continue;
    for (const name of layerNames(p2p, other)) masks.delete(maskKey(name));
  }

  type PsdData = Parameters<PsdToPhaser["setData"]>[1];
  p2p?.setData(key, undefined as unknown as PsdData);
  scene.cache.json.remove(key);
  // Phaser drops a `load.json` whose key it already holds, without an event,
  // so a stale entry here is a reload that never completes.
  scene.cache.json.remove(manifestKey(key));

  const prefix = `${key}_`;
  for (const textureKey of scene.textures.getTextureKeys()) {
    if (textureKey.startsWith(prefix) || masks.has(textureKey)) {
      scene.textures.remove(textureKey);
    }
  }
}

/** Every layer name in a loaded PSD, nested groups included. */
function layerNames(p2p: PsdToPhaser | undefined, key: string): string[] {
  const names: string[] = [];
  walk(originalLayers(p2p, key), (node) => {
    if (typeof node.name === "string" && node.name) names.push(node.name);
  });
  return names;
}

/** The plugin's own copy of a PSD's manifest layers. */
function originalLayers(p2p: PsdToPhaser | undefined, key: string): unknown {
  const original = (p2p?.getData(key) as { original?: unknown } | undefined)
    ?.original;
  return (original as { layers?: unknown })?.layers;
}

type ManifestNode = Record<string, unknown> & { children?: unknown };

function walk(layers: unknown, visit: (node: ManifestNode) => void): void {
  if (!Array.isArray(layers)) return;
  for (const layer of layers) {
    const node = layer as ManifestNode;
    visit(node);
    walk(node.children, visit);
  }
}

/** One layer's picture, and how it should be drawn. */
export interface LayerImage {
  image: CanvasImageSource;
  /** False on a pixel-art project, where a smoothed enlargement is a smudge. */
  smooth: boolean;
}

/**
 * The decoded picture behind one layer of a loaded PSD, or null.
 *
 * Phaser has it already — the plugin loaded it when the file was placed — so
 * what comes back is the picture that is **on screen** rather than a second
 * copy fetched and decoded again. PSD Edit mode's one caller relies on that:
 * it bakes the layer into the drawing surface and turns the canvas's own copy
 * off, and the swap has to be invisible. See `textureKey` for the scoping.
 *
 * Null for a layer with no texture at all, which is any freshly added one —
 * psd-to-json exports nothing for a single transparent pixel.
 */
export function layerImage(
  scene: Phaser.Scene,
  key: string,
  name: string,
): LayerImage | null {
  const scoped = textureKey(key, name);
  if (!scene.textures.exists(scoped)) return null;
  const image = scene.textures.get(scoped).getSourceImage() as CanvasImageSource;
  if (!image) return null;
  return { image, smooth: scene.game.config.pixelArt !== true };
}
