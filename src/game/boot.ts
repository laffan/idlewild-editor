/**
 * Creates the Phaser game inside the editor shell.
 *
 * psd-to-phaser requires Phaser 4 and WebGL — its layer masks are built on
 * Phaser 4's Filter system. Under Canvas, masked layers still place and
 * render, just unmasked, so WEBGL is requested rather than AUTO to make a
 * fallback visible rather than silent.
 */

import Phaser from "phaser";
import PsdToPhaser from "psd-to-phaser";
import type { GameOptions } from "../lib/types";
import * as log from "../lib/log";
import { WorldScene, type WorldSceneConfig } from "./world-scene";

export interface GameHandle {
  game: Phaser.Game;
  scene: WorldScene;
  /**
   * Take the game down, and **wait until it is really down**.
   *
   * `Phaser.Game.destroy` does not destroy anything. It sets `pendingDestroy`
   * and the work happens on the next step of the game loop — so a caller that
   * returns straight away has left a game running, and the next one booted
   * overlaps it.
   *
   * That overlap is not cosmetic, because of what a plugin key is.
   * `PluginCache` is a module-level singleton shared by every game on the
   * page, and `PluginManager.install` refuses a key it already holds: it
   * warns *Plugin key in use* and returns null, the new game never gets its
   * `PsdToPhaser`, and `addToScene` therefore never sets `scene.P2P`. Only
   * the old game's `runDestroy` frees the key. Leave a project and open
   * another quickly enough and every PSD in the second one then fails with
   * *psd-to-phaser is not registered on this scene* — which is a project
   * where nothing can be imported and nothing says why.
   */
  destroy: () => Promise<void>;
}

/** How long to wait for a game to finish destroying itself. */
const DESTROY_TIMEOUT_MS = 2_000;

/**
 * Ask a game to go away, and resolve once it has.
 *
 * The destroy happens on the next step of the loop, so in practice this is
 * one frame. The timeout is for the case where the loop is not running — a
 * backgrounded tab, a context already lost — because a shell that cannot
 * leave a project is worse than one that leaves a frame early.
 */
function destroyGame(game: Phaser.Game): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, DESTROY_TIMEOUT_MS);
    game.events.once(Phaser.Core.Events.DESTROY, done);
    game.destroy(true);
  });
}

/**
 * psd-to-phaser reaches for a global `Phaser`.
 *
 * Its sources use the ambient namespace in value positions — `instanceof
 * Phaser.GameObjects.Group`, `Phaser.Math.Clamp`, `Phaser.Geom.Polygon` —
 * without importing it, so those survive into the build as bare global
 * references. Under a `<script src="phaser.min.js">` that is fine, because
 * Phaser assigns itself to `window`; that is how the exported games and
 * Phaser Bench run it. The editor imports Phaser as an ES module, so nothing
 * ever sets the global and every placement dies on `Can't find variable:
 * Phaser`. Publish the global before the plugin is constructed.
 */
function exposePhaserGlobal(): void {
  const scope = globalThis as typeof globalThis & { Phaser?: unknown };
  if (!scope.Phaser) scope.Phaser = Phaser;
}

/**
 * `options` is the project's rendering choices, at boot rather than after it.
 *
 * Phaser reads `pixelArt` and `roundPixels` once, as the game is constructed —
 * `pixelArt` turns `antialias` off, and that is what every texture source
 * consults for its filter. So a project that is pixel-perfect is pixel-perfect
 * from its first texture, and the toggles in Project Options reach a game
 * already running through `game/render-options.ts` instead.
 */
export function bootGame(
  parent: HTMLElement,
  config: WorldSceneConfig,
  options: GameOptions,
): Promise<GameHandle> {
  exposePhaserGlobal();

  return new Promise((resolve) => {
    const scene = new WorldScene();

    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent,
      backgroundColor: "#d9e6ef",
      pixelArt: options.pixelArt,
      roundPixels: options.roundPixels,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: "100%",
        height: "100%",
      },
      // The canvas fills the shell and reads raw pointer events; Phaser's own
      // input plumbing would fight the gesture arbiter for them.
      input: { touch: { capture: false } },
      plugins: {
        global: [
          {
            key: "PsdToPhaser",
            plugin: PsdToPhaser,
            start: true,
            mapping: "P2P",
            data: {
              debug: { shape: false, label: false, console: false },
            },
          },
        ],
      },
      scene: [],
    });

    game.scene.add("World", scene, false);
    game.events.once(Phaser.Core.Events.READY, () => {
      // Said out loud rather than left to turn up as one failed import per
      // PSD. `install` refuses a key another game still holds and only warns
      // to the browser console, so without this the first sign is a project
      // in which nothing can be imported — see `GameHandle.destroy`.
      if (!game.plugins.get("PsdToPhaser", false)) {
        log.error(
          "psd-to-phaser did not install on this game — its plugin key was " +
            "still held by the last one. Nothing will import until the " +
            "project is reopened.",
        );
      }
      game.scene.start("World", config);
      resolve({
        game,
        scene,
        destroy: async () => {
          scene.shutdownScene();
          await destroyGame(game);
        },
      });
    });
  });
}
