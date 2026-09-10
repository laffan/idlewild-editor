/**
 * Play mode. The sidebars close, a character enters, the camera follows it,
 * and tapping the canvas walks there via A* over the document's walkable
 * cells.
 *
 * The navigation grid is derived from the document rather than stored: a cell
 * is blocked if a non-walkable fill covers it, or a blocking zone contains it.
 *
 * It is not always the *editor's* grid. A blank project addresses single
 * pixels, and a search over a pixel lattice would neither finish nor mean
 * anything, so navigation there runs on a square lattice of the project's
 * nominal unit — the grid scale chosen in New Game, which is what that
 * setting is for on a template that does not snap.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, cellKey, rectContains } from "../lib/grid";
import type { Cell, Point, Rect } from "../lib/types";
import { findPath } from "../lib/pathfinding";
import { pointInPolygon } from "./doc-renderer";
import type { PlayInput } from "./platformer";

/** How far the character may look for a route; the grid is unbounded. */
const SEARCH_LIMIT = 24;

/**
 * What play mode is, from the scene's side.
 *
 * Two implementations, one per genre, and each ignores what the other needs:
 * a top-down character is driven by taps and has no use for held movement, a
 * platformer is driven by held movement and has no use for taps. The scene
 * hands both to whichever it has rather than asking which it has.
 */
export interface PlayMode {
  start(): void;
  stop(): void;
  /** @param delta milliseconds since the previous frame. */
  update(delta: number, input: PlayInput): void;
  /** A tap on the canvas, in world coordinates. */
  tap(world: Point): void;
}

export class PlayController implements PlayMode {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;
  /** The lattice A* walks. The editor's own, unless it does not snap. */
  private readonly nav: Grid;

  private character: Phaser.GameObjects.Rectangle | null = null;
  private cell: Cell = { cx: 0, cy: 0 };
  private blocked = new Set<string>();

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
    this.nav = grid.snaps ? grid : new Grid("orthogonal", grid.size);
  }

  start(): void {
    this.rebuildNavigation();
    if (!this.character) {
      const world = this.nav.cellToWorld(this.cell);
      this.character = this.scene.add
        .rectangle(
          world.x,
          world.y,
          this.grid.size * 0.3,
          this.grid.size * 0.5,
          0x201e1d,
        )
        .setDepth(2_000_000);
    }
    this.character.setVisible(true);
    this.scene.cameras.main.startFollow(this.character, true, 0.12, 0.12);
  }

  stop(): void {
    this.scene.cameras.main.stopFollow();
    if (this.character) {
      this.scene.tweens.killTweensOf(this.character);
      this.character.setVisible(false);
    }
  }

  update(): void {
    // The character is tween-driven; nothing to integrate per frame yet.
  }

  /** Walking to a tapped point is the whole of this mode's input. */
  tap(world: Point): void {
    this.moveTo(world);
  }

  /** Recompute blocked cells from the document. */
  rebuildNavigation(): void {
    this.blocked.clear();
    for (const layer of this.store.layers) {
      if (!layer.visible) continue;
      for (const fill of layer.fills) {
        if (fill.walkable) continue;
        if (fill.rect) {
          // A rectangle in world pixels, blocking whichever nav cells it
          // covers — the same reduction the zones below go through.
          for (const cell of this.cellsUnderRect(fill.rect)) {
            this.blocked.add(cellKey(cell));
          }
          continue;
        }
        for (const cell of fill.cells) this.blocked.add(cellKey(cell));
      }
      for (const zone of layer.zones) {
        if (!zone.blocking) continue;
        for (const cell of this.cellsUnderZone(zone.points)) {
          this.blocked.add(cellKey(cell));
        }
      }
    }
  }

  /** The nav cells whose centres fall inside a world-space rectangle. */
  private cellsUnderRect(rect: Rect): Cell[] {
    const from = this.nav.worldToCell({ x: rect.x, y: rect.y });
    const to = this.nav.worldToCell({
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    });
    const out: Cell[] = [];
    for (let cy = from.cy; cy <= to.cy; cy++) {
      for (let cx = from.cx; cx <= to.cx; cx++) {
        if (rectContains(rect, this.nav.cellCentre({ cx, cy }))) {
          out.push({ cx, cy });
        }
      }
    }
    return out;
  }

  private cellsUnderZone(points: Array<{ x: number; y: number }>): Cell[] {
    if (points.length < 3) return [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    // Walk the polygon's bounding box in cell space and keep the centres that
    // actually fall inside it.
    const corners = [
      this.nav.worldToCell({ x: minX, y: minY }),
      this.nav.worldToCell({ x: maxX, y: minY }),
      this.nav.worldToCell({ x: maxX, y: maxY }),
      this.nav.worldToCell({ x: minX, y: maxY }),
    ];
    const cxs = corners.map((c) => c.cx);
    const cys = corners.map((c) => c.cy);

    const out: Cell[] = [];
    for (let cy = Math.min(...cys); cy <= Math.max(...cys); cy++) {
      for (let cx = Math.min(...cxs); cx <= Math.max(...cxs); cx++) {
        const centre = this.nav.cellCentre({ cx, cy });
        if (pointInPolygon(centre, points)) out.push({ cx, cy });
      }
    }
    return out;
  }

  /** Walk to a world point — the scene hands over where the tap landed. */
  moveTo(target: Point): void {
    if (!this.character) return;
    this.rebuildNavigation();
    const goal = this.nav.worldToCell(target);

    const path = findPath(
      (cx, cy) => this.isWalkable({ cx, cy }, goal),
      this.cell,
      goal,
    );
    if (!path || path.length < 2) return;

    this.scene.tweens.killTweensOf(this.character);
    this.scene.tweens.chain({
      targets: this.character,
      tweens: path.slice(1).map((step) => {
        const world = this.nav.cellToWorld(step);
        return { x: world.x, y: world.y, duration: 180, ease: "Linear" };
      }),
    });
    this.cell = path[path.length - 1];
  }

  private isWalkable(cell: Cell, goal: Cell): boolean {
    if (this.blocked.has(cellKey(cell))) return false;
    // Keep the search bounded around the trip; the grid has no edges.
    const spanX = Math.abs(cell.cx - this.cell.cx);
    const spanY = Math.abs(cell.cy - this.cell.cy);
    const reach = SEARCH_LIMIT + Math.abs(goal.cx - this.cell.cx) + Math.abs(goal.cy - this.cell.cy);
    return spanX <= reach && spanY <= reach;
  }
}
