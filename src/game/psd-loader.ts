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
import type { Manifest } from "../lib/manifest";
import * as log from "../lib/log";

/** How long to wait on psd-to-phaser before placing anyway. */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Ask psd-to-phaser to load a key, resolving when its textures are in.
 *
 * The signal is the plugin's own `psdLoadComplete`, not the Phaser loader's
 * COMPLETE: P2P loads `data.json` first and only queues the sprites once it
 * has parsed that, so the loader can complete a whole pass before any image
 * has been asked for. `psdLoadComplete` carries no key, so loads are run one
 * at a time.
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
    const finish = () => {
      if (settled) return;
      settled = true;
      scene.events.off("psdLoadComplete", finish);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      window.clearTimeout(timer);
      resolve();
    };
    const onError = (file: Phaser.Loader.File) => {
      log.error(`Could not load ${file.key} for ${key}: ${file.url}`);
      finish();
    };

    // A PSD whose layers all lazy-load never emits the event, so never block
    // the editor on it indefinitely.
    const timer = window.setTimeout(() => {
      if (!settled) log.warn(`${key} did not finish loading; placing anyway`);
      finish();
    }, LOAD_TIMEOUT_MS);

    scene.events.once("psdLoadComplete", finish);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    // P2P starts the loader itself when it is not already running.
    p2p.load.load(scene, key, `${assetBase}/assets/${key}`);
  });
}

/**
 * Forget everything cached under a PSD key, so the next load fetches the file
 * on disk rather than answering from memory.
 *
 * Three caches hold a loaded PSD and all three have to go, or a re-import
 * quietly shows the old artwork: psd-to-phaser's parsed manifest, Phaser's
 * JSON cache entry for `data.json`, and every texture the plugin built. The
 * plugin exposes no `removeData`, so its entry is overwritten with nothing —
 * `loadPsd`'s `getData` check is what reads it back. Textures are namespaced
 * `<psdKey>_<layerName>` by the plugin, which is what makes them findable
 * from the key alone.
 */
export function evictPsd(
  scene: Phaser.Scene,
  p2p: PsdToPhaser | undefined,
  key: string,
): void {
  type PsdData = Parameters<PsdToPhaser["setData"]>[1];
  p2p?.setData(key, undefined as unknown as PsdData);
  scene.cache.json.remove(key);

  for (const textureKey of scene.textures.getTextureKeys()) {
    if (textureKey === key || textureKey.startsWith(`${key}_`)) {
      scene.textures.remove(textureKey);
    }
  }
}

/**
 * Bring the document's placements for one key back in line with a manifest
 * that has just been rewritten by a re-import.
 *
 * A placement whose layer is gone from the new file is removed: there is
 * nothing left to draw, and a placement that can never render is worse than
 * an honest gap. Everything else keeps its position and the size the user
 * gave it *relative to* what the manifest exported, so a deliberately shrunk
 * image stays shrunk against new artwork.
 */
export function reconcilePlacements(
  store: DocStore,
  key: string,
  manifest: Manifest,
): void {
  for (const layer of store.layers) {
    for (const placement of [...layer.placements]) {
      if (placement.psdKey !== key) continue;

      const entry = manifest.all.find((l) => l.path === placement.layerPath);
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
      store.updatePlacement(layer.id, placement.id, {
        width: width * scaleX,
        height: height * scaleY,
        naturalWidth: width,
        naturalHeight: height,
      });
    }
  }
}
