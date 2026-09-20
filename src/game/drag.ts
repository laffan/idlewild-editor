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
import { makeId } from "../lib/doc-store";
import type {
  Cell,
  Placement,
  Point,
  Rect,
  Selection,
} from "../lib/types";
import { textWidthAt, updateText, type TextFrame } from "../lib/text-items";
import { beginTextDrag, beginWrapDrag } from "./drag-text";
import { beginFillDrag, beginPointDrag, beginZoneDrag } from "./drag-marks";
import type { DragModifiers } from "./camera-rig";
import {
  unitMembers,
  unitOf,
  scaleWithin,
  unionRect,
} from "./unit";
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
export type DragState =
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
      kind: "text";
      layerId: string;
      id: string;
      grabCell: Cell;
      /** Where it was at pointer-down, so the drag never compounds. */
      at: Point;
    }
  | {
      kind: "wrap";
      layerId: string;
      id: string;
      /** The note's own frame, captured once: the drag is a projection onto
       *  the axis its text runs along — see `textWidthAt`. */
      frame: TextFrame;
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
  adjustingUnit(): string | null;
  /** Draw a placement the controller has just added to the document. */
  render(layerId: string, placement: Placement): void;
  /**
   * Give a just-copied PSD a file of its own, so the copy is not an instance of
   * the original — **Make Unique**, asked for as the copy is made.
   * Fire-and-forget: copying the file and running it through psd-to-json takes
   * long enough that the drag must not wait, and the unit is repointed by id
   * when it lands.
   */
  detachCopy(layerId: string, placementId: string, key: string): void;
  /** Brackets the gesture, so the panels can hold their re-renders. */
  onDragStateChange(dragging: boolean): void;
  /**
   * Whether a drag moves what it is holding a whole grid space at a time.
   *
   * The switch at the top of Select's panel — `editor/tool-routing.ts` holds
   * it, because it is a tool's setting rather than the document's. Asked on
   * every move rather than captured at pointer-down, so turning it off with
   * the other hand takes effect on the drag already in progress, which is
   * exactly when somebody reaches for it.
   *
   * Optional so the controller can still be built from a four-line host in a
   * test, and because snapping is what this has always done.
   */
  snapToGrid?(): boolean;
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
  /**
   * Where in the world the finger went down.
   *
   * The cell it went down on is on every drag state, because a snapped drag
   * is a *cell* delta and every kind of thing applies one. This is the other
   * half of the same question, kept once rather than on each state: with
   * snapping off the gesture is a world-pixel delta, and one gesture has one
   * grab point whatever it turned out to be holding.
   */
  private grabWorld: Point = { x: 0, y: 0 };

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
   * Option and shift together makes that copy independent: it gets a PSD of
   * its own rather than being an instance of the original's, which is the same
   * thing the inspector's `Make Unique` does, asked for up front.
   */
  begin(
    screenX: number,
    screenY: number,
    modifiers: DragModifiers = { alt: false, shift: false, meta: false },
  ): boolean {
    // Copy to a local so TypeScript narrows the union past the closure.
    const selection = this.host.getSelection();
    const world = this.host.worldAt(screenX, screenY);
    const grabCell = this.host.grid.worldToCell(world);
    this.grabWorld = world;

    // Everything the gesture writes is one undo step. A drag writes on every
    // pointer move — that is what makes the canvas follow the finger — and a
    // history that stepped back through it a space at a time would be a
    // history of the gesture rather than of the document.
    if (selection.kind === "placement") {
      return this.grouped(() =>
        this.beginPlacement(selection, world, grabCell, modifiers),
      );
    }
    if (selection.kind === "placements") {
      return this.grouped(() =>
        this.beginPlacements(selection, world, grabCell, modifiers),
      );
    }
    // The three things the document holds rather than places — `drag-marks.ts`,
    // which is to those what `drag-text.ts` is to a note. A fill, a boundary
    // and a point have no file behind them, so shift has nothing to detach.
    if (selection.kind === "fill") {
      return this.grouped(() =>
        beginFillDrag(this.host, selection, world, grabCell, modifiers.alt, (state) =>
          this.start(state),
        ),
      );
    }
    if (selection.kind === "zone") {
      return this.grouped(() =>
        beginZoneDrag(this.host, selection, world, grabCell, modifiers.alt, (state) =>
          this.start(state),
        ),
      );
    }
    if (selection.kind === "point") {
      return this.grouped(() =>
        beginPointDrag(this.host, selection, world, grabCell, modifiers.alt, (state) =>
          this.start(state),
        ),
      );
    }
    if (selection.kind === "text") {
      return this.grouped(
        () =>
          // The handle first, for the reason a placement's corners come before
          // its box: it sits on the edge of the thing it resizes, so a box test
          // would always win and the handle would never be reachable.
          beginWrapDrag(this.host, selection, world, (state) => this.start(state)) ||
          beginTextDrag(this.host, selection, world, grabCell, modifiers.alt, (state) =>
            this.start(state),
          ),
      );
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

    if (drag.kind === "wrap") {
      // World pixels rather than cell steps, like a resize and for the same
      // reason: a column's width is a property of the words, and the grid has
      // nothing to say about how wide a paragraph should be. A column is at
      // least a few characters wide, or every word wraps onto its own line and
      // the handle ends up under the note's origin where nothing can reach it.
      const wrapWidth = Math.max(32, Math.round(textWidthAt(drag.frame, world)));
      updateText(store, drag.layerId, drag.id, { wrapWidth });
      return;
    }

    const cell = grid.worldToCell(world);
    const dx = cell.cx - drag.grabCell.cx;
    const dy = cell.cy - drag.grabCell.cy;
    const snap = this.host.snapToGrid?.() ?? true;
    /**
     * How far the gesture has travelled, in world pixels.
     *
     * Snapped, that is the cell step projected back into world space, which
     * is what moves a thing a whole space at a time; free, it is the raw
     * distance the finger has covered since it went down. `cellToWorld` is
     * linear with no offset term in both projections, which is what makes it
     * usable on a difference — see the boundary at the end of this method,
     * where that has always been the argument.
     */
    const step = snap
      ? grid.cellToWorld({ cx: dx, cy: dy })
      : { x: world.x - this.grabWorld.x, y: world.y - this.grabWorld.y };

    if (drag.kind === "placement") {
      // Each placement keeps whatever offset it had inside its anchor cell,
      // and every one of them moves by the same step — snapped, that is a
      // whole number of spaces; free, it is wherever the finger is.
      //
      // The **anchor** is a cell either way, because that is what an anchor
      // is: it is what a grid resize follows, and there is no such thing as
      // half a space to record. Off the lattice it therefore lands on the
      // cell the artwork's own origin now sits in, which is the same thing a
      // resize does — the offset it leaves behind is exactly the sub-space
      // placement that was asked for. Where the PSD's mark really is comes
      // from `fromAnchor`, which is in the file's own pixels and follows a
      // drag on its own.
      for (const member of drag.members) {
        const home = grid.cellToWorld(member.originCell);
        const moved = { x: home.x + step.x, y: home.y + step.y };
        const anchor = snap
          ? { cx: member.originCell.cx + dx, cy: member.originCell.cy + dy }
          : grid.worldToCell(moved);
        store.updatePlacement(drag.layerId, member.id, {
          anchor,
          x: moved.x + member.offsetX,
          y: moved.y + member.offsetY,
        });
      }
      return;
    }

    if (drag.kind === "fill") {
      if (drag.rect) {
        store.updateFill(drag.layerId, drag.id, {
          rect: { ...drag.rect, x: drag.rect.x + step.x, y: drag.rect.y + step.y },
        });
        return;
      }
      // A fill drawn as a run of spaces **is** those spaces: what it holds is
      // a list of cells, and there is no position between two of them for a
      // free drag to put it at. So this one ignores the switch rather than
      // pretending — the bare rectangle above is the fill that can move off
      // the lattice, and it is the one a drag on blank ground makes.
      store.updateFill(drag.layerId, drag.id, {
        cells: drag.cells.map((c) => ({ cx: c.cx + dx, cy: c.cy + dy })),
      });
      return;
    }

    if (drag.kind === "point") {
      // A point is a space, so the drag is the cell step and nothing else —
      // no projection back into world coordinates the way a boundary's
      // outline needs, because there is no sub-cell offset to preserve. It
      // ignores the switch for the same reason the run of filled cells above
      // does: what a named place records *is* a cell.
      store.updatePoint(drag.layerId, drag.id, {
        cell: { cx: drag.cell.cx + dx, cy: drag.cell.cy + dy },
      });
      return;
    }

    if (drag.kind === "text") {
      // World pixels, the way a boundary is — see the note below. A word
      // keeps whatever sub-cell offset it was put down with, which is what
      // lets it sit over a doorway rather than over the space the doorway is
      // in, and with snapping off it can be put anywhere at all.
      updateText(store, drag.layerId, drag.id, {
        x: drag.at.x + step.x,
        y: drag.at.y + step.y,
      });
      return;
    }

    // A boundary is world pixels rather than cells, so it takes the same
    // world step everything else here does: the outline keeps its shape and
    // whatever sub-cell offset it had, and moves a whole space at a time or
    // freely depending on the switch, exactly as a placed image does.
    store.updateZone(drag.layerId, drag.id, {
      points: drag.points.map((p) => ({ x: p.x + step.x, y: p.y + step.y })),
    });
  }

  end(): void {
    if (!this.state) return;
    this.state = null;
    // Closes the step `begin` opened. A gesture that moved nothing leaves no
    // step at all — see `UndoHistory.end`.
    this.host.store.history.end();
    this.host.onDragStateChange(false);
  }

  /** Drop the gesture without telling the host — a mode change, a teardown. */
  cancel(): void {
    if (this.state) this.host.store.history.end();
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
    const adjusting = this.host.adjustingUnit() === unitOf(placement);
    const group = adjusting
      ? [placement]
      : unitMembers(
          this.host.store.layers,
          layer.id,
          unitOf(placement),
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
    // the two are *instances* of it, and editing the PSD edits both. The
    // inspector says so, and offers Make Unique — or shift asks for it up
    // front, which is the same thing without the round trip. Copying a whole
    // PSD copies every layer of it, into a unit of its own.
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

  /**
   * Open an undo step for a gesture that is starting, and close it if it
   * turns out not to have started after all.
   *
   * A `begin*` that answers false grabbed nothing — the pointer went down
   * somewhere that is not the selection — and leaving a group open there
   * would swallow the next thing the user did into a step that never began.
   * The option-drag copies are inside it too, which is what makes an
   * option-drag one step rather than a copy followed by a move.
   */
  private grouped(begin: () => boolean): boolean {
    this.host.store.history.begin();
    const took = begin();
    if (!took) this.host.store.history.end();
    return took;
  }

  private start(state: DragState): void {
    this.state = state;
    this.host.onDragStateChange(true);
  }

  /**
   * Duplicate a whole placed PSD in place, render it, and select it.
   *
   * The same `psdKey`, deliberately: the PSD is already loaded and its
   * textures are already in, so the copy costs one `place()` call per layer
   * and no disk at all. What it costs instead is a shared file — the two are
   * instances of it — which is what `Make Unique` in the inspector undoes.
   *
   * The copy gets a **unit** of its own, so it is a second *thing* rather than
   * more layers of the first — otherwise pulling a copy out of a PSD would drag
   * the original along with it ever after.
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
