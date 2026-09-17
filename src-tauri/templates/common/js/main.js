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

// The page around the game — what Page Setup writes.
//
// Written onto the document as custom properties rather than into
// `styles.css`, so that stylesheet stays yours: every rule it has reads one of
// these with a fallback, and a rule you rewrite keeps whatever you wrote. The
// fallbacks here and in `styles.css` are the same defaults the editor would
// have sent, so nothing in this block is load-bearing — delete it and the game
// is full-bleed on the same page it would have had anyway.
//
// `scale` is the half CSS cannot do. A game filling the window wants RESIZE,
// so the camera gets the whole viewport; a fixed-size game wants FIT against
// the size it was given, so it shrinks to fit a window too small for it
// instead of being cut off by the box it sits in.
// idlewild:begin presentation
const page = config.presentation ?? {};
const fixed = page.fixed === true && page.width > 0 && page.height > 0;

const style = document.documentElement.style;
style.setProperty("--game-background", page.background ?? "#2d2b2b");
style.setProperty("--game-margin", `${page.margin ?? 0}px`);
style.setProperty("--game-radius", `${page.radius ?? 0}px`);
style.setProperty("--game-width", fixed ? `${page.width}px` : "100%");
style.setProperty("--game-height", fixed ? `${page.height}px` : "100%");
style.setProperty("--game-place", page.centered === false ? "flex-start" : "center");

const scale = fixed
  ? {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: page.width,
      height: page.height,
    }
  : { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH };
// idlewild:end presentation

// psd-to-phaser requires Phaser 4 and the WebGL renderer: layer masks are
// built on Phaser 4's Filter system. Under Canvas, masked layers still place
// and render, just unmasked.
new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  // Phaser's own, behind what the scenes draw — the sky, in effect. Not the
  // page colour above, which is the surface the game is mounted on and is only
  // visible where the game is *not*. Two surfaces, and they default to two
  // different answers on purpose: a frame the same colour as the world reads
  // as the world running on past its own border.
  backgroundColor: "#d9e6ef",
  ...rendering,
  scale,
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
