// A Phaser 4 game, running, with nothing loaded into it.
//
// The editor's artwork is in `assets/`, one directory per PSD, each with the
// `data.json` psd-to-json wrote describing its layers, and `game.config.json`
// beside this file is the document as data. Nothing here reads either: what
// to load, and how, is yours. Phaser's own loader is enough for a PNG —
//
//   preload() { this.load.image("tree", "assets/tree/tree.png"); }
//   create()  { this.add.image(120, 80, "tree"); }
//
// Served rather than opened from disk, like any module. Play already serves
// it, and an export's README says the same.

class Main extends Phaser.Scene {
  constructor() {
    super("Main");
  }

  preload() {}

  create() {
    this.add.text(24, 24, "Phaser is running.", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "16px",
      color: "#f4f2ef",
    });
  }

  update(time, delta) {}
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#2d2b2b",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Main],
});
