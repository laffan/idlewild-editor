/**
 * Putting tiles down, and taking them off.
 *
 * The tile tools are the drawing tools with something else on the end of
 * them: what the Pencil lays along a drag is the run picked in the palette
 * rather than ink, and what Fill pours into a region is the same run rather
 * than a colour. That is the whole of the relationship this feature borrows
 * from Tiled — the palette holds what is in hand, and every tool is a way of
 * putting it somewhere.
 *
 * So this is not a canvas *mode*. Extrude, collider and mask take the canvas
 * over, dim what is not the subject and have two ways out; a tile tool is
 * simply what the pointer does while it is in your hand, like the Pencil. It
 * sits beside the modes in the scene's gesture chain and refuses every
 * gesture unless a tile tool is held over a tile layer — see `verb`.
 *
 * **A stroke is one step.** The group opens at pointer-down and closes at the
 * release, so ⌘Z takes back the whole drag rather than the last space of it —
 * the same bracket `game/drag.ts` keeps, and for the same reason. A drag that
 * crossed only ground it had already covered writes nothing and therefore
 * leaves no step at all, which falls out of `writeTiles` answering by
 * identity when nothing moved.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { layerKind } from "../lib/layer-kinds";
import {
  bucketFill,
  paintTiles,
  stampWrites,
  stampIsEmpty,
  tileLayer,
  tilesetsOf,
  MAX_FILL_SPACES,
  type TileStamp,
} from "../lib/tile-layers";
import type { TileWrite } from "../lib/tiled/chunks";
import * as log from "../lib/log";
import type { Cell, Point } from "../lib/types";
import type { CellRange } from "../lib/pattern";

/**
 * What the tool in hand means for tiles.
 *
 * Resolved by the shell rather than here, because which tool is held and
 * which way round it is are the rail's business — see `editor/tool-routing.ts`.
 * `null` means nothing in hand has anything to do with tiles, which is how
 * this object refuses a gesture without knowing what a tool is.
 */
export type TileVerb = "stamp" | "fill" | null;

export interface TilePaintHost {
  store: DocStore;
  grid: Grid;
  /** The layer new work lands on. Read through: it changes as the user works. */
  activeLayerId: () => string;
  /** A screen point in world coordinates — the scene's own conversion. */
  worldAt: (screenX: number, screenY: number) => Point;
  /** What the tool in hand means, and which way round it is. */
  verb: () => TileVerb;
  erasing: () => boolean;
  /** The run picked in the palette, which is what a stamp lays down. */
  stamp: () => TileStamp | null;
  /** The ground in view, which is what bounds a bucket fill. */
  visible: () => CellRange;
  /** Something changed: the renderer has to rebuild rather than wait for a
   *  camera move. */
  onChanged: () => void;
}

export class TilePaint {
  private readonly host: TilePaintHost;
  /**
   * Where the gesture started, which is what a multi-tile run is laid out
   * from — see `stampWrites`. Null between gestures, and that is also what
   * says whether a drag is one of ours.
   */
  private origin: Cell | null = null;
  /** The last space painted, so a drag does not rewrite it every frame. */
  private last: Cell | null = null;

  constructor(host: TilePaintHost) {
    this.host = host;
  }

  /** Whether a tile tool is in hand over a tile layer. */
  private ready(): boolean {
    if (this.host.verb() === null) return false;
    const layer = this.host.store.layer(this.host.activeLayerId());
    if (!layer || layer.locked || !layer.visible) return false;
    return layerKind(layer) === "tile";
  }

  /** A tap: one space, or one pour. Answers whether it was ours. */
  tap(world: Point): boolean {
    if (!this.ready()) return false;
    const at = this.host.grid.worldToCell(world);
    this.host.store.history.group(() => this.paint(at, at, true));
    this.host.onChanged();
    return true;
  }

  /** A drag starting. Answers whether this object is taking the gesture. */
  begin(screenX: number, screenY: number): boolean {
    if (!this.ready()) return false;
    const at = this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
    this.origin = at;
    this.last = null;
    // The bracket, not a group: the two ends of a drag are two events and
    // there is no function that spans them.
    this.host.store.history.begin();
    this.paint(at, at, true);
    this.host.onChanged();
    return true;
  }

  move(screenX: number, screenY: number): boolean {
    if (!this.origin) return false;
    const at = this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
    if (this.last && this.last.cx === at.cx && this.last.cy === at.cy) return true;
    this.paint(this.origin, at, false);
    this.host.onChanged();
    return true;
  }

  end(): boolean {
    if (!this.origin) return false;
    this.origin = null;
    this.last = null;
    this.host.store.history.end();
    return true;
  }

  /**
   * One space, or one pour, depending on what is in hand.
   *
   * A **stamp** lays the run out from where the gesture started rather than
   * from each space it crosses, so dragging a 2 × 2 run across the ground
   * makes a continuous pattern instead of a 2 × 2 block centred on every
   * space the finger touched. That is what Tiled does and the only reading
   * under which picking more than one tile is worth doing.
   *
   * A **fill** spreads over the spaces holding what the space it started on
   * holds, bounded by the ground in view — there is no edge on this canvas
   * for a flood to stop at, so what you can see is the edge. Filling with a
   * multi-tile run tiles the region from its own top-left corner, which is
   * again what the stamp rule gives for free.
   */
  private paint(origin: Cell, at: Cell, announce: boolean): void {
    const layerId = this.host.activeLayerId();
    const layer = this.host.store.layer(layerId);
    if (!layer) return;
    this.last = at;

    const spaces =
      this.host.verb() === "fill"
        ? bucketFill(tileLayer(layer), at, this.host.visible())
        : [at];
    if (spaces.length === 0) return;
    if (spaces.length >= MAX_FILL_SPACES) {
      log.warn(
        `A fill stops at ${MAX_FILL_SPACES} spaces. Close the shape, or ` +
          "zoom in so the ground you mean is what is in view.",
      );
    }

    const writes = this.host.erasing()
      ? spaces.map((cell) => ({ x: cell.cx, y: cell.cy, gid: 0 }) as TileWrite)
      : this.stamped(origin, spaces, announce);
    paintTiles(this.host.store, layerId, writes);
  }

  /**
   * The run in hand, laid over a set of spaces.
   *
   * `announce` is true only at the start of a gesture. Nothing picked is the
   * first thing somebody new to a tile layer runs into, so it has to be said
   * — and a drag paints on every pointer move, so saying it per space would
   * be forty identical lines in the console for one sweep.
   */
  private stamped(
    origin: Cell,
    spaces: readonly Cell[],
    announce: boolean,
  ): TileWrite[] {
    const stamp = this.host.stamp();
    if (stampIsEmpty(stamp)) {
      if (announce) {
        log.warn("Nothing picked — drag across a palette in the sidebar first.");
      }
      return [];
    }
    const tilesets = tilesetsOf(this.host.store);
    return spaces.flatMap((cell) =>
      stampWrites(tilesets, stamp as TileStamp, origin, cell),
    );
  }
}
