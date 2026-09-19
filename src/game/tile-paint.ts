/**
 * The two tile tools, as gestures.
 *
 * **Stamp** puts the run picked in the palette down where the pointer is: a
 * tap lays one, a drag lays them along the path. **Sweep fill** is an outline
 * — press, draw a shape, release — and every space inside it is filled. Each
 * has two options and they are the same distinction twice: lay the run out in
 * its own shape, or draw from it at random. See `lib/tile-tools.ts`, which is
 * where the arithmetic behind both lives.
 *
 * Neither is a canvas *mode*. Extrude, collider, mask and PSD Edit take the
 * canvas over, dim what is not the subject and have two ways out; a tile tool
 * is what the pointer does while it is in your hand, the way the Pencil is.
 * So this sits between the modes and the drag controller in the gesture chain
 * and refuses everything unless a tile tool is held over a tile layer.
 *
 * **A gesture is one step.** The group opens at pointer-down and closes at
 * the release, the same bracket `game/drag.ts` keeps and for the same reason.
 * A drag that crossed only ground it had already covered writes nothing and
 * therefore leaves no step at all, which falls out of `writeTiles` answering
 * by identity when nothing moved.
 */

import type { DocStore } from "../lib/doc-store";
import { cellsInPolygon, type Grid } from "../lib/grid";
import { layerKind } from "../lib/layer-kinds";
import {
  paintTiles,
  stampWrites,
  stampIsEmpty,
  tilesetsOf,
  type TileStamp,
} from "../lib/tile-layers";
import {
  EMPTY_HAND,
  gidsInStamp,
  scattered,
  TilePicks,
  type TileHand,
} from "../lib/tile-tools";
import type { TileWrite } from "../lib/tiled/chunks";
import * as log from "../lib/log";
import type { Cell, Point } from "../lib/types";

export type { TileVerb } from "../lib/tile-tools";

/** The most points a sweep keeps. See `trace`. */
const MAX_TRACE = 2000;

export interface TilePaintHost {
  store: DocStore;
  grid: Grid;
  /** The layer new work lands on. Read through: it changes as the user works. */
  activeLayerId: () => string;
  /** A screen point in world coordinates — the scene's own conversion. */
  worldAt: (screenX: number, screenY: number) => Point;
  /** What the shell says is in hand — see `TileHand`. */
  hand: () => TileHand;
  /**
   * What the canvas should be showing about the gesture in flight: the tiles
   * that would land under the pointer, and the outline of a sweep so far.
   * Both are chrome rather than document, which is why they go out rather
   * than being written down.
   */
  onPreview: (tiles: readonly TileWrite[], trace: readonly Point[]) => void;
  /** Something changed: the renderer rebuilds rather than waiting for a pan. */
  onChanged: () => void;
}

export class TilePaint {
  private readonly host: TilePaintHost;
  /**
   * Where the gesture started, which is what a run is laid out from — see
   * `stampWrites`. Null between gestures, and that is also what says whether
   * a drag is one of ours.
   */
  private origin: Cell | null = null;
  /** The last space stamped, so a drag does not rewrite it every frame. */
  private last: Cell | null = null;
  /**
   * The outline a sweep has drawn so far, in world points.
   *
   * Capped, because a 120 Hz pointer over a long drag is thousands of points
   * and what is wanted from them is a shape: past the cap the newest point
   * replaces the last rather than growing the list, which keeps the outline
   * following the finger without the polygon walk growing without bound.
   */
  private trace: Point[] = [];
  /** The random sequence, so the preview and the placement agree. */
  private readonly picks = new TilePicks();

  constructor(host: TilePaintHost) {
    this.host = host;
  }

  /** Whether a tile tool is in hand over a layer that can take one. */
  private ready(): boolean {
    if (this.host.hand().verb === null) return false;
    const layer = this.host.store.layer(this.host.activeLayerId());
    if (!layer || layer.locked || !layer.visible) return false;
    return layerKind(layer) === "tile";
  }

  /** The run in hand, pointed at by the random sequence. */
  private aim(hand: TileHand): void {
    this.picks.aim(gidsInStamp(tilesetsOf(this.host.store), hand.stamp));
  }

  /**
   * What would land if the pointer went down here, and the sweep so far.
   *
   * Called on hover as well as during a gesture, which is the whole of the
   * cursor preview: what is drawn is the real writes, through the same two
   * functions that make them, so the ghost cannot drift from the mark.
   */
  hover(screenX: number, screenY: number): void {
    const hand = this.host.hand();
    if (!this.ready() || hand.verb === "sweep") {
      this.host.onPreview([], this.trace);
      return;
    }
    this.aim(hand);
    const at = this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
    this.host.onPreview(this.stampAt(hand, this.origin ?? at, at, false), []);
  }

  /** The pointer has left the canvas: nothing is about to land. */
  clearHover(): void {
    if (this.origin === null) this.host.onPreview([], []);
  }

  /** A tap: one stamp, or a sweep of a single space. Answers if it was ours. */
  tap(world: Point): boolean {
    if (!this.ready()) return false;
    const at = this.host.grid.worldToCell(world);
    this.host.store.history.group(() => this.lay([at], at, true));
    this.after();
    return true;
  }

  /** A drag starting. Answers whether this object is taking the gesture. */
  begin(screenX: number, screenY: number): boolean {
    if (!this.ready()) return false;
    const world = this.host.worldAt(screenX, screenY);
    this.origin = this.host.grid.worldToCell(world);
    this.last = null;
    this.trace = [world];
    // The bracket, not a group: the two ends of a drag are two events and
    // there is no function that spans them.
    this.host.store.history.begin();
    if (this.host.hand().verb === "stamp") this.lay([this.origin], this.origin, true);
    this.after();
    return true;
  }

  move(screenX: number, screenY: number): boolean {
    if (!this.origin) return false;
    const world = this.host.worldAt(screenX, screenY);
    if (this.host.hand().verb === "sweep") {
      // The outline grows; nothing reaches the document until the release,
      // because until the shape is closed there is no inside to fill.
      if (this.trace.length >= MAX_TRACE) this.trace[this.trace.length - 1] = world;
      else this.trace.push(world);
      this.host.onPreview([], this.trace);
      return true;
    }
    const at = this.host.grid.worldToCell(world);
    if (this.last && this.last.cx === at.cx && this.last.cy === at.cy) return true;
    this.lay([at], this.origin, false);
    this.after();
    return true;
  }

  end(): boolean {
    if (!this.origin) return false;
    if (this.host.hand().verb === "sweep") this.fillTrace();
    this.origin = null;
    this.last = null;
    this.trace = [];
    this.host.store.history.end();
    this.host.onPreview([], []);
    this.host.onChanged();
    return true;
  }

  /**
   * The swept outline, closed, and everything inside it filled.
   *
   * `cellsInPolygon` is the same function a pattern shape drawn with the
   * pencil is baked down through, and it tests each space's **centre** —
   * which is why a sweep that comes back on itself fills the ring it drew
   * rather than the box around it.
   */
  private fillTrace(): void {
    if (this.trace.length < 3) {
      // A sweep that never travelled is a tap, and a tap on this tool should
      // still put a tile down rather than doing nothing at all.
      const at = this.origin;
      if (at) this.lay([at], at, true);
      return;
    }
    const cells = cellsInPolygon(this.host.grid, this.trace);
    if (cells.length === 0) {
      log.warn("That sweep did not enclose a whole space.");
      return;
    }
    this.lay(cells, cells[0], true);
  }

  /**
   * Put the run down over a set of spaces.
   *
   * The two options are the same distinction on both tools. **Laid out**, the
   * run repeats from where the gesture started, so dragging a 2 × 2 run makes
   * a continuous pattern rather than a 2 × 2 block centred on every space the
   * finger touched — which is what Tiled does and the only reading under
   * which picking more than one tile is worth doing. **Drawn from**, each
   * space takes one tile of the run at random, and on a sweep a density under
   * a hundred leaves some of them empty.
   */
  private lay(cells: readonly Cell[], origin: Cell, announce: boolean): void {
    const layerId = this.host.activeLayerId();
    if (cells.length === 0) return;
    this.last = cells[cells.length - 1];
    const hand = this.host.hand();

    const writes = hand.erasing
      ? cells.map((cell) => ({ x: cell.cx, y: cell.cy, gid: 0 }) as TileWrite)
      : this.stampAt(hand, origin, cells, announce);
    paintTiles(this.host.store, layerId, writes);
  }

  /**
   * The writes a run makes over some spaces — what lands, and what the ghost
   * under the cursor draws.
   *
   * One function for both, which is what stops the preview drifting from the
   * mark. `consume` is the only difference: the ghost *peeks* at the random
   * sequence and the placement *takes* from it, so the tile you were shown is
   * the tile you get.
   */
  private stampAt(
    hand: TileHand,
    origin: Cell,
    where: Cell | readonly Cell[],
    consume: boolean,
  ): TileWrite[] {
    const cells = Array.isArray(where) ? where : [where as Cell];
    if (hand.erasing) return cells.map((c) => ({ x: c.cx, y: c.cy, gid: 0 }));
    if (stampIsEmpty(hand.stamp)) {
      if (consume) {
        log.warn("Nothing picked — drag across a palette in the sidebar first.");
      }
      return [];
    }
    this.aim(hand);
    if (!hand.random) {
      const tilesets = tilesetsOf(this.host.store);
      return cells.flatMap((cell) =>
        stampWrites(tilesets, hand.stamp as TileStamp, origin, cell),
      );
    }
    const landing =
      hand.verb === "sweep" && cells.length > 1
        ? scattered(cells, hand.density)
        : cells;
    return landing.map((cell) => ({
      x: cell.cx,
      y: cell.cy,
      gid: consume ? this.picks.take() : this.picks.peek(),
    }));
  }

  /** A write has landed: the renderer has no other way to hear about it. */
  private after(): void {
    this.host.onChanged();
  }
}

export { EMPTY_HAND };
