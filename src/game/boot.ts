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
import { WorldScene, type WorldSceneConfig } from "./world-scene";

export interface GameHandle {
  game: Phaser.Game;
  scene: WorldScene;
  destroy: () => void;
}

export function bootGame(
  parent: HTMLElement,
  config: WorldSceneConfig,
): Promise<GameHandle> {
  return new Promise((resolve) => {
    const scene = new WorldScene();

    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent,
      backgroundColor: "#d9e6ef",
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
      game.scene.start("World", config);
      resolve({
        game,
        scene,
        destroy: () => {
          scene.shutdownScene();
          game.destroy(true);
        },
      });
    });
  });
}
