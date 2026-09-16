import { scenes, byFile } from "./scenes/index.js";
import config from "./game.config.json" with { type: "json" };

// Which scene the game opens on.
//
// The one the editor has open, so Play and Code show what you are looking at
// and an export carries the scene you published from — which is what this
// editor has always done. Phaser starts the first scene it is given, so the
// list is reordered rather than started by hand.
//
// These three lines are yours, unmarked on purpose: to pin the opening scene
// instead, replace `opening` with one of your own — `byFile.TitleScreen`,
// under the name the sidebar gives it.
const active = (config.scenes ?? []).find((scene) => scene.id === config.activeScene);
const opening = (active && byFile[active.file]) ?? scenes[0];
const running = opening ? [opening, ...scenes.filter((s) => s !== opening)] : scenes;

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
  // Every scene the project has. `js/scenes/index.js` is written by the
  // editor and rewritten whenever a scene is added, renamed, reordered or
  // removed, so this line never has to change.
  scene: running,
});
