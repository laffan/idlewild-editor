/**
 * Collider mode: the state the canvas is in while a placed PSD's collider is
 * being drawn.
 *
 * The same bargain extrude mode makes, one dimension down. It owns the
 * pointer while it is up — every press, drag and tap paints spaces rather
 * than reaching the document underneath — and nothing it does reaches the
 * document until Apply, so Cancel is dropping what is in this object and
 * entering play mode drops it too.
 *
 * It is simpler than extrude mode in the way it is meant to be. There is one
 * shape, made of grid spaces on the ground, and the only questions are which
 * spaces and whether the pointer is adding or taking away — which is why the
 * tools are two buttons on the bar rather than a gesture to learn. The shape
 * being edited is the *ground* a file stands on, so it is drawn where the
 * grid is however tall the artwork above it happens to be.
 *
 * The spaces are held in absolute grid coordinates while they are being
 * edited, because that is what the pointer hands over. Apply is what turns
 * them back into offsets from the space the artwork hangs from — see
 * `lib/collider.ts` for why the document stores them that way.
 *
 * And they are **replaced rather than written through**, which is the rule
 * the rest of this codebase already keeps: painting a space builds a new set.
 * That is what lets the mode carry an undo stack of its own for the price of
 * a pointer — nothing here reaches the document until Apply, so the
 * document's history has nothing to take back and `history` is the one ⌘Z
 * reaches while the mode is up. A step is a press or a drag, however many
 * spaces it paints, and Reset is a step of its own.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import { cellKey } from "../lib/grid";
import { MAX_COLLIDER_CELLS } from "../lib/collider";
import type { Cell, Point } from "../lib/types";
import * as log from "../lib/log";
import { UndoHistory } from "../lib/history";
import { ColliderRender } from "./collider-render";

/** What the pointer does inside the mode. */
export type ColliderTool = "add" | "remove";

/** The placed PSD whose collider is being drawn. */
export interface ColliderTarget {
  key: string;
  /** The unit the session was opened from, so the canvas can outline it. */
  instance: string;
  layerId: string;
  /** The space the artwork hangs from: what Apply measures offsets against. */
  anchor: Cell;
}

/** What the mode needs from the scene around it. */
export interface ColliderHost {
  readonly scene: Phaser.Scene;
  readonly grid: Grid;
  zoom(): number;
  /** Where a client-space point lands in the world. */
  worldAt(screenX: number, screenY: number): Point;
  /** Anything the bottom bar would want to hear about. */
  onChange(): void;
}

export class ColliderMode {
  private readonly host: ColliderHost;
  private readonly render: ColliderRender;

  /** Null when the mode is not up. */
  private target: ColliderTarget | null = null;
  /** The spaces as they stand, in absolute grid coordinates. */
  private cells: ReadonlySet<string> = new Set();
  /** What Reset goes back to: the default this file would get on import. */
  private defaults = new Set<string>();
  private tool: ColliderTool = "add";
  /** Set while a press or drag is painting. */
  private painting = false;

  /**
   * Undo between strokes — this session's, and emptied at both ends of it,
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

  constructor(host: ColliderHost) {
    this.host = host;
    this.render = new ColliderRender(host.scene, host.grid);
  }

  get active(): boolean {
    return this.target !== null;
  }

  /** The PSD being worked on, and where its artwork hangs from. */
  get editing(): ColliderTarget | null {
    return this.target;
  }

  get currentTool(): ColliderTool {
    return this.tool;
  }

  /** The spaces as they stand, in absolute grid coordinates. */
  get shape(): Cell[] {
    return [...this.cells].map(parseCell);
  }

  /** Whether what is drawn is still the default this file would get. */
  get isDefault(): boolean {
    if (this.cells.size !== this.defaults.size) return false;
    for (const key of this.cells) if (!this.defaults.has(key)) return false;
    return true;
  }

  /** What the bottom bar says about it. */
  get summary(): string {
    const n = this.cells.size;
    const shape = `${n} ${n === 1 ? "space" : "spaces"}`;
    return this.isDefault ? `${shape} · default` : shape;
  }

  /**
   * Enter the mode over a placed PSD.
   *
   * Refused on a grid that does not snap: a blank project's spaces are single
   * world pixels, so there is nothing to paint and the collider there is the
   * box the artwork covers — which is what it already is, and what the
   * inspector says instead of offering this.
   */
  start(
    target: ColliderTarget,
    cells: readonly Cell[],
    defaults: readonly Cell[],
  ): boolean {
    if (!this.host.grid.snaps) {
      log.warn("A collider is drawn on grid spaces — this project has none");
      return false;
    }
    // A session starts with nothing behind it: the last one's spaces were
    // applied or dropped, and neither is somewhere to go back to.
    this.history.clear();
    this.target = target;
    this.cells = new Set(cells.map(cellKey));
    this.defaults = new Set(defaults.map(cellKey));
    this.tool = "add";
    this.painting = false;
    this.draw();
    log.info(
      `Collider for ${target.key}.psd — Add or Remove spaces, ` +
        "Reset for the default, then Apply",
    );
    return true;
  }

  /** Leave, keeping nothing. Apply reads the shape out first. */
  stop(): void {
    if (!this.target) return;
    this.target = null;
    this.cells = new Set();
    this.defaults.clear();
    this.painting = false;
    // Closes a stroke abandoned mid-drag, then forgets the lot: the shape is
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

  setTool(tool: ColliderTool): void {
    if (!this.target || this.tool === tool) return;
    this.tool = tool;
    this.host.onChange();
  }

  /** Back to the spaces this file would have been given on import. */
  reset(): void {
    if (!this.target) return;
    this.history.record(this.cells);
    this.cells = new Set(this.defaults);
    this.draw();
    this.host.onChange();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  /**
   * Claim the pointer.
   *
   * Unconditionally while the mode is up: there is nothing else on the canvas
   * to reach for, and a press that fell through to the document would select
   * something behind the shape being drawn.
   */
  beginPaint(screenX: number, screenY: number): boolean {
    if (!this.target) return false;
    this.painting = true;
    // A stroke is one step however many spaces it crosses. Closed in
    // `endPaint`, and in `stop` for a drag that never got that far.
    this.history.begin();
    this.paintAt(screenX, screenY);
    return true;
  }

  movePaint(screenX: number, screenY: number): boolean {
    if (!this.painting) return false;
    this.paintAt(screenX, screenY);
    return true;
  }

  endPaint(): boolean {
    if (!this.painting) return false;
    this.painting = false;
    this.history.end();
    this.host.onChange();
    return true;
  }

  /**
   * A tap paints the one space under the finger.
   *
   * The press that preceded it has already painted that space — the rig
   * reports a drag that never moved as a tap as well — which is why both
   * tools are idempotent: painting the same space twice has to be the same
   * as painting it once, or every click would undo itself.
   */
  tap(screenX: number, screenY: number): boolean {
    if (!this.target) return false;
    this.paintAt(screenX, screenY);
    this.host.onChange();
    return true;
  }

  destroy(): void {
    this.render.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private paintAt(screenX: number, screenY: number): void {
    if (!this.target) return;
    const cell = this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
    const key = cellKey(cell);
    const adding = this.tool === "add";
    // Both tools are idempotent, which is what makes a drag that crosses the
    // same space twice mean what it did the first time.
    if (this.cells.has(key) === adding) return;
    if (adding && this.cells.size >= MAX_COLLIDER_CELLS) {
      log.warn(`A collider holds at most ${MAX_COLLIDER_CELLS} spaces`);
      return;
    }

    // Replaced rather than written through, so the snapshot the stroke's
    // first space took goes on describing the spaces as they were.
    const next = new Set(this.cells);
    if (adding) next.add(key);
    else next.delete(key);
    this.history.record(this.cells);
    this.cells = next;
    this.draw();
  }

  private draw(): void {
    this.render.render(this.shape, this.host.zoom());
  }
}

function parseCell(key: string): Cell {
  const [cx, cy] = key.split(",").map(Number);
  return { cx, cy };
}
