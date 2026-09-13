/**
 * What a file dragged over the canvas is currently over.
 *
 * A drop onto empty grid adds an image. A drop onto one that is already there
 * replaces the file behind it, which is a much larger thing to do by accident
 * — so whatever is under the pointer says so while the drag is still in the
 * air, and the confirmation that follows names it.
 *
 * The outline has graphics of its own rather than the selection overlay's.
 * Nothing is selected by dragging over it, and a highlight that moved the
 * selection would leave the wrong thing chosen when the drag was abandoned.
 * One accent, as everywhere else here, so a drop target is told apart from a
 * selection by its weight rather than by a second colour.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { instanceMembers, instanceOf, unionRect } from "./instance";
import { pickPlacement } from "./picking";

const ACCENT = 0xec3013;
/** Above the selection overlay, which is what it is drawn over. */
const DEPTH = 1_000_001;

/** A placed PSD under a pointer — what a dropped file would replace. */
export interface PlacedTarget {
  layerId: string;
  placementId: string;
  psdKey: string;
}

export class DropTargets {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly store: DocStore;

  constructor(graphics: Phaser.GameObjects.Graphics, store: DocStore) {
    this.graphics = graphics;
    this.graphics.setDepth(DEPTH);
    this.store = store;
  }

  /**
   * The placed PSD at a world point, if there is one.
   *
   * The document rather than the rendered objects, and the same front-most
   * rules a tap follows — so what a drop lands on is what a tap would have
   * selected.
   */
  at(worldX: number, worldY: number): PlacedTarget | null {
    const hit = pickPlacement(this.store.layers, worldX, worldY);
    if (!hit) return null;
    return {
      layerId: hit.layerId,
      placementId: hit.placement.id,
      psdKey: hit.placement.psdKey,
    };
  }

  /**
   * Outline what a drop would replace, or clear the outline.
   *
   * The box is the whole placed unit rather than the one layer under the
   * pointer: a PSD placed from three layers is three placements sharing an
   * instance, and replacing the file replaces what all three came from.
   *
   * @param zoom camera zoom, so the border keeps its weight on screen.
   */
  mark(target: PlacedTarget | null, zoom = 1): void {
    const g = this.graphics;
    g.clear();
    if (!target) return;

    const placement = this.store
      .layer(target.layerId)
      ?.placements.find((p) => p.id === target.placementId);
    if (!placement) return;
    const box = unionRect(
      instanceMembers(this.store.layers, target.layerId, instanceOf(placement)),
    );
    if (!box) return;

    const scale = 1 / zoom;
    g.fillStyle(ACCENT, 0.22);
    g.fillRect(box.x, box.y, box.width, box.height);
    g.lineStyle(4 * scale, ACCENT, 1);
    g.strokeRect(box.x, box.y, box.width, box.height);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
