import { createGrid } from "./grid.js";
import { createBody, solidsFromDocument, stepBody } from "./physics.js";
import config from "./game.config.json" with { type: "json" };

// The platformer template. Side-on: gravity pulls down the screen, the
// character runs and jumps, and the document's *blocking* geometry — every
// fill marked not-walkable, every blocking boundary — is the ground it stands
// on rather than an obstacle to route around. That is the whole difference
// between the two styles: the same document, read as a floor plan or as a
// cross-section.
//
// Physics is hand-rolled in physics.js rather than taken from Arcade. What a
// platformer needs from a body is an AABB sweep against a list of solids, and
// keeping it in a file of the project's own is what makes it something to
// change rather than a plugin to configure around.
export class WorldScene extends Phaser.Scene {
  constructor() {
    super("World");
  }

  preload() {
    this.grid = createGrid(config.projection, config.grid);
    for (const key of config.psdKeys ?? []) {
      this.P2P.load.load(this, key, `assets/${key}`);
    }
  }

  create() {
    this.solids = solidsFromDocument(this.grid, config.layers ?? []);
    this.drawGrid();
    this.placeDocument();
    this.spawnCharacter();
    this.bindControls();
  }

  update(_time, delta) {
    if (!this.body) return;
    // A tab left in the background hands back one enormous frame; a body
    // stepped by it teleports through the floor.
    stepBody(this.body, this.solids, this.keys, Math.min(delta, 50) / 1000);
    this.character.setPosition(this.body.x, this.body.y);
  }

  drawGrid() {
    if (!this.grid.snaps) return;
    const g = this.add.graphics().setDepth(-1000);
    g.lineStyle(1, 0xa9c2d3, 1);
    const span = config.gridSpan ?? 24;
    for (let cx = -span; cx <= span; cx++) {
      for (let cy = -span; cy <= span; cy++) {
        g.strokePoints(
          pointsToVectors(this.grid.cellPolygon(cx, cy)),
          true,
          true,
        );
      }
    }
  }

  placeDocument() {
    const layers = config.layers ?? [];
    layers.forEach((layer, index) => {
      const depth = layers.length - index;
      if (layer.visible === false) return;

      for (const fill of layer.fills ?? []) this.paintFill(fill, depth);
      for (const placement of layer.placements ?? []) {
        const object = this.P2P.place(this, placement.psdKey, placement.layerPath);
        if (object && object.setPosition) {
          object.setPosition(placement.x, placement.y);
          object.setDepth(depth * 1000);
        }
      }
    });
  }

  paintFill(fill, depth) {
    const g = this.add.graphics().setDepth(depth * 1000);
    const color = Phaser.Display.Color.HexStringToColor(
      fill.color ?? "#ec3013",
    ).color;
    g.fillStyle(color, 1);
    for (const box of this.grid.fillBoxes(fill)) {
      g.fillRect(box.x, box.y, box.width, box.height);
    }
  }

  spawnCharacter() {
    const start = config.spawn ?? { cx: 0, cy: 0 };
    const world = this.grid.cellCentre(start.cx, start.cy);
    const width = this.grid.size * 0.4;
    const height = this.grid.size * 0.8;

    this.body = createBody(world.x, world.y, width, height);
    this.character = this.add
      .rectangle(this.body.x, this.body.y, width, height, 0x201e1d)
      .setDepth(1e6);
    this.cameras.main.startFollow(this.character, true, 0.14, 0.14);
  }

  /**
   * Arrow keys and WASD, plus three buttons pinned to the viewport for a
   * touchscreen. `setScrollFactor(0)` is what keeps them still while the
   * camera follows the character.
   */
  bindControls() {
    const keys = { left: false, right: false, jump: false };
    this.keys = keys;

    const held = new Set();
    const map = {
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      ArrowUp: "jump",
      KeyW: "jump",
      Space: "jump",
    };
    const apply = () => {
      keys.left = held.has("left");
      keys.right = held.has("right");
      keys.jump = held.has("jump");
    };

    this.input.keyboard.on("keydown", (event) => {
      const action = map[event.code];
      if (!action) return;
      event.preventDefault();
      held.add(action);
      apply();
    });
    this.input.keyboard.on("keyup", (event) => {
      const action = map[event.code];
      if (!action) return;
      held.delete(action);
      apply();
    });

    const pad = [
      { action: "left", label: "◀", x: 90 },
      { action: "right", label: "▶", x: 210 },
      { action: "jump", label: "▲", x: null },
    ];
    for (const button of pad) {
      const zone = this.add
        .rectangle(0, 0, 96, 96, 0x201e1d, 0.28)
        .setScrollFactor(0)
        .setDepth(2e6)
        .setInteractive();
      const glyph = this.add
        .text(0, 0, button.label, { fontSize: "34px", color: "#f3f2f2" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(2e6 + 1);

      const place = () => {
        const y = this.scale.height - 90;
        const x = button.x ?? this.scale.width - 90;
        zone.setPosition(x, y);
        glyph.setPosition(x, y);
      };
      place();
      this.scale.on("resize", place);

      zone.on("pointerdown", () => {
        held.add(button.action);
        apply();
      });
      const release = () => {
        held.delete(button.action);
        apply();
      };
      zone.on("pointerup", release);
      zone.on("pointerout", release);
    }
  }
}

function pointsToVectors(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push(new Phaser.Math.Vector2(flat[i], flat[i + 1]));
  }
  return out;
}
