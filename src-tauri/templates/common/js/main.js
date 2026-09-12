import { WorldScene } from "./scenes/WorldScene.js";
import config from "./game.config.json" with { type: "json" };

// How the rendering options chosen in the editor reach Phaser.
//
// Pixel perfect is two settings rather than one. `pixelArt` makes every
// texture nearest-neighbour, so a 16px sprite scaled up stays blocky instead
// of being interpolated into mush; `roundPixels` snaps what is drawn to whole
// pixels, so a camera at a fractional scroll does not smear a sprite across
// two of them. They are read out of the generated config rather than written
// in here as literals, so the toggles in Project Options reach this file on
// the next save without the editor rewriting your code.
// idlewild:begin pixelPerfect
const rendering = {
  pixelArt: config.pixelArt === true,
  roundPixels: config.roundPixels === true,
};
// idlewild:end pixelPerfect

// psd-to-phaser requires Phaser 4 and the WebGL renderer: layer masks are
// built on Phaser 4's Filter system. Under Canvas, masked layers still place
// and render, just unmasked.
new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  backgroundColor: "#d9e6ef",
  ...rendering,
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
