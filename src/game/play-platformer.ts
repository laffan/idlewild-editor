/**
 * Play mode for a platformer project.
 *
 * The counterpart to `play-controller.ts`, which walks a character over the
 * grid. Here the same document is read side-on: gravity pulls down the
 * screen, and every non-walkable fill and blocking boundary is ground rather
 * than an obstacle to route around.
 *
 * The maths is in `platformer.ts`, kept pure and tested. This is the part
 * that owns a rectangle on the scene and the camera that follows it.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { Point, Rect } from "../lib/types";
import {
  createBody,
  respawn,
  solidsFromDocument,
  stepBody,
  type Body,
  type PlayInput,
} from "./platformer";
import type { PlayMode } from "./play-controller";

/**
 * The longest frame the body is stepped by.
 *
 * A tab left in the background hands back one enormous delta on its return,
 * and a body integrated by it passes straight through the floor.
 */
const MAX_STEP_MS = 50;

export class PlatformerController implements PlayMode {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;

  private character: Phaser.GameObjects.Rectangle | null = null;
  private body: Body | null = null;
  private solids: Rect[] = [];

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
  }

  start(): void {
    this.rebuildSolids();

    const width = this.grid.size * 0.4;
    const height = this.grid.size * 0.8;
    if (!this.body) {
      const spawn = this.grid.cellCentre({ cx: 0, cy: 0 });
      this.body = createBody(spawn.x, spawn.y, width, height);
    } else {
      respawn(this.body);
    }

    if (!this.character) {
      this.character = this.scene.add
        .rectangle(this.body.x, this.body.y, width, height, 0x201e1d)
        .setDepth(2_000_000);
    }
    this.character.setPosition(this.body.x, this.body.y);
    this.character.setVisible(true);
    this.scene.cameras.main.startFollow(this.character, true, 0.14, 0.14);
  }

  stop(): void {
    this.scene.cameras.main.stopFollow();
    this.character?.setVisible(false);
  }

  update(delta: number, input: PlayInput): void {
    if (!this.body || !this.character) return;
    // The ground is the document, and the document is editable while play
    // mode is running — so it is read every frame rather than once on start.
    this.rebuildSolids();
    stepBody(this.body, this.solids, input, Math.min(delta, MAX_STEP_MS) / 1000);
    this.character.setPosition(this.body.x, this.body.y);
  }

  /**
   * A tap on the canvas.
   *
   * Nothing: a platformer is driven by held controls, and teleporting the
   * character to wherever the finger landed would undo the only rule the mode
   * has. The play pad and the arrow keys are how it moves.
   */
  tap(_world: Point): void {}

  private rebuildSolids(): void {
    this.solids = solidsFromDocument(this.grid, this.store.layers);
  }
}
