/**
 * Dragging what is selected: a placed image, one of its corner handles, a
 * filled run of grid spaces, a named point, or a boundary.
 *
 * Split out of the scene because it is a small state machine with one job and
 * the scene has several. What it needs from the scene is narrow enough to
 * name — the document, the grid, where a screen point lands in the world, and
 * the ability to render a copy — so it takes that as a host rather than the
 * scene itself.
 *
 * Only the *current selection* is draggable. A pointer-down anywhere else
 * still pans, which keeps the camera reachable everywhere and makes a drag
 * always something the user deliberately picked first.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { rectContains } from "../lib/grid";
import { makeId } from "../lib/doc-store";
import type {
  Cell,
  FillPatch,
  MapPoint,
  Placement,
  Point,
  Rect,
  Selection,
  Zone,
} from "../lib/types";
import type { DragModifiers } from "./camera-rig";
import { pointInPolygon, pointReach } from "./doc-renderer";
import {
  instanceMembers,
  instanceOf,
  scaleWithin,
  unionRect,
} from "./instance";
import {
  boxToPlacement,
  handleAt,
  HANDLE_SCREEN_PX,
  placementBox,
  resizeBox,
  type Box,
  type Corner,
} from "./resize";

/** What a drag gesture is moving, captured at pointer-down. */
type DragState =
  | {
      kind: "placement";
      layerId: string;
      /**
       * Every placement moving together — the whole placed PSD, or the one
       * layer of it that a double-tap opened up.
       */
      members: Array<{
        id: string;
        originCell: Cell;
        offsetX: number;
        offsetY: number;
      }>;
      grabCell: Cell;
    }
  | {
      kind: "fill";
      layerId: string;
      id: string;
      grabCell: Cell;
      /** As at pointer-down: a run of spaces, or the rectangle it is instead. */
      cells: Cell[];
      rect?: Rect;
    }
  | {
      kind: "zone";
      layerId: string;
      id: string;
      grabCell: Cell;
      /** The outline as it was at pointer-down, so the drag never compounds. */
      points: Point[];
    }
  | {
      kind: "point";
      layerId: string;
      id: string;
      grabCell: Cell;
      /** The space it was on at pointer-down, so the drag never compounds. */
      cell: Cell;
    }
  | {
      kind: "resize";
      layerId: string;
      /** The ids scaling together, and their boxes at pointer-down. */
      members: Array<{ id: string; rect: Rect; anchor: Cell }>;
      corner: Corner;
      /** The box as it was at pointer-down, so the drag never compounds. */
      original: Box;
    };

/** What the controller needs from the scene around it. */
export interface DragHost {
  readonly store: DocStore;
  readonly grid: Grid;
  /** Where a client-space point lands in the world. */
  worldAt(screenX: number, screenY: number): Point;
  /** Current camera zoom, for sizing the resize handles' hit targets. */
  zoom(): number;
  getSelection(): Selection;
  setSelection(selection: Selection): void;
  /**
   * Which placed PSD is open for layer-by-layer editing, if any.
   *
   * Null — the usual state — means a PSD drags and resizes as one thing.
   */
  adjustingInstance(): string | null;
  /** Draw a placement the controller has just added to the document. */
  render(layerId: string, placement: Placement): void;
  /**
   * Give a just-copied placement its own PSD, breaking the reference the
   * copy would otherwise be. Fire-and-forget: copying the file and running
   * it through psd-to-json takes long enough that the drag must not wait,
   * and the placement is patched by id when it lands.
   */
  detachCopy(layerId: string, placementId: string, key: string): void;
  /** Brackets the gesture, so the panels can hold their re-renders. */
  onDragStateChange(dragging: boolean): void;
}

/** The middle of a box, which is what an anchor is measured from. */
function centreOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** `scaleWithin` reads a placement's geometry; a captured rect is enough. */
function asPlacement(rect: Rect): Placement {
  return { ...rect } as unknown as Placement;
}

export class DragController {
  private readonly host: DragHost;
  private state: DragState | null = null;

  constructor(host: DragHost) {
    this.host = host;
  }

  get active(): boolean {
    return this.state !== null;
  }

  /**
   * Take the gesture, if the pointer went down on the selection.
   *
   * Holding option drags a copy instead. The copy is made before the drag
   * starts and becomes the selection, so the original stays where it was and
   * the thing under the finger is the new one — which is what makes the
   * gesture read as "pull one out of this".
   *
   * Option and shift together makes that copy independent: it gets its own
   * PSD rather than referencing the original's, which is the same thing the
   * inspector's `Remove Reference` does, asked for up front.
   */
  begin(
    screenX: number,
    screenY: number,
    modifiers: DragModifiers = { alt: false, shift: false },
  ): boolean {
    // Copy to a local so TypeScript narrows the union past the closure.
    const selection = this.host.getSelection();
    const world = this.host.worldAt(screenX, screenY);
    const grabCell = this.host.grid.worldToCell(world);

    if (selection.kind === "placement") {
      return this.beginPlacement(selection, world, grabCell, modifiers);
    }
    if (selection.kind === "placements") {
      return this.beginPlacements(selection, world, grabCell, modifiers);
    }
    if (selection.kind === "fill") {
      // A fill has no file behind it, so shift has nothing to detach.
      return this.beginFill(selection, world, grabCell, modifiers.alt);
    }
    if (selection.kind === "zone") {
      return this.beginZone(selection, world, grabCell, modifiers.alt);
    }
    if (selection.kind === "point") {
      return this.beginPoint(selection, world, grabCell, modifiers.alt);
    }
    return false;
  }

  move(screenX: number, screenY: number): void {
    const drag = this.state;
    if (!drag) return;

    const { store, grid } = this.host;
    const world = this.host.worldAt(screenX, screenY);

    if (drag.kind === "resize") {
      // Resizing works in pixels, not cells: an image's size is a property of
      // the image, and the grid has nothing to say about it.
      const box = resizeBox(drag.original, drag.corner, world);
      // The anchors move by the cells the group's middle moved, all by the
      // same step. Re-anchoring each layer on its *own* new middle would let
      // the members of one PSD drift apart, and it is the shared anchor that
      // brings them back together in the same arrangement after a re-import.
      const before = grid.worldToCell(centreOf(drag.original));
      const after = grid.worldToCell(centreOf(box));
      const step = { cx: after.cx - before.cx, cy: after.cy - before.cy };

      for (const member of drag.members) {
        store.updatePlacement(drag.layerId, member.id, {
          ...boxToPlacement(scaleWithin(asPlacement(member.rect), drag.original, box)),
          anchor: {
            cx: member.anchor.cx + step.cx,
            cy: member.anchor.cy + step.cy,
          },
        });
      }
      return;
    }

    const cell = grid.worldToCell(world);
    const dx = cell.cx - drag.grabCell.cx;
    const dy = cell.cy - drag.grabCell.cy;

    if (drag.kind === "placement") {
      // Snap to the grid: each anchor cell moves whole and by the same step,
      // and every placement keeps whatever offset it had inside its own.
      for (const member of drag.members) {
        const anchor = {
          cx: member.originCell.cx + dx,
          cy: member.originCell.cy + dy,
        };
        const anchorWorld = grid.cellToWorld(anchor);
        store.updatePlacement(drag.layerId, member.id, {
          anchor,
          x: anchorWorld.x + member.offsetX,
          y: anchorWorld.y + member.offsetY,
        });
      }
      return;
    }

    if (drag.kind === "fill") {
      if (drag.rect) {
        const step = grid.cellToWorld({ cx: dx, cy: dy });
        store.updateFill(drag.layerId, drag.id, {
          rect: { ...drag.rect, x: drag.rect.x + step.x, y: drag.rect.y + step.y },
        });
        return;
      }
      store.updateFill(drag.layerId, drag.id, {
        cells: drag.cells.map((c) => ({ cx: c.cx + dx, cy: c.cy + dy })),
      });
      return;
    }

    if (drag.kind === "point") {
      // A point is a space, so the drag is the cell step and nothing else —
      // no projection back into world coordinates the way a boundary's
      // outline needs, because there is no sub-cell offset to preserve.
      store.updatePoint(drag.layerId, drag.id, {
        cell: { cx: drag.cell.cx + dx, cy: drag.cell.cy + dy },
      });
      return;
    }

    // A boundary is world pixels rather than cells, so the cell delta is
    // projected back into world space before it is applied. `cellToWorld` is
    // linear in both projections and has no offset term, which is what makes
    // it usable on a difference as well as a position: the outline keeps its
    // shape and whatever sub-cell offset it had, and moves a whole space at a
    // time exactly as a placed image does.
    const delta = grid.cellToWorld({ cx: dx, cy: dy });
    store.updateZone(drag.layerId, drag.id, {
      points: drag.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
    });
  }

  end(): void {
    if (!this.state) return;
    this.state = null;
    this.host.onDragStateChange(false);
  }

  /** Drop the gesture without telling the host — a mode change, a teardown. */
  cancel(): void {
    this.state = null;
  }

  // ── the things that can be dragged ────────────────────────────────────────

  private beginPlacement(
    selection: Extract<Selection, { kind: "placement" }>,
    world: Point,
    grabCell: Cell,
    modifiers: DragModifiers,
  ): boolean {
    const layer = this.host.store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const placement = layer.placements.find((p) => p.id === selection.placementId);
    if (!placement) return false;

    // What the gesture is about: the whole placed PSD, or the one layer of it
    // a double-tap opened up. Everything below works on the group either way,
    // which is what keeps the two cases from drifting apart.
    const adjusting = this.host.adjustingInstance() === instanceOf(placement);
    const group = adjusting
      ? [placement]
      : instanceMembers(
          this.host.store.layers,
          layer.id,
          instanceOf(placement),
        );
    return this.beginGroup(layer.id, group, world, grabCell, modifiers, true);
  }

  /**
   * Several images caught by a marquee, moved together.
   *
   * The same machinery as one placed PSD, with resizing left out: scaling a
   * PSD against its own box keeps its layers in the arrangement they were
   * built in, and there is no such relationship between things that only
   * happen to be near each other. Sizes stay each image's own.
   */
  private beginPlacements(
    selection: Extract<Selection, { kind: "placements" }>,
    world: Point,
    grabCell: Cell,
    modifiers: DragModifiers,
  ): boolean {
    const layer = this.host.store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const group = layer.placements.filter((p) => selection.ids.includes(p.id));
    if (group.length === 0) return false;
    return this.beginGroup(layer.id, group, world, grabCell, modifiers, false);
  }

  private beginGroup(
    layerId: string,
    group: Placement[],
    world: Point,
    grabCell: Cell,
    modifiers: DragModifiers,
    resizable: boolean,
  ): boolean {
    const placement = group[0];
    if (!placement) return false;

    // A corner handle resizes; the body moves. Handles are drawn at a
    // constant screen size, so the world-space target scales with zoom.
    const box = unionRect(group) ?? placementBox(placement);
    const corner = resizable
      ? handleAt(box, world, HANDLE_SCREEN_PX / this.host.zoom())
      : null;
    if (corner) {
      this.start({
        kind: "resize",
        layerId,
        members: group.map((p) => ({
          id: p.id,
          rect: placementBox(p),
          anchor: p.anchor,
        })),
        corner,
        original: box,
      });
      return true;
    }

    // Inside the group's box, not just the layer that was tapped: a PSD whose
    // layers do not fill their union would otherwise have gaps you cannot
    // pick it up by.
    if (
      world.x < box.x ||
      world.x > box.x + box.width ||
      world.y < box.y ||
      world.y > box.y + box.height
    ) {
      return false;
    }

    // A copied placement keeps the same `psdKey`, so both read the same file:
    // the copy is a *reference*, and editing the PSD edits both. The
    // inspector says so, and offers to break it — or shift asks for it broken
    // straight away, which is the same thing without the round trip. Copying
    // a whole PSD copies every layer of it, into a unit of its own.
    const dragged = modifiers.alt ? this.copyGroup(layerId, group, placement) : group;
    if (modifiers.alt && modifiers.shift) {
      this.host.detachCopy(layerId, dragged[0].id, dragged[0].psdKey);
    }

    this.start({
      kind: "placement",
      layerId,
      grabCell,
      members: dragged.map((p) => {
        const anchorWorld = this.host.grid.cellToWorld(p.anchor);
        return {
          id: p.id,
          originCell: p.anchor,
          offsetX: p.x - anchorWorld.x,
          offsetY: p.y - anchorWorld.y,
        };
      }),
    });
    return true;
  }

  private beginFill(
    selection: Extract<Selection, { kind: "fill" }>,
    world: Point,
    grabCell: Cell,
    alt: boolean,
  ): boolean {
    const layer = this.host.store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const fill = layer.fills.find((f) => f.id === selection.fillId);
    if (!fill) return false;

    const inside = fill.rect
      ? rectContains(fill.rect, world)
      : fill.cells.some((c) => c.cx === grabCell.cx && c.cy === grabCell.cy);
    if (!inside) return false;

    const dragged = alt ? this.copyFill(layer.id, fill) : fill;
    this.start({
      kind: "fill",
      layerId: layer.id,
      id: dragged.id,
      grabCell,
      cells: dragged.cells,
      rect: dragged.rect,
    });
    return true;
  }

  /**
   * A boundary drags from anywhere inside its outline.
   *
   * Inside, not on the line: a zone is drawn as an outline but it describes
   * the region it encloses, and asking someone to catch a 1.5px stroke with a
   * finger would make the gesture unusable on the platform it is mostly for.
   */
  private beginZone(
    selection: Extract<Selection, { kind: "zone" }>,
    world: Point,
    grabCell: Cell,
    alt: boolean,
  ): boolean {
    const layer = this.host.store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const zone = layer.zones.find((z) => z.id === selection.zoneId);
    if (!zone || !pointInPolygon(world, zone.points)) return false;

    const dragged = alt ? this.copyZone(layer.id, zone) : zone;
    this.start({
      kind: "zone",
      layerId: layer.id,
      id: dragged.id,
      grabCell,
      points: dragged.points,
    });
    return true;
  }

  /**
   * A point drags from its marker, not from anywhere.
   *
   * Everything else here is picked up from inside a shape it fills; a point
   * has no inside, so the target is the marker itself — the same reach the
   * tap that selected it used, or there would be places where a point can be
   * chosen and not moved.
   */
  private beginPoint(
    selection: Extract<Selection, { kind: "point" }>,
    world: Point,
    grabCell: Cell,
    alt: boolean,
  ): boolean {
    const layer = this.host.store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const point = layer.points.find((p) => p.id === selection.pointId);
    if (!point) return false;
    const at = this.host.grid.cellCentre(point.cell);
    if (Math.hypot(at.x - world.x, at.y - world.y) > pointReach(this.host.grid)) {
      return false;
    }

    const dragged = alt ? this.copyPoint(layer.id, point) : point;
    this.start({
      kind: "point",
      layerId: layer.id,
      id: dragged.id,
      grabCell,
      cell: dragged.cell,
    });
    return true;
  }

  private start(state: DragState): void {
    this.state = state;
    this.host.onDragStateChange(true);
  }

  private copyZone(layerId: string, source: Zone): Zone {
    const { id: _id, ...rest } = source;
    const copy = this.host.store.addZone(layerId, rest);
    this.host.setSelection({ kind: "zone", layerId, zoneId: copy.id });
    return copy;
  }

  /** The copy takes a name of its own: two points called the same thing is
   *  exactly what a name is for avoiding. */
  private copyPoint(layerId: string, source: MapPoint): MapPoint {
    const copy = this.host.store.addPoint(layerId, source.cell);
    this.host.setSelection({ kind: "point", layerId, pointId: copy.id });
    return copy;
  }

  private copyFill(layerId: string, source: FillPatch): FillPatch {
    const { id: _id, ...rest } = source;
    const copy = this.host.store.addFill(layerId, rest);
    this.host.setSelection({ kind: "fill", layerId, fillId: copy.id });
    return copy;
  }

  /**
   * Duplicate a whole placed PSD in place, render it, and select it.
   *
   * The same `psdKey`, deliberately: the PSD is already loaded and its
   * textures are already in, so the copy costs one `place()` call per layer
   * and no disk at all. What it costs instead is a shared file, which is what
   * `Remove Reference` in the inspector exists to undo.
   *
   * The copy gets an instance of its own, so it is a second *thing* rather
   * than more layers of the first — otherwise pulling a copy out of a PSD
   * would drag the original along with it ever after.
   */
  private copyGroup(
    layerId: string,
    group: readonly Placement[],
    grabbed: Placement,
  ): Placement[] {
    const instance = makeId("psd");
    const copies = group.map((source) => {
      const { id: _id, ...rest } = source;
      return this.host.store.addPlacement(layerId, { ...rest, instance });
    });
    for (const copy of copies) this.host.render(layerId, copy);

    // Select the copy of whatever was under the finger, so the inspector goes
    // on describing the same layer.
    const index = group.findIndex((p) => p.id === grabbed.id);
    const selected = copies[index < 0 ? 0 : index];
    this.host.setSelection({
      kind: "placement",
      layerId,
      placementId: selected.id,
    });
    return copies;
  }
}
