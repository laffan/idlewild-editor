/**
 * Play mode. The sidebars close, a character enters, the camera follows it,
 * and tapping the canvas walks there via A* over the document's walkable
 * cells.
 *
 * The navigation grid is derived from the document rather than stored: a cell
 * is blocked if a non-walkable fill covers it, or a blocking zone contains it.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, cellKey } from "../lib/grid";
import type { Cell } from "../lib/types";
import { findPath } from "../lib/pathfinding";

/** How far the character may look for a route; the grid is unbounded. */
const SEARCH_LIMIT = 24;

export class PlayController {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;

  private character: Phaser.GameObjects.Rectangle | null = null;
  private cell: Cell = { cx: 0, cy: 0 };
  private blocked = new Set<string>();

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
  }

  start(): void {
    this.rebuildNavigation();
    if (!this.character) {
      const world = this.grid.cellToWorld(this.cell);
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

  /** Recompute blocked cells from the document. */
  rebuildNavigation(): void {
    this.blocked.clear();
    for (const layer of this.store.layers) {
      if (!layer.visible) continue;
      for (const fill of layer.fills) {
        if (fill.walkable) continue;
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
      this.grid.worldToCell({ x: minX, y: minY }),
      this.grid.worldToCell({ x: maxX, y: minY }),
      this.grid.worldToCell({ x: maxX, y: maxY }),
      this.grid.worldToCell({ x: minX, y: maxY }),
    ];
    const cxs = corners.map((c) => c.cx);
    const cys = corners.map((c) => c.cy);

    const out: Cell[] = [];
    for (let cy = Math.min(...cys); cy <= Math.max(...cys); cy++) {
      for (let cx = Math.min(...cxs); cx <= Math.max(...cxs); cx++) {
        const centre = this.grid.cellToWorld({ cx, cy });
        if (pointInPolygon(centre, points)) out.push({ cx, cy });
      }
    }
    return out;
  }

  moveTo(goal: Cell): void {
    if (!this.character) return;
    this.rebuildNavigation();

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
        const world = this.grid.cellToWorld(step);
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

function pointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
