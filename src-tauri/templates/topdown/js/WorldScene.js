import { createGrid } from "./grid.js";
import { findPath } from "./navigation.js";
import config from "./game.config.json" with { type: "json" };

// The top-down template. One scene serves all three projections: the
// difference between diamonds, squares and bare pixels lives in grid.js, and
// the projection reaches it through the config the editor wrote.
//
// A blank project has no lattice to draw and none to walk, so it draws no
// grid and navigates on a square lattice of the project's nominal unit —
// the same substitution the editor's own play mode makes.
export class WorldScene extends Phaser.Scene {
  constructor() {
    super("World");
  }

  preload() {
    this.grid = createGrid(config.projection, config.grid);
    this.nav = this.grid.snaps ? this.grid : createGrid("orthogonal", config.grid);
    for (const key of config.psdKeys ?? []) {
      this.P2P.load.load(this, key, `assets/${key}`);
    }
  }

  create() {
    this.drawGrid();
    this.placeDocument();
    this.spawnCharacter();

    this.input.on("pointerup", (pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.moveTo(this.nav.worldToCell(world.x, world.y));
    });
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
    // Layers are stored top-first; Phaser depth counts upward, so the last
    // layer in the list is the furthest back.
    const layers = config.layers ?? [];
    layers.forEach((layer, index) => {
      const depth = layers.length - index;
      if (layer.visible === false) return;

      for (const fill of layer.fills ?? []) {
        this.paintFill(fill, depth);
      }
      for (const placement of layer.placements ?? []) {
        const object = this.P2P.place(this, placement.psdKey, placement.layerPath);
        if (object && object.setPosition) {
          object.setPosition(placement.x, placement.y);
          object.setDepth(depth * 1000 + placement.y);
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

    if (fill.rect) {
      g.fillRect(fill.rect.x, fill.rect.y, fill.rect.width, fill.rect.height);
      return;
    }
    for (const cell of fill.cells ?? []) {
      g.fillPoints(
        pointsToVectors(this.grid.cellPolygon(cell.cx, cell.cy)),
        true,
        true,
      );
    }
  }

  spawnCharacter() {
    const start = config.spawn ?? { cx: 0, cy: 0 };
    const world = this.nav.cellToWorld(start.cx, start.cy);
    this.character = this.add
      .rectangle(world.x, world.y, this.grid.size * 0.3, this.grid.size * 0.5, 0x201e1d)
      .setDepth(1e6);
    this.characterCell = { ...start };
    this.cameras.main.startFollow(this.character, true, 0.12, 0.12);
  }

  moveTo(goal) {
    const path = findPath(
      (cx, cy) => this.isWalkable(cx, cy),
      this.characterCell,
      goal,
    );
    if (!path || path.length < 2) return;

    this.tweens.killTweensOf(this.character);
    const steps = path.slice(1).map((cell) => {
      const world = this.nav.cellToWorld(cell.cx, cell.cy);
      return { x: world.x, y: world.y, duration: 180 };
    });
    this.tweens.chain({ targets: this.character, tweens: steps });
    this.characterCell = path[path.length - 1];
  }

  isWalkable(cx, cy) {
    const span = config.gridSpan ?? 24;
    if (Math.abs(cx) > span || Math.abs(cy) > span) return false;

    const centre = this.nav.cellCentre(cx, cy);
    for (const layer of config.layers ?? []) {
      for (const fill of layer.fills ?? []) {
        if (fill.walkable) continue;
        for (const box of this.grid.fillBoxes(fill)) {
          if (contains(box, centre)) return false;
        }
      }
    }
    return true;
  }
}

function contains(box, p) {
  // Half-open, so a point on a shared edge belongs to one box rather than to
  // both — otherwise a run of adjacent fills blocks a cell either side of it.
  return (
    p.x >= box.x &&
    p.x < box.x + box.width &&
    p.y >= box.y &&
    p.y < box.y + box.height
  );
}

function pointsToVectors(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push(new Phaser.Math.Vector2(flat[i], flat[i + 1]));
  }
  return out;
}
