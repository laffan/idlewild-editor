/**
 * Extrude mode: the state the canvas is in while a prototype solid is being
 * pulled out of the grid.
 *
 * It owns the whole gesture while it is up, which is why it is a mode rather
 * than a tool. Two gestures, and which one a finger is making follows the
 * same rule the rest of the editor follows — a drag moves what is held, a
 * hold asks for a patch of grid:
 *
 * - **A drag on the held face** pulls it. Which way is read off the drag
 *   itself — every axis is a direction on screen, and the finger is going the
 *   way it projects furthest along (`pickPull`).
 * - **A hold, or a drag anywhere else**, takes hold of another face. What it
 *   catches is whatever is visible at each end of the sweep, so a selection
 *   across the top of a tall block takes the tiles the user can see rather
 *   than the ground five levels below them. The hold matters on the held face
 *   in particular: after a pull upward that face is the whole top of the
 *   shape, which is exactly where the next selection wants to start.
 *
 * Picking is the drawing read backwards. `shapeFaces` returns the surface
 * sorted back to front, so walking it front to back and taking the first
 * polygon that contains the point answers "what is under the finger" with
 * exactly the geometry that was put on the screen — no separate ray to keep
 * in step with the renderer.
 *
 * Nothing here touches the document. The shape lives in this object until
 * Apply turns it into a PSD, and Cancel is simply dropping it.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import { cellsInRange, rangeSize } from "../lib/grid";
import type { Cell, Point } from "../lib/types";
import * as log from "../lib/log";
import {
  describeShape,
  extrude,
  groundPatch,
  MAX_VOXELS,
  patchFaces,
  pickPull,
  shapeFaces,
  surfacePatch,
  type ExtrudeState,
  type Face,
  type VoxelSet,
} from "../lib/extrude";
import { pointInPolygon } from "./doc-renderer";
import { ExtrudeRender } from "./extrude-render";

/** What the mode needs from the scene around it. */
export interface ExtrudeHost {
  /** For its own graphics. The scene owns the display list, not this. */
  readonly scene: Phaser.Scene;
  readonly grid: Grid;
  zoom(): number;
  /** Where a client-space point lands in the world. */
  worldAt(screenX: number, screenY: number): Point;
  /**
   * Extrude mode owns the canvas while it is up, so nothing else stays
   * chosen underneath it — including the region selection it was entered
   * from, whose action bar would otherwise float over a dimmed canvas.
   */
  clearSelection(): void;
  /** Anything the bottom bar would want to hear about. */
  onChange(): void;
}

/**
 * The one gesture the mode owns at a time.
 *
 * A pointer that goes down on the held face starts as a **pull** — but only
 * provisionally, because a finger held still on it means the same thing it
 * means everywhere else in this editor: ask for a patch of grid. So the pull
 * carries a hold timer, and a finger that has not moved by the time it fires
 * turns the gesture into a **sweep** instead. Without that, the top of a
 * shape that had just been pulled up was the one place a new selection could
 * not be started — which is exactly where the next one usually starts.
 */
type Gesture =
  | {
      kind: "pull";
      from: Point;
      /** The shape to extrude from, never the preview built on top of it. */
      base: ExtrudeState;
      /** Pending while the gesture could still become a sweep. */
      hold: number | null;
    }
  | { kind: "sweep"; anchor: Cell };

/** As long as the rig's own: a finger is not a mouse. */
const HOLD_MS = 320;
const MOVE_TOLERANCE = 8;

export class ExtrudeMode {
  private readonly host: ExtrudeHost;
  private readonly render: ExtrudeRender;

  /** Null when the mode is not up. */
  private state: ExtrudeState | null = null;
  /** The shape's visible surface, kept so a pick and a repaint share it. */
  private faces: Face[] = [];
  private gesture: Gesture | null = null;

  constructor(host: ExtrudeHost) {
    this.host = host;
    this.render = new ExtrudeRender(host.scene, host.grid);
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** The solid as it stands, or null while there is nothing to apply. */
  get shape(): VoxelSet | null {
    return this.state && this.state.shape.size > 0 ? this.state.shape : null;
  }

  /** What the bottom bar says about it. */
  get summary(): string {
    return this.state ? describeShape(this.host.grid, this.state.shape) : "";
  }

  /**
   * Enter the mode over a grid selection, which becomes the plate to pull.
   *
   * Refused on a grid that does not snap: a blank project's spaces are single
   * world pixels, so there is nothing to stack and a plate the size of a
   * screenshot is a hundred thousand of them.
   */
  start(from: Cell, to: Cell): boolean {
    if (!this.host.grid.snaps) {
      log.warn("Extrude needs a grid to build on — this project has none");
      return false;
    }
    const { w, h } = rangeSize(from, to);
    if (w * h > MAX_VOXELS) {
      log.warn(`That is ${w} × ${h} spaces — too many to extrude at once`);
      return false;
    }

    this.state = { shape: new Set(), patch: groundPatch([...cellsInRange(from, to)]) };
    this.faces = [];
    this.host.clearSelection();
    this.draw();
    log.info(
      "Extrude mode — drag the highlighted spaces to pull them, " +
        "or hold to take hold of a different face",
    );
    return true;
  }

  /** Leave, keeping nothing. Apply reads the shape out first. */
  stop(): void {
    if (!this.state) return;
    this.state = null;
    this.faces = [];
    this.clearGesture();
    this.render.clear();
    this.host.onChange();
  }

  /** Redraw at the current zoom — the chrome is sized in screen pixels. */
  refresh(): void {
    if (this.state) this.render.render(this.faces, this.state.patch, this.host.zoom());
  }

  // ── pulling ───────────────────────────────────────────────────────────────

  /** Claim the pointer if it went down on the face being held. */
  beginPull(screenX: number, screenY: number): boolean {
    if (!this.state || !this.onPatch(this.host.worldAt(screenX, screenY))) return false;
    const from = { x: screenX, y: screenY };
    this.gesture = {
      kind: "pull",
      from,
      base: this.state,
      hold: setTimeout(() => this.holdOnPatch(from), HOLD_MS),
    };
    return true;
  }

  /**
   * Follow a pointer the mode has claimed. False when it has not claimed one,
   * so the scene can pass the move on to whatever else wanted it.
   */
  movePull(screenX: number, screenY: number): boolean {
    const gesture = this.gesture;
    if (!gesture) return false;
    if (gesture.kind === "sweep") {
      this.extendSelect(screenX, screenY);
      return true;
    }

    const delta = { x: screenX - gesture.from.x, y: screenY - gesture.from.y };
    // Still deciding whether this is a pull at all: a finger that has not
    // gone anywhere yet may still be about to be a hold.
    if (gesture.hold !== null) {
      if (Math.hypot(delta.x, delta.y) <= MOVE_TOLERANCE) return true;
      clearTimeout(gesture.hold);
      gesture.hold = null;
    }

    const chosen = pickPull(this.host.grid, delta, this.host.zoom());
    this.state = chosen
      ? extrude(gesture.base, chosen.axis, chosen.steps)
      : gesture.base;
    this.draw();
    return true;
  }

  endPull(): boolean {
    if (!this.gesture) return false;
    this.clearGesture();
    this.host.onChange();
    return true;
  }

  /** The finger stayed put: it was asking for spaces, not pulling them. */
  private holdOnPatch(from: Point): void {
    if (this.gesture?.kind !== "pull") return;
    this.gesture = null;
    this.beginSelect(from.x, from.y);
  }

  // ── taking hold of another face ───────────────────────────────────────────

  /** Begin a selection sweep. False when the mode is not up. */
  beginSelect(screenX: number, screenY: number): boolean {
    if (!this.state) return false;
    this.gesture = { kind: "sweep", anchor: this.cellAt(screenX, screenY) };
    this.extendSelect(screenX, screenY);
    return true;
  }

  extendSelect(screenX: number, screenY: number): boolean {
    const gesture = this.gesture;
    if (gesture?.kind !== "sweep" || !this.state) return false;
    const to = this.cellAt(screenX, screenY);
    const { w, h } = rangeSize(gesture.anchor, to);
    // A sweep that has run away is not what anyone meant by it; hold the
    // last range that was small enough rather than rebuilding a huge one.
    if (w * h > MAX_VOXELS) return true;
    this.state = {
      shape: this.state.shape,
      patch: surfacePatch(this.state.shape, [...cellsInRange(gesture.anchor, to)]),
    };
    this.render.render(this.faces, this.state.patch, this.host.zoom());
    return true;
  }

  endSelect(): boolean {
    if (this.gesture?.kind !== "sweep") return false;
    this.clearGesture();
    this.host.onChange();
    return true;
  }

  /** A tap takes hold of the single space under the finger. */
  tap(screenX: number, screenY: number): boolean {
    if (!this.state) return false;
    const cell = this.cellAt(screenX, screenY);
    this.state = {
      shape: this.state.shape,
      patch: surfacePatch(this.state.shape, [cell]),
    };
    this.render.render(this.faces, this.state.patch, this.host.zoom());
    this.host.onChange();
    return true;
  }

  destroy(): void {
    this.clearGesture();
    this.render.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The space under a point: the one the user can see there.
   *
   * The shape's own surface first, so a face drawn five levels up answers for
   * the column it belongs to rather than for the ground it is drawn over.
   * Nothing there means the grid itself, which is what makes a sweep off the
   * shape and onto it read as one range.
   */
  private cellAt(screenX: number, screenY: number): Cell {
    const world = this.host.worldAt(screenX, screenY);
    for (let i = this.faces.length - 1; i >= 0; i--) {
      if (pointInPolygon(world, this.faces[i].points)) {
        const { cx, cy } = this.faces[i].voxel;
        return { cx, cy };
      }
    }
    return this.host.grid.worldToCell(world);
  }

  private clearGesture(): void {
    if (this.gesture?.kind === "pull" && this.gesture.hold !== null) {
      clearTimeout(this.gesture.hold);
    }
    this.gesture = null;
  }

  private onPatch(world: Point): boolean {
    if (!this.state) return false;
    return patchFaces(this.host.grid, this.state.patch).some((points) =>
      pointInPolygon(world, points),
    );
  }

  /** Rebuild the surface and repaint. Anything that changes the shape. */
  private draw(): void {
    if (!this.state) return;
    this.faces = shapeFaces(this.host.grid, this.state.shape);
    this.render.render(this.faces, this.state.patch, this.host.zoom());
  }
}
