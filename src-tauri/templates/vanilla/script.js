// Your project, as data. Nothing else is wired up.
//
// `game.config.json` is written by the editor on every save: the projection,
// the grid, every scene, every layer, and every fill, placement, zone and
// point in them, in world pixels. `psdKeys` is the list of PSDs the document
// uses, and each one's artwork is under `assets/<key>/` beside this file, with
// the `data.json` psd-to-json wrote describing its layers.
//
// So the two things a page here does are: read the config, and load an image
// out of `assets/`. Everything after that is the part the editor stays out of.
//
// Served rather than opened from disk: this is a module and it fetches a JSON
// file, so `file://` will not do. Play already serves it, and an export's
// README says the same.

const config = await fetch("game.config.json").then((r) => r.json());

const app = document.querySelector("#app");
app.textContent =
  `${config.projection} · ${config.grid}px · ` +
  `${(config.scenes ?? []).length} scene(s) · ` +
  `${(config.psdKeys ?? []).length} PSD(s)`;

console.log("The document, as the editor last saved it:", config);
