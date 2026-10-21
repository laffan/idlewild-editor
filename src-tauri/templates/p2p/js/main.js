import { scenes, byFile } from "./scenes/index.js";
import config from "./game.config.json" with { type: "json" };

// Which scene the game opens on: the one the editor has open, so Play shows
// what you are looking at. To pin the opening scene instead, set `opening` to
// a file name from the sidebar — "TitleScreen", say.
const active = (config.scenes ?? []).find(
  (scene) => scene.id === config.activeScene,
);
const opening =
  active && byFile[active.file] ? active.file : Object.keys(byFile)[0];

// Every PSD the project uses, loaded once before any scene starts, so a
// scene's `create` can place them straight away with `this.P2P.place`. The
// list is `psdKeys` in `game.config.json`, which the editor rewrites as PSDs
// are added; each PSD's artwork is in `assets/<key>/`.
class Load extends Phaser.Scene {
  constructor() {
    super("Load");
  }

  preload() {
    const psds = (config.psdKeys ?? []).map((key) => ({
      key,
      path: `assets/${key}`,
      position: { x: 0, y: 0 },
    }));
    if (psds.length === 0) return;
    this.waiting = true;
    this.events.once("psdLoadComplete", () => this.scene.start(opening));
    this.P2P.load.loadMultiple(this, psds);
  }

  create() {
    // Nothing to wait for: start now. Otherwise `psdLoadComplete` starts the
    // opening scene, which arrives after this has run.
    if (!this.waiting) this.scene.start(opening);
  }
}

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
style.setProperty(
  "--game-place",
  page.centered === false ? "flex-start" : "center",
);

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
  // Phaser's own, behind what the scenes draw. Not the page colour above,
  // which is the surface the game is mounted on.
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
  // Load first, then every scene the project has. `js/scenes/index.js` is
  // written by the editor as scenes are added, renamed or removed.
  scene: [Load, ...scenes],
});
