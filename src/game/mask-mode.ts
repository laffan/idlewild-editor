/**
 * Mask mode: the state the canvas is in while a pattern layer's shape is
 * being drawn.
 *
 * The fourth of the canvas modes, and the closest sibling of collider mode —
 * a set of grid spaces, two tools, its own undo, and nothing reaching the
 * document until Apply. What it edits is **one** of the shapes a pattern is
 * confined to: the mask as a whole is the union of them, and giving the mode
 * the whole union to chew on would collapse a layer's named shapes into one
 * anonymous blob the first time anybody opened it.
 *
 * ## Why this exists at all
 *
 * Making a shape used to be two gestures held together by a request. Press
 * **Add Shape — select**, long-press a patch of grid, press Pattern Shape on
 * the floating bar; or press **Add Shape — draw**, take the pencil to the
 * canvas, and press Finish in a panel. The first works. The second was wrong
 * in three ways at once and each of them was silent: the pencil was left loose
 * over the whole editor with nothing saying the canvas was in a mode; Finish
 * took **every stroke on the layer**, including ink that had been there for
 * an hour, and *deleted* it; and it concatenated all of them into a single
 * outline, so two separate loops came back as one polygon with a corridor
 * running between them.
 *
 * The answer is not a better Finish button. A boundary drawn on the grid is
 * the same kind of work as a collider drawn on the grid, and this editor
 * already knows what that looks like: a mode that owns the canvas, dims what
 * is not the subject, says what the pointer does, and has one way in and two
 * ways out.
 *
 * ## The gesture
 *
 * One: **sweep a rectangle**. Press, drag, release, and every space the
 * rectangle covered is added — or taken away, when the bar's other tool is
 * up. A press that never moves is a 1×1 sweep, so tapping paints a single
 * space without a rule of its own.
 *
 * A rectangle rather than a per-space paint, which is where this parts
 * company with collider mode. A collider is a handful of spaces under one
 * file and painting them one at a time is the whole job; a pattern's boundary
 * is tens or hundreds of spaces, and it is the shape of a *region* — the near
 * half of a field, the ground inside a wall. Sweeping is also exactly the
 * gesture the working route already used, so the one that worked is the one
 * that survived; it simply happens inside a mode now.
 *
 * The spaces are held in absolute grid coordinates, which is what the pointer
 * hands over and what a `PatternShape` stores.
 */

import type Phaser from "phaser";
import { cellKey, cellsInRange, rangeSize, type Grid } from "../lib/grid";
import { UndoHistory } from "../lib/history";
import * as log from "../lib/log";
import type { Cell, PatternShape, Point } from "../lib/types";
import { MaskRender, type MaskSweep } from "./mask-render";

/** What the pointer does inside the mode. */
export type MaskTool = "add" | "remove";

/**
 * The most spaces one shape may hold.
 *
 * A ceiling rather than a budget, for `MAX_COLLIDER_CELLS`' reason and one
 * more: every element of the pattern asks every shape whether it contains a
 * space, once per frame, so a shape the size of a county is a cost paid on
 * the frame loop for ever. Twenty thousand is a rectangle 140 spaces on a
 * side, which is far larger than anything a viewport shows.
 */
export const MAX_MASK_CELLS = 20_000;

/** The shape being drawn, and where it goes when Apply writes it. */
export interface MaskTarget {
  layerId: string;
  /** The layer's name, for the bar. */
  layerName: string;
  /** The shape being edited, or null for one that does not exist yet. */
  shapeId: string | null;
  /** What it is called — the row's name, or the name a new one would get. */
  name: string;
}

/** What the mode needs from the scene around it. */
export interface MaskHost {
  readonly scene: Phaser.Scene;
  readonly grid: Grid;
  zoom(): number;
  /** Where a client-space point lands in the world. */
  worldAt(screenX: number, screenY: number): Point;
  /** The layer's other shapes, drawn behind the one in hand. */
  otherShapes(layerId: string, shapeId: string | null): readonly PatternShape[];
  /**
   * Mask mode owns the canvas while it is up, so nothing stays chosen
   * underneath it — including whatever selection the panel was reached from.
   */
  clearSelection(): void;
  /** Anything the bottom bar would want to hear about. */
  onChange(): void;
}

export class MaskMode {
  private readonly host: MaskHost;
  private readonly render: MaskRender;

  /** Null when the mode is not up. */
  private target: MaskTarget | null = null;
  /** The spaces as they stand, in absolute grid coordinates. */
  private cells: ReadonlySet<string> = new Set();
  /** What Reset goes back to: the shape as it was when the mode opened. */
  private opened: ReadonlySet<string> = new Set();
  private tool: MaskTool = "add";
  /** The rectangle being dragged, or null between gestures. */
  private sweep: { anchor: Cell; to: Cell } | null = null;

  /**
   * Undo between sweeps — this session's, and emptied at both ends of it,
   * because the spaces it remembers stop existing when the mode does.
   */
  readonly history = new UndoHistory<ReadonlySet<string>>({
    current: () => this.cells,
    restore: (cells) => {
      this.cells = cells;
      this.draw();
      this.host.onChange();
    },
  });

  constructor(host: MaskHost) {
    this.host = host;
    this.render = new MaskRender(host.scene, host.grid);
  }

  get active(): boolean {
    return this.target !== null;
  }

  /** The shape being worked on, and where it belongs. */
  get editing(): MaskTarget | null {
    return this.target;
  }

  get currentTool(): MaskTool {
    return this.tool;
  }

  /** The spaces as they stand, in absolute grid coordinates. */
  get shape(): Cell[] {
    return [...this.cells].map(parseCell);
  }

  /** Whether anything has moved since the mode opened. */
  get isOriginal(): boolean {
    if (this.cells.size !== this.opened.size) return false;
    for (const key of this.cells) if (!this.opened.has(key)) return false;
    return true;
  }

  /** What the bottom bar says about it. */
  get summary(): string {
    const n = this.cells.size;
    if (n === 0) return "no spaces yet — sweep the ground it covers";
    return `${n} ${n === 1 ? "space" : "spaces"}`;
  }

  /**
   * Enter the mode over one shape of a pattern layer.
   *
   * Refused on a grid that does not snap, for collider mode's reason: a blank
   * project's spaces are single world pixels, so a shape drawn on them is a
   * set of pixels rather than a region, and a pattern there has nothing to be
   * confined by that anybody could point at.
   */
  start(target: MaskTarget, cells: readonly Cell[]): boolean {
    if (!this.host.grid.snaps) {
      log.warn("A pattern shape is drawn on grid spaces — this project has none");
      return false;
    }
    // A session starts with nothing behind it: the last one's spaces were
    // applied or dropped, and neither is somewhere to go back to.
    this.history.clear();
    this.target = target;
    this.cells = new Set(cells.map(cellKey));
    this.opened = this.cells;
    this.tool = "add";
    this.sweep = null;
    this.host.clearSelection();
    this.draw();
    log.info(
      `${target.name} on ${target.layerName} — sweep the spaces the pattern ` +
        "may use, then Apply",
    );
    return true;
  }

  /** Leave, keeping nothing. Apply reads the shape out first. */
  stop(): void {
    if (!this.target) return;
    this.target = null;
    this.cells = new Set();
    this.opened = new Set();
    this.sweep = null;
    // Closes a sweep abandoned mid-drag, then forgets the lot: the shape is
    // gone, so the way back to earlier versions of it is a lie.
    this.history.end();
    this.history.clear();
    this.render.clear();
    this.host.onChange();
  }

  /** Redraw at the current zoom — the chrome is sized in screen pixels. */
  refresh(): void {
    if (this.target) this.draw();
  }

  setTool(tool: MaskTool): void {
    if (!this.target || this.tool === tool) return;
    this.tool = tool;
    this.host.onChange();
  }

  /** Back to the shape as the mode found it. */
  reset(): void {
    if (!this.target) return;
    this.history.record(this.cells);
    this.cells = this.opened;
    this.draw();
    this.host.onChange();
  }

  /** Every space on the layer's own shapes taken out of this one. */
  clearShape(): void {
    if (!this.target || this.cells.size === 0) return;
    this.history.record(this.cells);
    this.cells = new Set();
    this.draw();
    this.host.onChange();
  }

  // ── sweeping ──────────────────────────────────────────────────────────────

  /**
   * Claim the pointer.
   *
   * Unconditionally while the mode is up: there is nothing else on the canvas
   * to reach for, and a press that fell through to the document would pick up
   * whatever is standing on the ground being swept.
   */
  beginSweep(screenX: number, screenY: number): boolean {
    if (!this.target) return false;
    const at = this.cellAt(screenX, screenY);
    this.sweep = { anchor: at, to: at };
    this.draw();
    return true;
  }

  moveSweep(screenX: number, screenY: number): boolean {
    if (!this.sweep) return false;
    this.sweep = { anchor: this.sweep.anchor, to: this.cellAt(screenX, screenY) };
    this.draw();
    return true;
  }

  /**
   * The release is where the document-shaped change happens.
   *
   * One step of undo per sweep, however many spaces it covered — `record`
   * rather than a `begin`/`end` bracket, because unlike a paint drag there is
   * exactly one write and it is this one.
   */
  endSweep(): boolean {
    const held = this.sweep;
    if (!held || !this.target) return false;
    this.sweep = null;

    const adding = this.tool === "add";
    const next = new Set(this.cells);
    let over = false;
    for (const cell of cellsInRange(held.anchor, held.to)) {
      const key = cellKey(cell);
      if (!adding) {
        next.delete(key);
        continue;
      }
      if (next.size >= MAX_MASK_CELLS && !next.has(key)) {
        over = true;
        break;
      }
      next.add(key);
    }
    if (over) {
      log.warn(`A pattern shape holds at most ${MAX_MASK_CELLS} spaces`);
    }

    if (next.size !== this.cells.size) {
      this.history.record(this.cells);
      this.cells = next;
    }
    this.draw();
    this.host.onChange();
    return true;
  }

  /**
   * A tap is a sweep that never moved.
   *
   * The rig reports a press that did not travel as a tap *as well as* a drag,
   * so by the time this runs the sweep has already been opened and closed on
   * the one space under the finger. Claiming the gesture and doing nothing
   * else is what stops it being painted twice — which, with Remove up, would
   * have been a space taken away and then taken away again, i.e. nothing.
   */
  tap(): boolean {
    return this.target !== null;
  }

  destroy(): void {
    this.render.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private cellAt(screenX: number, screenY: number): Cell {
    return this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
  }

  private draw(): void {
    const target = this.target;
    if (!target) return;
    const sweep: MaskSweep | null = this.sweep
      ? {
          from: this.sweep.anchor,
          to: this.sweep.to,
          adding: this.tool === "add",
        }
      : null;
    this.render.render(
      this.shape,
      this.host.otherShapes(target.layerId, target.shapeId),
      sweep,
      this.host.zoom(),
    );
  }

  /** How many spaces the sweep in flight covers, for the bar. */
  get sweeping(): number {
    if (!this.sweep) return 0;
    const { w, h } = rangeSize(this.sweep.anchor, this.sweep.to);
    return w * h;
  }
}

function parseCell(key: string): Cell {
  const [cx, cy] = key.split(",").map(Number);
  return { cx, cy };
}
