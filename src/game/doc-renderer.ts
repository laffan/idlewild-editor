/**
 * Draws the document into the scene: fills, zones and PSD placements.
 *
 * Layers are stored top-first (Hush's convention), and Phaser depth counts
 * upward, so layer index N of M renders at depth (M - N).
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, fillShape } from "../lib/grid";
import type { FillPatch, Layer, Placement, Zone } from "../lib/types";
import * as log from "../lib/log";

const DEPTH_STRIDE = 1000;

/** What a hit-test returns: the document record, not the rendered object. */
export interface PickResult {
  layerId: string;
  placement: Placement;
}

/** The same, for a boundary. */
export interface ZonePickResult {
  layerId: string;
  zone: Zone;
}

/**
 * What `P2P.place()` hands back.
 *
 * For every layer category it is a `Phaser.GameObjects.Group` holding the
 * real display objects, with `setPosition` grafted on by the plugin's
 * `attachMethods`. It is not a `GameObject`, so it is typed structurally.
 */
export interface PlacedObject {
  setPosition(x: number, y: number): unknown;
  setScale(x: number, y: number): unknown;
  setDepth(v: number): unknown;
  setVisible(v: boolean): unknown;
  destroy(destroyChildren?: boolean): void;
  /** Present on a Group, which is what `place()` always returns. */
  getChildren?: () => unknown[];
}

export interface PlacementView {
  placement: Placement;
  layerId: string;
  object: PlacedObject;
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
    const shape = fillShape(this.grid, fill);
    if (!shape) return;
    const colour = hexToNumber(fill.color ?? "#ec3013");
    g.fillStyle(colour, fill.kind === "pattern" ? 0.35 : 1);

    for (const points of shape.polygons) {
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
        // A placement can be carried to another layer from the layer panel,
        // and the view is what any later lookup by id reads.
        view.layerId = layer.id;
        view.object.setPosition(placement.x, placement.y);
        applyScale(view.object, placement);
        // Isometric scenes sort on screen Y so nearer objects draw in front.
        view.object.setDepth(
          this.grid.projection === "isometric" ? depth + placement.y : depth,
        );
        view.object.setVisible(layer.visible);
      }
    });

    for (const [id, view] of this.placements) {
      if (seen.has(id)) continue;
      destroyPlaced(view.object);
      this.placements.delete(id);
    }
  }

  /**
   * Attach a placed psd-to-phaser object to its placement record. The scene
   * owns the P2P call; this owns where the result sits.
   */
  attach(layerId: string, placement: Placement, object: unknown): void {
    const candidate = object as PlacedObject | null;
    if (!candidate || typeof candidate.setPosition !== "function") {
      log.warn(`psd-to-phaser returned nothing placeable for ${placement.psdKey}`);
      return;
    }
    this.placements.set(placement.id, { placement, layerId, object: candidate });
    this.syncPlacements();
  }

  /**
   * Drop the rendered objects for one PSD key, leaving the placements in the
   * document. A re-import replaces the textures behind a key, so what is on
   * screen has to go before the new file is loaded and placed again.
   */
  detachKey(psdKey: string): void {
    for (const [id, view] of this.placements) {
      if (view.placement.psdKey !== psdKey) continue;
      destroyPlaced(view.object);
      this.placements.delete(id);
    }
  }

  /** Drop one placement's rendered object, leaving its record alone. */
  detachOne(placementId: string): void {
    const view = this.placements.get(placementId);
    if (!view) return;
    destroyPlaced(view.object);
    this.placements.delete(placementId);
  }

  /** Hit-test placements front to back. See `pickPlacement`. */
  pick(worldX: number, worldY: number): PickResult | undefined {
    return pickPlacement(this.store.layers, worldX, worldY);
  }

  /** The same for boundaries. See `pickZone`. */
  pickZone(worldX: number, worldY: number): ZonePickResult | undefined {
    return pickZone(this.store.layers, worldX, worldY);
  }

  destroy(): void {
    this.fillGraphics.destroy();
    this.zoneGraphics.destroy();
    for (const view of this.placements.values()) destroyPlaced(view.object);
    this.placements.clear();
  }
}

/**
 * Destroy what `place()` returned, children included.
 *
 * A Phaser Group is not a display container: its children live on the
 * scene's own display list, and `Group.destroy()` defaults to
 * `destroyChildren = false`. Destroying the group alone therefore removed the
 * record but left the sprite on screen — a deleted image that would not go
 * away. Anything else gets the plain no-argument destroy, because
 * `GameObject.destroy(fromScene)` reads its first argument entirely
 * differently and passing `true` there would skip removing it from the
 * display list.
 */
export function destroyPlaced(object: PlacedObject): void {
  // Detected structurally rather than with `instanceof`, so this module stays
  // free of a runtime Phaser import and its pure helpers remain testable
  // outside a browser. `getChildren` is Group's defining method.
  if (typeof object.getChildren === "function") {
    object.destroy(true);
    return;
  }
  object.destroy();
}

/**
 * Scale a placed object to its displayed size.
 *
 * `setScale` is forwarded by the plugin to the group's children, and a sprite
 * placed with `setOrigin(0, 0)` scales away from its top-left — which is the
 * corner the placement's x/y describes, so the box and the image agree.
 *
 * A group holding several sprites scales each one about its own origin, so
 * their relative offsets do not grow with it. Scaling a multi-layer
 * composition as a unit needs a Container, and `place()` returns a Group.
 */
function applyScale(object: PlacedObject, placement: Placement): void {
  const naturalWidth = placement.naturalWidth ?? placement.width;
  const naturalHeight = placement.naturalHeight ?? placement.height;
  if (!naturalWidth || !naturalHeight) return;
  object.setScale(
    placement.width / naturalWidth,
    placement.height / naturalHeight,
  );
}

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16) || 0;
}

/**
 * Find the front-most boundary under a world point.
 *
 * The same rules as `pickPlacement` — the document rather than the rendered
 * graphics, top-first layers, the last zone on a layer drawing over the ones
 * before it, locked and hidden layers inert — with the box test replaced by a
 * polygon test, because a boundary is a shape rather than a rectangle and
 * selecting one by its bounding box would catch the empty corners of every
 * L-shaped wall in the project.
 */
export function pickZone(
  layers: readonly Layer[],
  worldX: number,
  worldY: number,
): ZonePickResult | undefined {
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    for (let i = layer.zones.length - 1; i >= 0; i--) {
      const zone = layer.zones[i];
      if (pointInPolygon({ x: worldX, y: worldY }, zone.points)) {
        return { layerId: layer.id, zone };
      }
    }
  }
  return undefined;
}

/**
 * Even-odd containment. Shared with play mode's navigation, which asks the
 * same question of the same polygons from the other end.
 */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: readonly { x: number; y: number }[],
): boolean {
  if (polygon.length < 3) return false;
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
