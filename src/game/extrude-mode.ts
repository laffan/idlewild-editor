/**
 * Extrude mode: the state the canvas is in while a prototype solid is being
 * pulled out of the grid.
 *
 * It owns the whole gesture while it is up, which is why it is a mode rather
 * than a tool. Which gesture a finger is making follows the same rule the rest
 * of the editor follows — a drag moves what is held, a hold asks for a patch
 * of grid:
 *
 * - **A drag on the held face** pulls it. Which way is read off the drag
 *   itself — every axis is a direction on screen, and the finger is going the
 *   way it projects furthest along (`pickPull`).
 * - **A hold, or a drag anywhere else**, takes hold of another face. Not
 *   another patch of *ground*: the thing under the finger is a particular side
 *   of a particular space, and a sweep from it runs in that face's own plane.
 *   That is what lets a wall go up ten levels, one of its side faces be taken
 *   hold of three levels from the bottom, and that be pulled out sideways. The
 *   hold matters on the held face in particular: after a pull upward that face
 *   is the whole top of the shape, which is exactly where the next selection
 *   wants to start.
 *
 * Picking is the drawing read backwards. `shapeFaces` returns the surface
 * sorted back to front, so walking it front to back and taking the first
 * polygon that contains the point answers "what is under the finger" with
 * exactly the geometry that was put on the screen — no separate ray to keep
 * in step with the renderer.
 *
 * Two toggles change what that means. **Backfaces** puts the three sides that
 * face away from the camera into the list and takes the near ones out of it,
 * so the solid goes see-through and the far side of a box is what a click
 * lands on — nothing on the near side is selectable or pullable while it is
 * on, which is what keeps a drag meant for a back wall from grabbing the roof
 * it happened to start over. **Erase** turns the pointer into a rubber: press
 * or drag, and whatever face is under it loses its space.
 *
 * Nothing here touches the document. The shape lives in this object until
 * Apply turns it into a PSD, and Cancel is simply dropping it — which is also
 * why the mode carries an undo stack of its own. A pull is not a document
 * edit, so the document's history has nothing to take back; `history` here is
 * the one ⌘Z reaches while the mode is up. It holds `ExtrudeState` snapshots
 * and costs nothing to keep, because a pull already replaces that state
 * rather than writing through it. See `lib/history.ts`.
 *
 * A **step is a pull or a rub**, not every frame of one and not taking hold
 * of a face. The gesture opens a group at pointer-down and closes it at the
 * release, so a face swept ten spaces out is one press of undo; a face pulled
 * out and back to where it started is none, because the state it ends on is
 * the object it began on. Taking hold of a different face records nothing at
 * all — it is this mode's version of a selection, and undo is for what you
 * built. What it does do is ride *inside* the snapshot, so an undo puts back
 * the face the undone pull was made from.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import { cellsInRange, rangeSize } from "../lib/grid";
import type { Cell, Point } from "../lib/types";
import * as log from "../lib/log";
import {
  describeShape,
  extrude,
  facePatch,
  groundPatch,
  isRear,
  levelHeight,
  MAX_VOXELS,
  patchFaces,
  pickPull,
  shapeFaces,
  surfacePatch,
  voxelKey,
  type AxisId,
  type ExtrudeState,
  type Face,
  type Voxel,
  type VoxelSet,
} from "../lib/extrude";
import { UndoHistory } from "../lib/history";
import { pointInPolygon } from "./doc-renderer";
import { ExtrudeRender } from "./extrude-render";

/** What the pointer does inside the mode. */
export type ExtrudeTool = "pull" | "erase";

/**
 * The placed PSD a session is carrying on with, when it is not a new one.
 *
 * Apply writes back to this key rather than making another, and the unit is
 * hidden while the work goes on — the flat artwork and the solid it came from
 * occupy the same ground, and seeing both at once is seeing double.
 */
export interface ExtrudeTarget {
  key: string;
  instance: string;
  layerId: string;
}

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
 * turns the gesture into a sweep instead.
 *
 * A sweep comes in two kinds because it can start in two places. On a face it
 * runs in that face's own plane, between two faces of the same orientation.
 * On bare grid there is no face and no plane, so it falls back to a patch of
 * ground — which is what the mode was entered with in the first place.
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
  | { kind: "face"; axis: AxisId; anchor: Voxel; far: Voxel }
  | { kind: "ground"; anchor: Cell }
  | { kind: "erase" };

/** As long as the rig's own: a finger is not a mouse. */
const HOLD_MS = 320;
const MOVE_TOLERANCE = 8;

export class ExtrudeMode {
  private readonly host: ExtrudeHost;
  private readonly render: ExtrudeRender;

  /** Null when the mode is not up. */
  private state: ExtrudeState | null = null;
  /** The shape's exposed surface, kept so a pick and a repaint share it. */
  private faces: Face[] = [];
  private gesture: Gesture | null = null;

  private tool: ExtrudeTool = "pull";
  /** The bar's toggle, and the modifier key that borrows it while held. */
  private backfaces = false;
  private peek = false;
  /** Set while carrying on with a PSD rather than building a new one. */
  private continuing: ExtrudeTarget | null = null;

  /**
   * Undo between pulls — this session's, and nothing else's. Emptied on the
   * way in and on the way out, because the shape it remembers stops existing
   * at both ends.
   *
   * `current` is never actually asked while the mode is down: the stack is
   * empty then, so neither `undo` nor `end` reads it. It still has to answer
   * something, and an empty solid is the honest answer to "no session".
   */
  readonly history = new UndoHistory<ExtrudeState>({
    current: () => this.state ?? nothing(),
    restore: (state) => {
      this.state = state;
      this.draw();
      this.host.onChange();
    },
  });

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

  get erasing(): boolean {
    return this.tool === "erase";
  }

  /** The placed PSD this session writes back to, if it is carrying one on. */
  get target(): ExtrudeTarget | null {
    return this.continuing;
  }

  /** Whether the far side is currently what a click lands on. */
  get xray(): boolean {
    return (this.backfaces || this.peek) && this.hasBackfaces;
  }

  /**
   * Whether this projection has a far side at all.
   *
   * A flat extrusion is a patch of ground seen from straight above: its
   * spaces have no sides, so there is nothing behind them to reach and the
   * toggle has nothing to offer.
   */
  get hasBackfaces(): boolean {
    return levelHeight(this.host.grid) > 0;
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

    this.begin(
      { shape: new Set(), patch: groundPatch([...cellsInRange(from, to)]) },
      null,
    );
    log.info(
      "Extrude mode — drag the highlighted spaces to pull them, " +
        "or hold to take hold of a different face",
    );
    return true;
  }

  /**
   * Re-enter the mode over a solid that was applied earlier.
   *
   * Nothing is held to begin with. There is no plate to pull — the shape is
   * already there — and guessing which of its faces the user came back for
   * would be worse than letting them say: a tap or a sweep picks one, exactly
   * as it does at every other point in a session.
   */
  resume(shape: VoxelSet, target: ExtrudeTarget): boolean {
    if (!this.host.grid.snaps || shape.size === 0) return false;
    this.begin(
      { shape: new Set(shape), patch: { voxels: [], virtual: false, facing: "+z" } },
      target,
    );
    log.info(
      `Extrude mode — carrying on with ${target.key}.psd; ` +
        "hold on it to take a face, and Apply writes it back",
    );
    return true;
  }

  private begin(state: ExtrudeState, target: ExtrudeTarget | null): void {
    // A session starts with nothing behind it. The previous one's shape has
    // been applied or dropped, and neither is somewhere to go back to.
    this.history.clear();
    this.state = state;
    this.continuing = target;
    this.faces = [];
    this.tool = "pull";
    this.backfaces = false;
    this.peek = false;
    this.host.clearSelection();
    this.draw();
  }

  /** Leave, keeping nothing. Apply reads the shape out first. */
  stop(): void {
    if (!this.state) return;
    this.state = null;
    this.continuing = null;
    this.faces = [];
    this.clearGesture();
    // The shape is gone, so the way back to earlier versions of it is a lie.
    this.history.clear();
    this.render.clear();
    this.host.onChange();
  }

  /** Redraw at the current zoom — the chrome is sized in screen pixels. */
  refresh(): void {
    if (this.state) this.paint();
  }

  // ── the two toggles ───────────────────────────────────────────────────────

  setTool(tool: ExtrudeTool): void {
    if (!this.state || this.tool === tool) return;
    this.tool = tool;
    this.host.onChange();
  }

  setBackfaces(on: boolean): void {
    if (!this.state || this.backfaces === on) return;
    const was = this.xray;
    this.backfaces = on;
    if (this.xray !== was) this.draw();
    this.host.onChange();
  }

  /** The modifier key borrowing X-ray for as long as it is held. */
  setPeek(on: boolean): void {
    if (!this.state || this.peek === on) return;
    const was = this.xray;
    this.peek = on;
    if (this.xray !== was) this.draw();
    this.host.onChange();
  }

  // ── pulling, and erasing ──────────────────────────────────────────────────

  /** Claim the pointer if it went down on something the mode acts on. */
  beginPull(screenX: number, screenY: number): boolean {
    if (!this.state) return false;

    // The rubber claims every pointer-down, because what it acts on is
    // wherever it is put rather than what happens to be held.
    if (this.erasing) {
      this.gesture = { kind: "erase" };
      // A rub is one step however many spaces it takes, the way the drawing
      // layer's slice eraser is one write however many strokes it cuts.
      this.history.begin();
      this.eraseAt(screenX, screenY);
      return true;
    }

    // X-ray is for the far side and nothing else. The held face is the one
    // thing a pointer-down claims without picking, so while it is a near face
    // it would claim every drag that started over it — and after a pull
    // upward that face is the whole roof, which is most of the silhouette.
    // A back wall could then only be swept from the sliver of shape that roof
    // did not cover.
    if (this.xray && !isRear(this.state.patch.facing)) return false;
    if (!this.onPatch(this.host.worldAt(screenX, screenY))) return false;
    const from = { x: screenX, y: screenY };
    this.gesture = {
      kind: "pull",
      from,
      base: this.state,
      hold: setTimeout(() => this.holdOnPatch(from), HOLD_MS),
    };
    // Every frame of the sweep rebuilds the shape from `base`; the group is
    // what makes the whole of it one press of undo. Closed in `clearGesture`,
    // so it survives the gesture turning into a sweep or being abandoned.
    this.history.begin();
    return true;
  }

  /**
   * Follow a pointer the mode has claimed. False when it has not claimed one,
   * so the scene can pass the move on to whatever else wanted it.
   */
  movePull(screenX: number, screenY: number): boolean {
    const gesture = this.gesture;
    if (!gesture) return false;
    if (gesture.kind === "erase") {
      this.eraseAt(screenX, screenY);
      return true;
    }
    if (gesture.kind !== "pull") {
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
    // What the sweep is being built from is what undo goes back to, and the
    // group keeps only the first of these however many frames it takes. A
    // sweep that comes back to `base` ends on the object it started from, and
    // `UndoHistory.end` drops the step for that.
    this.history.record(gesture.base);
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

  /** The finger stayed put: it was asking for a face, not pulling one. */
  private holdOnPatch(from: Point): void {
    if (this.gesture?.kind !== "pull") return;
    // Through `clearGesture`, so the step the pull opened is closed: taking
    // hold of a face is not something to undo, and it wrote nothing anyway.
    this.clearGesture();
    this.beginSelect(from.x, from.y);
  }

  // ── taking hold of another face ───────────────────────────────────────────

  /** Begin a selection sweep. False when the mode is not up. */
  beginSelect(screenX: number, screenY: number): boolean {
    if (!this.state) return false;
    const hit = this.pickFace(screenX, screenY);
    this.gesture = hit
      ? { kind: "face", axis: hit.axis, anchor: hit.voxel, far: hit.voxel }
      : { kind: "ground", anchor: this.groundCellAt(screenX, screenY) };
    this.extendSelect(screenX, screenY);
    return true;
  }

  /**
   * Carry the sweep to where the finger is now.
   *
   * A sweep that began on a face only grows across faces of the same
   * orientation, and the far corner is the last one the pointer was actually
   * over — so wandering onto the roof half way up a wall holds the selection
   * rather than reinterpreting it.
   */
  extendSelect(screenX: number, screenY: number): boolean {
    const gesture = this.gesture;
    const state = this.state;
    if (!state) return false;

    if (gesture?.kind === "face") {
      const hit = this.pickFace(screenX, screenY);
      if (hit && hit.axis === gesture.axis) gesture.far = hit.voxel;
      this.state = {
        shape: state.shape,
        patch: facePatch(state.shape, gesture.axis, gesture.anchor, gesture.far),
      };
      this.paint();
      return true;
    }

    if (gesture?.kind !== "ground") return false;
    const to = this.groundCellAt(screenX, screenY);
    const { w, h } = rangeSize(gesture.anchor, to);
    // A sweep that has run away is not what anyone meant by it; hold the
    // last range that was small enough rather than rebuilding a huge one.
    if (w * h > MAX_VOXELS) return true;
    this.state = {
      shape: state.shape,
      patch: surfacePatch(state.shape, [...cellsInRange(gesture.anchor, to)]),
    };
    this.paint();
    return true;
  }

  endSelect(): boolean {
    const kind = this.gesture?.kind;
    if (kind !== "face" && kind !== "ground") return false;
    this.clearGesture();
    this.host.onChange();
    return true;
  }

  /**
   * A tap takes hold of the single face under the finger.
   *
   * Not while erasing: there the pointer-down has already done the work, and
   * rubbing out the space *behind* the one that just went is not what a single
   * tap meant.
   */
  tap(screenX: number, screenY: number): boolean {
    const state = this.state;
    if (!state) return false;
    if (this.erasing) return true;

    const hit = this.pickFace(screenX, screenY);
    this.state = {
      shape: state.shape,
      patch: hit
        ? { voxels: [hit.voxel], virtual: false, facing: hit.axis }
        : surfacePatch(state.shape, [this.groundCellAt(screenX, screenY)]),
    };
    this.paint();
    this.host.onChange();
    return true;
  }

  destroy(): void {
    this.clearGesture();
    this.render.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The face under a point: the one the user can see there.
   *
   * Walked front to back over what is currently on show, which is what makes
   * the answer agree with the picture. In X-ray mode that is the far side
   * only — the near side is drawn thinly to see *through*, and a click that
   * landed on it would defeat the toggle just reached for.
   */
  private pickFace(
    screenX: number,
    screenY: number,
  ): { voxel: Voxel; axis: AxisId } | null {
    const world = this.host.worldAt(screenX, screenY);
    const wantRear = this.xray;
    for (let i = this.faces.length - 1; i >= 0; i--) {
      const face = this.faces[i];
      if (face.rear !== wantRear) continue;
      if (pointInPolygon(world, face.points)) {
        return { voxel: face.voxel, axis: face.axis };
      }
    }
    return null;
  }

  /** Where a point lands on the bare grid, for a sweep that missed the shape. */
  private groundCellAt(screenX: number, screenY: number): Cell {
    return this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
  }

  /**
   * Rub out the space under the pointer.
   *
   * The face on show answers for the space behind it, so erasing takes
   * whatever a click would have taken hold of — in X-ray mode that is a space
   * on the far side, which is the only way to reach one. A plate that has not
   * been pulled yet has no faces at all, so there erasing trims the selection
   * it is still made of.
   */
  private eraseAt(screenX: number, screenY: number): void {
    const state = this.state;
    if (!state) return;

    const hit = this.pickFace(screenX, screenY);
    if (hit) {
      const key = voxelKey(hit.voxel);
      if (!state.shape.has(key)) return;
      const shape = new Set(state.shape);
      shape.delete(key);
      this.history.record(state);
      this.state = {
        shape,
        patch: {
          ...state.patch,
          voxels: state.patch.voxels.filter((v) => shape.has(voxelKey(v))),
        },
      };
      this.draw();
      return;
    }

    if (!state.patch.virtual) return;
    const cell = this.groundCellAt(screenX, screenY);
    const kept = state.patch.voxels.filter(
      (v) => v.cx !== cell.cx || v.cy !== cell.cy,
    );
    if (kept.length === state.patch.voxels.length) return;
    // Rubbing a space off the plate before anything is pulled from it is an
    // edit like any other — the plate is the shape at that point.
    this.history.record(state);
    this.state = { shape: state.shape, patch: { ...state.patch, voxels: kept } };
    this.paint();
  }

  /**
   * Drop the gesture in flight, and close the undo step it opened.
   *
   * Every way out of a gesture comes through here — the release, the hold
   * that turns a pull into a sweep, leaving the mode — which is what
   * guarantees no group is ever left open to swallow the next thing done.
   * `end` on a sweep, which never opened one, is a no-op.
   */
  private clearGesture(): void {
    if (this.gesture?.kind === "pull" && this.gesture.hold !== null) {
      clearTimeout(this.gesture.hold);
    }
    this.gesture = null;
    this.history.end();
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
    this.faces = shapeFaces(this.host.grid, this.state.shape, this.xray);
    this.paint();
  }

  /** Repaint what is already worked out. Anything that changes only the face. */
  private paint(): void {
    if (!this.state) return;
    this.render.render(this.faces, this.state.patch, this.host.zoom(), this.xray);
  }
}

/** A session that is not up, for the one caller that must be answered. */
function nothing(): ExtrudeState {
  return { shape: new Set(), patch: { voxels: [], virtual: false, facing: "+z" } };
}
