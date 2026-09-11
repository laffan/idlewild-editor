/**
 * Getting a PSD into — and back out of — psd-to-phaser's caches.
 *
 * The scene owns what to place and where; this owns the plugin's loading
 * contract, which has enough sharp edges to be worth keeping in one place:
 * the completion signal is the plugin's own event rather than the loader's,
 * and a key that has already been loaded has to be evicted from three
 * separate caches before it can be loaded again.
 */

import Phaser from "phaser";
import type PsdToPhaser from "psd-to-phaser";
import type { DocStore } from "../lib/doc-store";
import { placeableLayers, placedPosition, type Manifest } from "../lib/manifest";
import type { Grid } from "../lib/grid";
import type { Placement } from "../lib/types";
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
 * Ask psd-to-phaser to load a key, resolving when its textures are in.
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
export function loadPsd(
  scene: Phaser.Scene,
  p2p: PsdToPhaser | undefined,
  key: string,
  assetBase: string,
): Promise<void> {
  if (!p2p) {
    log.error("psd-to-phaser is not registered on this scene");
    return Promise.resolve();
  }
  if (p2p.getData(key)) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let graceTimer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      scene.events.off("psdLoadComplete", finish);
      scene.load.off(Phaser.Loader.Events.COMPLETE, onLoaderIdle);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      window.clearTimeout(timer);
      window.clearTimeout(graceTimer);
      reportMissing(scene, p2p, key);
      resolve();
    };

    /**
     * A file did not arrive.
     *
     * Usually not fatal — one sprite that 404s should not cut short the
     * others, and the loader going idle settles the wait either way. The
     * exception is `data.json`, which the plugin queues under the PSD's own
     * key: without it there is no manifest, nothing further will ever be
     * asked for, and the idle check below cannot tell that apart from a
     * manifest still in flight. So that one ends the wait where it stands.
     */
    const onError = (file: Phaser.Loader.File) => {
      log.error(`Could not load ${file.key} for ${key}: ${file.url}`);
      if (file.key !== key || p2p.getData(key)) return;
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
    // P2P starts the loader itself when it is not already running.
    p2p.load.load(scene, key, `${assetBase}/assets/${key}`);
  });
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
 * Say which of a PSD's sprites have no texture behind them.
 *
 * A placement whose texture never arrived draws nothing, and "the image
 * disappeared" is not a diagnosis. This turns it into a line naming the
 * layer, which is usually enough to find the layer in Photoshop that caused
 * it.
 */
function reportMissing(
  scene: Phaser.Scene,
  p2p: PsdToPhaser,
  key: string,
): void {
  const missing = spriteNames(p2p, key).filter(
    (name) => !scene.textures.exists(name),
  );
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
 * Three caches hold a loaded PSD and all three have to go, or a re-import
 * quietly shows the old artwork: psd-to-phaser's parsed manifest, Phaser's
 * JSON cache entry for `data.json`, and every texture the plugin built. The
 * plugin exposes no `removeData`, so its entry is overwritten with nothing —
 * `loadPsd`'s `getData` check is what reads it back.
 *
 * **Textures are keyed on the layer's own name, not on the PSD's.** The
 * plugin's `loadSprite` calls `scene.load.image(layer.name, url)`, so a PSD
 * key of `tower` holding `S | roof` produces a texture called `roof` and
 * nothing called `tower_roof`. Sweeping for `<psdKey>_*` therefore missed
 * every sprite whose layer was not named after the file — and a missed
 * texture is not a cosmetic problem: Phaser's loader *silently drops* a file
 * whose key already exists (`LoaderPlugin.addFile` → `keyExists`), the plugin
 * waits for a `filecomplete` that will never fire, its own asset count never
 * reaches its total, and `psdLoadComplete` is never emitted. The whole reload
 * hangs and the artwork disappears. That is why the names are read out of the
 * plugin's parsed data here rather than guessed from a convention.
 *
 * `keep` is the other half of the same problem from the other end. Two PSDs
 * with a same-named layer share one texture — a known gap the plugin can only
 * fix with `loadMultiple` — so a name another loaded PSD is still using is
 * left alone. Better a stale texture on this file than a blank one on a file
 * nobody touched.
 */
export function evictPsd(
  scene: Phaser.Scene,
  p2p: PsdToPhaser | undefined,
  key: string,
  otherKeys: readonly string[] = [],
): void {
  const mine = new Set(layerNames(p2p, key));
  for (const other of otherKeys) {
    if (other === key) continue;
    for (const name of layerNames(p2p, other)) mine.delete(name);
  }

  type PsdData = Parameters<PsdToPhaser["setData"]>[1];
  p2p?.setData(key, undefined as unknown as PsdData);
  scene.cache.json.remove(key);

  for (const textureKey of scene.textures.getTextureKeys()) {
    if (owns(textureKey, key) || [...mine].some((n) => owns(textureKey, n))) {
      scene.textures.remove(textureKey);
    }
  }
}

/**
 * Whether a texture key was built from `name`.
 *
 * The plugin's three shapes: a sprite or atlas takes the name itself, a mask
 * takes `<name>_mask`, and a tile takes `<name>_tile_<col>_<row>`. The bare
 * `<name>_` prefix is kept for the `loadMultiple` path, which namespaces on
 * the PSD key instead.
 */
function owns(textureKey: string, name: string): boolean {
  return textureKey === name || textureKey.startsWith(`${name}_`);
}

/** Every layer name in a loaded PSD, nested groups included. */
function layerNames(p2p: PsdToPhaser | undefined, key: string): string[] {
  const original = (p2p?.getData(key) as { original?: unknown } | undefined)
    ?.original;
  const names: string[] = [];
  walkNames((original as { layers?: unknown })?.layers, names);
  return names;
}

function walkNames(layers: unknown, out: string[]): void {
  if (!Array.isArray(layers)) return;
  for (const layer of layers) {
    const node = layer as { name?: unknown; children?: unknown };
    if (typeof node.name === "string" && node.name) out.push(node.name);
    walkNames(node.children, out);
  }
}

/** The sprite layers a loaded PSD expects a texture for. */
function spriteNames(p2p: PsdToPhaser, key: string): string[] {
  const original = (p2p.getData(key) as { original?: unknown } | undefined)
    ?.original;
  const out: string[] = [];
  walkSprites((original as { layers?: unknown })?.layers, out);
  return out;
}

function walkSprites(layers: unknown, out: string[]): void {
  if (!Array.isArray(layers)) return;
  for (const layer of layers) {
    const node = layer as {
      name?: unknown;
      category?: unknown;
      children?: unknown;
    };
    if (node.category === "sprite" && typeof node.name === "string") {
      out.push(node.name);
    }
    walkSprites(node.children, out);
  }
}

/**
 * Bring the document's placements for one key back in line with a manifest
 * that has just been rewritten by a re-import.
 *
 * Three things can have happened to a layer since the last parse, and all
 * three are answered here: it is still there and its placement is revised, it
 * has gone and its placement goes with it, or it is new and gets a placement
 * of its own — see `adoptNewLayers`.
 *
 * A placement whose layer is gone from the new file is removed: there is
 * nothing left to draw, and a placement that can never render is worse than
 * an honest gap.
 *
 * Everything else keeps two things. Its size *relative to* what the manifest
 * exported, so a deliberately shrunk image stays shrunk against new artwork.
 * And its grid space — the position is recomputed from the anchor cell it
 * was placed on and the PSD's own anchor mark, rather than being left where
 * it was. That is what lets an artist resize the canvas, move the artwork
 * inside it, or redraw the whole thing: as long as the mark stays on the
 * spot that should sit on that grid space, the artwork comes back lined up.
 */
export function reconcilePlacements(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
  renames?: ReadonlyMap<string, string>,
): void {
  reviseExisting(store, grid, key, manifest, renames);
  adoptNewLayers(store, grid, key, manifest);
}

/**
 * Place the layers that have appeared since the last parse.
 *
 * Adding a layer in Photoshop and re-parsing used to change nothing anyone
 * could see: reconciliation only ever *revised* the placements the document
 * already had, so a layer with no placement pointing at it was parsed,
 * exported, listed in the log — and never drawn. The file said one thing and
 * the canvas another.
 *
 * A new layer is placed the way its siblings were: on their document layer,
 * anchored to their grid space, at their scale, and positioned through the
 * PSD's own anchor mark like everything else on that key. That means it lands
 * exactly where the artist drew it relative to the artwork already there,
 * which is the only placement that can be inferred honestly.
 *
 * With no sibling there is nothing to infer from — no layer, no grid space,
 * no scale — so nothing is adopted. That only happens when every placement on
 * the key has been deleted, and inventing one for a file nobody has placed
 * would be worse than leaving it alone.
 */
function adoptNewLayers(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
): void {
  const taken = new Set<string>();
  let sibling: { layerId: string; placement: Placement } | null = null;
  for (const layer of store.layers) {
    for (const placement of layer.placements) {
      if (placement.psdKey !== key) continue;
      taken.add(placement.layerPath);
      sibling ??= { layerId: layer.id, placement };
    }
  }
  if (!sibling) return;

  const scale =
    sibling.placement.width /
    (sibling.placement.naturalWidth || sibling.placement.width);
  const anchor = sibling.placement.anchor;
  const world = grid.cellToWorld(anchor);

  for (const entry of placeableLayers(manifest)) {
    if (taken.has(entry.path)) continue;
    const width = entry.width || manifest.width;
    const height = entry.height || manifest.height;
    const at = placedPosition(world, manifest, entry, scale, scale);
    store.addPlacement(sibling.layerId, {
      psdKey: key,
      layerPath: entry.path,
      x: at.x,
      y: at.y,
      width: width * scale,
      height: height * scale,
      naturalWidth: width,
      naturalHeight: height,
      anchor,
      // Part of the same placed thing as the layers it arrived beside, so
      // the PSD still moves as one.
      instance: sibling.placement.instance,
    });
    log.info(`${key}.psd gained "${entry.path}" — placed on the same layer`);
  }
}

function reviseExisting(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
  renames?: ReadonlyMap<string, string>,
): void {
  for (const layer of store.layers) {
    for (const placement of [...layer.placements]) {
      if (placement.psdKey !== key) continue;

      // A layer renamed in the inspector is the same layer under a new path.
      // Without the map it looks exactly like one that has gone, and the
      // placement would be dropped for a change of one character.
      const path = renames?.get(placement.layerPath) ?? placement.layerPath;
      const entry = manifest.all.find((l) => l.path === path);
      if (!entry) {
        log.warn(
          `${key}.psd no longer has "${placement.layerPath}" — removing that placement`,
        );
        store.removePlacement(layer.id, placement.id);
        continue;
      }

      const scaleX = placement.width / (placement.naturalWidth || placement.width);
      const scaleY = placement.height / (placement.naturalHeight || placement.height);
      const width = entry.width || manifest.width;
      const height = entry.height || manifest.height;

      const world = grid.cellToWorld(placement.anchor);
      const at = placedPosition(world, manifest, entry, scaleX, scaleY);
      store.updatePlacement(layer.id, placement.id, {
        layerPath: path,
        x: at.x,
        y: at.y,
        width: width * scaleX,
        height: height * scaleY,
        naturalWidth: width,
        naturalHeight: height,
      });
    }
  }
}
