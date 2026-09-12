/**
 * Draws the document into the scene: fills, points, zones and PSD placements.
 *
 * Layers are stored top-first (Hush's convention), and Phaser depth counts
 * upward, so layer index N of M renders at depth (M - N) × `DEPTH_STRIDE`.
 * The stride is what a document layer's own contents are ordered *within* —
 * see `drawOrder`, which is where a placed PSD keeps the stacking its author
 * gave it.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { convexOverlapsRect, Grid, fillShape } from "../lib/grid";
import { instanceOf } from "./instance";
import { applyTransform, partsOf, type PlacedPart } from "./placed-parts";
import type {
  Cell,
  FillPatch,
  Layer,
  MapPoint,
  Placement,
  Point,
  Rect,
  Selection,
  Zone,
} from "../lib/types";
import * as log from "../lib/log";

const DEPTH_STRIDE = 1000;

/** The accent, which is what every mark the editor makes is drawn in. */
const POINT_COLOR = 0xec3013;
/**
 * And the light the marker is haloed in.
 *
 * A point is the accent like everything else the editor draws, and the first
 * one anybody puts down goes on a fill — which is the same accent. A red ring
 * on a red patch is not a marker. So every stroke is laid twice: a thicker
 * light pass, then the accent over it, which reads on the pale grid, on a
 * fill of any colour, and on artwork.
 */
const POINT_HALO = 0xf3f2f2;

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

/** And for a named place. */
export interface PointPickResult {
  layerId: string;
  point: MapPoint;
}

/**
 * How big a point's marker is, against the grid.
 *
 * Drawn in world units rather than at a fixed screen size, like everything
 * else this renderer puts down: a point is a thing standing on a space, and
 * it should grow and shrink with the space it stands on.
 */
const POINT_RADIUS = 0.22;
/**
 * And how far from the middle of one a tap still counts, in the same units.
 *
 * Half a tile's height, which on a 64 px grid is sixteen world pixels: a
 * finger's worth without being a whole space, so a point never swallows the
 * tap meant for the ground it is standing on.
 */
const POINT_REACH = 0.5;

/**
 * How near a point a finger has to land to mean it, in world pixels.
 *
 * Shared with the drag controller, which asks the same question of the same
 * marker: picking one up has to have the same reach as picking it, or a point
 * can be selected in a place where it cannot then be moved.
 */
export function pointReach(grid: Grid): number {
  return grid.tileHeight * POINT_REACH;
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
  /**
   * The pieces inside it, and where each one sits. Read once, when the
   * plugin has just made them and they still stand where the manifest put
   * them — see `placed-parts.ts`.
   */
  parts: PlacedPart[];
}

export class DocRenderer {
  private readonly grid: Grid;
  private readonly store: DocStore;
  private readonly fillGraphics: Phaser.GameObjects.Graphics;
  private readonly zoneGraphics: Phaser.GameObjects.Graphics;
  private readonly pointGraphics: Phaser.GameObjects.Graphics;
  private readonly placements = new Map<string, PlacementView>();
  /**
   * A placed unit that is being worked on somewhere else and must not draw.
   *
   * Extrude mode is the one user of this: a solid reopened to carry on with
   * stands on exactly the ground its own flat artwork covers, and drawing
   * both is seeing double. Held here rather than on the document because it
   * is a fact about what is on screen this second, not about the project —
   * the placement is untouched, and a cancelled session leaves no trace.
   */
  private hidden: string | null = null;

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.store = store;
    this.grid = grid;
    this.fillGraphics = scene.add.graphics();
    this.zoneGraphics = scene.add.graphics();
    this.pointGraphics = scene.add.graphics();
  }

  /** Keep one placed unit off the canvas while something else has it. */
  suppressInstance(instance: string | null): void {
    if (this.hidden === instance) return;
    this.hidden = instance;
    this.syncPlacements();
  }

  /** Repaint everything the document describes. */
  render(): void {
    this.renderFills();
    this.renderZones();
    this.renderPoints();
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

  /**
   * The named places, over everything else.
   *
   * A point has no size and nothing to fill, so what is drawn is a marker
   * rather than the thing itself — which is why it goes above the artwork
   * instead of taking a depth from the layer it belongs to. A marker hidden
   * behind a building is a marker nobody can find or pick up.
   *
   * The scene's start point is filled and the rest are rings. One glance
   * rather than a label: a scene has at most one, and reading a name off the
   * canvas at any useful zoom is not something to design around.
   */
  private renderPoints(): void {
    const g = this.pointGraphics;
    g.clear();
    g.setDepth(910_000);

    const start = this.store.activeScene.startPointId;
    const radius = this.grid.tileHeight * POINT_RADIUS;
    for (const layer of this.store.layers) {
      if (!layer.visible) continue;
      for (const point of layer.points) {
        const at = this.grid.cellCentre(point.cell);
        const isStart = point.id === start;
        // The halo pass, then the mark over it.
        for (const [colour, width] of [
          [POINT_HALO, 4],
          [POINT_COLOR, 1.5],
        ] as const) {
          g.lineStyle(width, colour, 1);
          g.strokeCircle(at.x, at.y, radius);
          // A second ring around the one the scene starts on — the extra
          // thing about it, drawn as an extra thing.
          if (isStart) g.strokeCircle(at.x, at.y, radius * 1.8);
        }
        g.fillStyle(POINT_COLOR, 1);
        g.fillCircle(at.x, at.y, radius * (isStart ? 0.55 : 0.28));
      }
    }
  }

  /** Position and depth-sort placed PSD objects; drop views whose placement
   *  is gone. */
  private syncPlacements(): void {
    const seen = new Set<string>();
    const layers = this.store.layers;
    const isometric = this.grid.projection === "isometric";

    layers.forEach((layer, index) => {
      const base = (layers.length - index) * DEPTH_STRIDE;
      // Back to front, once for the whole layer: every placement then takes
      // the next depth up, so what is above what is decided here rather than
      // by the order Phaser happened to be handed the objects in.
      const order = drawOrder(layer.placements, isometric);

      order.forEach((placement, step) => {
        seen.add(placement.id);
        const view = this.placements.get(placement.id);
        if (!view) return;
        view.placement = placement;
        // A placement can be carried to another layer from the layer panel,
        // and the view is what any later lookup by id reads.
        view.layerId = layer.id;
        // Every piece at its own offset, scaled — not all of them on the
        // placement's corner, which is what the plugin's own `setPosition`
        // does to a group. See `placed-parts.ts`.
        applyTransform(view.object, view.parts, placement);
        applyDepth(view.object, base + step);
        view.object.setVisible(
          layer.visible && instanceOf(placement) !== this.hidden,
        );
      });
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
    this.placements.set(placement.id, {
      placement,
      layerId,
      object: candidate,
      parts: partsOf(candidate),
    });
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

  /** And for named places, within a finger's reach of one. */
  pickPoint(worldX: number, worldY: number): PointPickResult | undefined {
    return pickPoint(this.grid, this.store.layers, worldX, worldY);
  }

  /**
   * What a tap on the canvas picks, in the order it asks.
   *
   * **A point first.** It is the smallest thing in the document and the only
   * one drawn over everything else, so a point standing on a building has to
   * win the tap or it can never be picked up at all — and its reach is a
   * third of a space, so nothing else is caught by it.
   *
   * **Then an image.** Then a boundary: a boundary is a thing someone made
   * and a fill is the ground it was made over, so it comes first of those
   * two — but behind images, because a boundary is usually drawn *around*
   * them and would otherwise swallow every tap meant for what is inside it.
   * It is hit-tested against its polygon rather than its box, so an L-shaped
   * wall is not selected by the empty corner of the box around it.
   *
   * **Then a fill**, on the active layer only, and last of all nothing.
   */
  pickAt(world: Point, activeLayerId: string): Selection {
    const point = this.pickPoint(world.x, world.y);
    if (point) {
      return { kind: "point", layerId: point.layerId, pointId: point.point.id };
    }

    const hit = this.pick(world.x, world.y);
    if (hit) {
      return {
        kind: "placement",
        layerId: hit.layerId,
        placementId: hit.placement.id,
      };
    }

    const zone = this.pickZone(world.x, world.y);
    if (zone) {
      return { kind: "zone", layerId: zone.layerId, zoneId: zone.zone.id };
    }

    const cell: Cell = this.grid.worldToCell(world);
    const layer = this.store.layer(activeLayerId);
    const fill = layer && !layer.locked ? this.store.fillAt(layer.id, cell) : undefined;
    if (fill && layer) return { kind: "fill", layerId: layer.id, fillId: fill.id };

    return { kind: "none" };
  }

  destroy(): void {
    this.fillGraphics.destroy();
    this.zoneGraphics.destroy();
    this.pointGraphics.destroy();
    for (const view of this.placements.values()) destroyPlaced(view.object);
    this.placements.clear();
  }
}

/**
 * Give a placed object its depth, keeping a group's own stacking under it.
 *
 * psd-to-phaser grafts its own `setDepth` onto a Group, and that one recurses:
 * every child is given the *same* number. For a PSD placed one layer at a time
 * that was harmless — a Group of one — but an extrusion's artwork is a group
 * of three, and one number for all of them is the stacking gone. The file was
 * right and the canvas was wrong, which is the worst way for this to fail.
 *
 * So a group's children are ranked by the depth they already have — which
 * psd-to-phaser set from the manifest's `initialDepth` when it made them — and
 * spread across the interval below the next placement. Fractions rather than
 * whole numbers because the placements on a document layer are one apart, and
 * there is no room between them for anything else.
 *
 * Idempotent: ranking on the current depth gives the same order next time,
 * because the spread is monotonic in the rank.
 */
function applyDepth(object: PlacedObject, depth: number): void {
  const children = object.getChildren?.() ?? [];
  if (children.length < 2) {
    object.setDepth(depth);
    return;
  }
  const ranked = [...children].sort((a, b) => depthOf(a) - depthOf(b));
  ranked.forEach((child, rank) => {
    const at = depth + (rank + 1) / (ranked.length + 1);
    (child as { setDepth?: (v: number) => unknown }).setDepth?.(at);
  });
}

function depthOf(child: unknown): number {
  const depth = (child as { depth?: unknown }).depth;
  return typeof depth === "number" ? depth : 0;
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
 * The nearest named place within reach of a world point.
 *
 * Nearest rather than front-most, which is what every other picker here
 * answers: two markers close together are two dots a finger lands between,
 * and the one under the middle of the finger is the one meant. Locked and
 * hidden layers are inert, the same rule the others follow.
 */
export function pickPoint(
  grid: Grid,
  layers: readonly Layer[],
  worldX: number,
  worldY: number,
): PointPickResult | undefined {
  let best: PointPickResult | undefined;
  let nearest = pointReach(grid);
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    for (const point of layer.points) {
      const at = grid.cellCentre(point.cell);
      const distance = Math.hypot(at.x - worldX, at.y - worldY);
      if (distance > nearest) continue;
      nearest = distance;
      best = { layerId: layer.id, point };
    }
  }
  return best;
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

/**
 * Everything on one document layer, back to front.
 *
 * Two orderings, one inside the other.
 *
 * **Between placed PSDs.** An isometric scene sorts them on screen Y, so a
 * thing standing nearer the viewer draws in front of one behind it. A unit
 * sorts on its *own* Y rather than each of its layers separately: a roof sits
 * higher up the screen than the tower under it, and sorting the two against
 * each other would put the roof behind the building every time. Flat
 * projections leave them in the order they were placed.
 *
 * **Within one placed PSD.** The author's stack, and nothing else. A PSD is a
 * stack of layers and the order is the artwork — psd-to-json reports it,
 * psd-to-phaser applies it to every object it creates, and this used to
 * overwrite all of them with a single depth per document layer, which left
 * the stacking to the order Phaser was handed the objects in. That order was
 * top-first, so every multi-layer PSD was drawn upside down.
 */
export function drawOrder(
  placements: readonly Placement[],
  isometric: boolean,
): Placement[] {
  const units = new Map<string, Placement[]>();
  for (const placement of placements) {
    const unit = units.get(instanceOf(placement));
    if (unit) unit.push(placement);
    else units.set(instanceOf(placement), [placement]);
  }

  const sorted = [...units.values()];
  if (isometric) {
    // The top edge of the unit, which for a single-layer PSD is the one
    // placement's own Y — so nothing about how separate things sort changes.
    const key = (unit: Placement[]) => Math.min(...unit.map((p) => p.y));
    sorted.sort((a, b) => key(a) - key(b));
  }

  return sorted.flatMap((unit) =>
    [...unit].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );
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
/**
 * Every placement a box caught, on the front-most layer that has any.
 *
 * One layer's worth, because that is what a drag can move together — and the
 * layer is chosen by the same front-most-wins rule a tap follows, so a
 * marquee over a stack of layers picks the one you would have hit by tapping
 * rather than the one that happens to be active.
 *
 * A placement counts when the marquee *overlaps* it, not when it contains it:
 * dragging a box that swallows everything whole is the fiddly half of every
 * marquee, and nothing here is small enough to catch by accident.
 *
 * The marquee arrives as its own outline rather than as a rectangle, because
 * under an isometric template it is a diamond and the box around that diamond
 * is very much bigger than what was dragged — a marquee in one corner of the
 * screen would otherwise pick up images in another.
 */
export function pickPlacementsIn(
  layers: readonly Layer[],
  outline: readonly Point[],
): { layerId: string; ids: string[] } | null {
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    const ids = layer.placements
      .filter((p) => convexOverlapsRect(outline, placementRect(p)))
      .map((p) => p.id);
    if (ids.length > 0) return { layerId: layer.id, ids };
  }
  return null;
}

function placementRect(placement: Placement): Rect {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
}

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
