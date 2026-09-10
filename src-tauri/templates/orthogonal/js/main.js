import { WorldScene } from "./WorldScene.js";

// psd-to-phaser requires Phaser 4 and the WebGL renderer: layer masks are
// built on Phaser 4's Filter system. Under Canvas, masked layers still place
// and render, just unmasked.
new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  backgroundColor: "#d9e6ef",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  plugins: {
    global: [
      {
        key: "PsdToPhaser",
        plugin: PsdToPhaserPlugin,
        start: true,
        mapping: "P2P",
        data: {
          debug: { shape: false, label: false, console: false },
        },
      },
    ],
  },
  scene: [WorldScene],
});
