/**
 * Draws the document into the scene: fills, zones and PSD placements.
 *
 * Layers are stored top-first (Hush's convention), and Phaser depth counts
 * upward, so layer index N of M renders at depth (M - N).
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import type { FillPatch, Layer, Placement, Zone } from "../lib/types";
import * as log from "../lib/log";

const DEPTH_STRIDE = 1000;

/** What a hit-test returns: the document record, not the rendered object. */
export interface PickResult {
  layerId: string;
  placement: Placement;
}

export interface PlacementView {
  placement: Placement;
  layerId: string;
  object: Phaser.GameObjects.GameObject & {
    x: number;
    y: number;
    setPosition(x: number, y: number): unknown;
    setDepth(v: number): unknown;
    setVisible(v: boolean): unknown;
  };
}

export class DocRenderer {
  private readonly grid: Grid;
  private readonly store: DocStore;
  private readonly fillGraphics: Phaser.GameObjects.Graphics;
  private readonly zoneGraphics: Phaser.GameObjects.Graphics;
  private readonly placements = new Map<string, PlacementView>();

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.store = store;
    this.grid = grid;
    this.fillGraphics = scene.add.graphics();
    this.zoneGraphics = scene.add.graphics();
  }

  /** Repaint everything the document describes. */
  render(): void {
    this.renderFills();
    this.renderZones();
    this.syncPlacements();
  }

  private renderFills(): void {
    const g = this.fillGraphics;
    g.clear();

    const layers = this.store.layers;
    layers.forEach((layer, index) => {
      if (!layer.visible) return;
      g.setDepth((layers.length - index) * DEPTH_STRIDE);
      for (const fill of layer.fills) this.paintFill(g, fill);
    });
  }

  private paintFill(g: Phaser.GameObjects.Graphics, fill: FillPatch): void {
    // Pattern fills carry a PSD texture; until it has loaded, and for colour
    // fills, a flat colour is what the grid shows.
    const colour = hexToNumber(fill.color ?? "#ec3013");
    g.fillStyle(colour, fill.kind === "pattern" ? 0.35 : 1);

    for (const cell of fill.cells) {
      const points = this.grid.cellPolygon(cell);
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
      g.closePath();
      g.fillPath();
    }
  }

  private renderZones(): void {
    const g = this.zoneGraphics;
    g.clear();
    g.setDepth(900_000);

    for (const layer of this.store.layers) {
      if (!layer.visible) continue;
      for (const zone of layer.zones) this.paintZone(g, zone);
    }
  }

  private paintZone(g: Phaser.GameObjects.Graphics, zone: Zone): void {
    if (zone.points.length < 2) return;
    // Boundaries read as dashed outlines — the same language the design
    // canvas used for them.
    g.lineStyle(1.5, zone.blocking ? 0xec3013 : 0x7d7979, 1);
    g.beginPath();
    g.moveTo(zone.points[0].x, zone.points[0].y);
    for (let i = 1; i < zone.points.length; i++) {
      g.lineTo(zone.points[i].x, zone.points[i].y);
    }
    g.closePath();
    g.strokePath();
  }

  /** Position and depth-sort placed PSD objects; drop views whose placement
   *  is gone. */
  private syncPlacements(): void {
    const seen = new Set<string>();
    const layers = this.store.layers;

    layers.forEach((layer, index) => {
      const depth = (layers.length - index) * DEPTH_STRIDE;
      for (const placement of layer.placements) {
        seen.add(placement.id);
        const view = this.placements.get(placement.id);
        if (!view) continue;
        view.placement = placement;
        view.object.setPosition(placement.x, placement.y);
        // Isometric scenes sort on screen Y so nearer objects draw in front.
        view.object.setDepth(
          this.grid.projection === "isometric" ? depth + placement.y : depth,
        );
        view.object.setVisible(layer.visible);
      }
    });

    for (const [id, view] of this.placements) {
      if (seen.has(id)) continue;
      view.object.destroy();
      this.placements.delete(id);
    }
  }

  /**
   * Attach a placed psd-to-phaser object to its placement record. The scene
   * owns the P2P call; this owns where the result sits.
   */
  attach(layerId: string, placement: Placement, object: unknown): void {
    const candidate = object as PlacementView["object"] | null;
    if (!candidate || typeof candidate.setPosition !== "function") {
      log.warn(`psd-to-phaser returned nothing placeable for ${placement.psdKey}`);
      return;
    }
    this.placements.set(placement.id, { placement, layerId, object: candidate });
    this.syncPlacements();
  }

  /** Hit-test placements front to back. See `pickPlacement`. */
  pick(worldX: number, worldY: number): PickResult | undefined {
    return pickPlacement(this.store.layers, worldX, worldY);
  }

  destroy(): void {
    this.fillGraphics.destroy();
    this.zoneGraphics.destroy();
    for (const view of this.placements.values()) view.object.destroy();
    this.placements.clear();
  }
}

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16) || 0;
}

export function layerDepth(layers: readonly Layer[], layerId: string): number {
  const index = layers.findIndex((l) => l.id === layerId);
  return index < 0 ? 0 : (layers.length - index) * DEPTH_STRIDE;
}

/**
 * Find the front-most placement under a world point.
 *
 * This reads the document rather than the rendered Phaser objects: a
 * placement whose texture failed to load still has bounds, and has to stay
 * selectable so it can be inspected or removed.
 *
 * Layers are stored top-first and, within a layer, a later placement draws
 * over an earlier one — so the front-most candidate is the earliest layer's
 * final placement. Locked and hidden layers are inert to the pointer, the
 * same rule Hush applies to its own pick paths.
 */
export function pickPlacement(
  layers: readonly Layer[],
  worldX: number,
  worldY: number,
): PickResult | undefined {
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    for (let i = layer.placements.length - 1; i >= 0; i--) {
      const placement = layer.placements[i];
      if (
        worldX >= placement.x &&
        worldX <= placement.x + placement.width &&
        worldY >= placement.y &&
        worldY <= placement.y + placement.height
      ) {
        return { layerId: layer.id, placement };
      }
    }
  }
  return undefined;
}
