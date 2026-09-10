/**
 * Dragging what is selected: a placed image, one of its corner handles, a
 * filled run of grid spaces, or a boundary.
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
import type {
  Cell,
  FillPatch,
  Placement,
  Point,
  Rect,
  Selection,
  Zone,
} from "../lib/types";
import type { DragModifiers } from "./camera-rig";
import { pointInPolygon } from "./doc-renderer";
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
      id: string;
      grabCell: Cell;
      originCell: Cell;
      offsetX: number;
      offsetY: number;
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
      kind: "resize";
      layerId: string;
      id: string;
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
    if (selection.kind === "fill") {
      // A fill has no file behind it, so shift has nothing to detach.
      return this.beginFill(selection, world, grabCell, modifiers.alt);
    }
    if (selection.kind === "zone") {
      return this.beginZone(selection, world, grabCell, modifiers.alt);
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
      store.updatePlacement(drag.layerId, drag.id, {
        ...boxToPlacement(box),
        anchor: grid.worldToCell({
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        }),
      });
      return;
    }

    const cell = grid.worldToCell(world);
    const dx = cell.cx - drag.grabCell.cx;
    const dy = cell.cy - drag.grabCell.cy;

    if (drag.kind === "placement") {
      // Snap to the grid: the anchor cell moves whole, and the placement
      // keeps whatever offset it had inside that cell.
      const anchor = {
        cx: drag.originCell.cx + dx,
        cy: drag.originCell.cy + dy,
      };
      const anchorWorld = grid.cellToWorld(anchor);
      store.updatePlacement(drag.layerId, drag.id, {
        anchor,
        x: anchorWorld.x + drag.offsetX,
        y: anchorWorld.y + drag.offsetY,
      });
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

    // A corner handle resizes; the body moves. Handles are drawn at a
    // constant screen size, so the world-space target scales with zoom.
    const box = placementBox(placement);
    const corner = handleAt(box, world, HANDLE_SCREEN_PX / this.host.zoom());
    if (corner) {
      this.start({
        kind: "resize",
        layerId: layer.id,
        id: placement.id,
        corner,
        original: box,
      });
      return true;
    }

    if (
      world.x < placement.x ||
      world.x > placement.x + placement.width ||
      world.y < placement.y ||
      world.y > placement.y + placement.height
    ) {
      return false;
    }

    // A copied placement keeps the same `psdKey`, so both read the same file:
    // the copy is a *reference*, and editing the PSD edits both. The
    // inspector says so, and offers to break it — or shift asks for it broken
    // straight away, which is the same thing without the round trip.
    const dragged = modifiers.alt
      ? this.copyPlacement(layer.id, placement)
      : placement;
    if (modifiers.alt && modifiers.shift) {
      this.host.detachCopy(layer.id, dragged.id, dragged.psdKey);
    }
    const anchorWorld = this.host.grid.cellToWorld(dragged.anchor);
    this.start({
      kind: "placement",
      layerId: layer.id,
      id: dragged.id,
      grabCell,
      originCell: dragged.anchor,
      offsetX: dragged.x - anchorWorld.x,
      offsetY: dragged.y - anchorWorld.y,
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

  private copyFill(layerId: string, source: FillPatch): FillPatch {
    const { id: _id, ...rest } = source;
    const copy = this.host.store.addFill(layerId, rest);
    this.host.setSelection({ kind: "fill", layerId, fillId: copy.id });
    return copy;
  }

  /**
   * Duplicate a placement in place, render it, and select it.
   *
   * The same `psdKey`, deliberately: the PSD is already loaded and its
   * textures are already in, so the copy costs one `place()` call and no disk
   * at all. What it costs instead is a shared file, which is what
   * `Remove Reference` in the inspector exists to undo.
   */
  private copyPlacement(layerId: string, source: Placement): Placement {
    const { id: _id, ...rest } = source;
    const copy = this.host.store.addPlacement(layerId, rest);
    this.host.render(layerId, copy);
    this.host.setSelection({ kind: "placement", layerId, placementId: copy.id });
    return copy;
  }
}
