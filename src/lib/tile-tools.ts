/**
 * The two tile tools, and the arithmetic behind them.
 *
 * A tile layer has a toolbar of its own — Stamp and Sweep fill — rather than
 * the ink tools wearing another hat. That was the first version and it was
 * wrong in a way worth writing down: a Pencil that lays ink on three kinds of
 * layer and tiles on the fourth is a tool nobody can learn, and every panel
 * describing it has to describe two things. A tool is what it is called.
 *
 * What is here is the part of each tool that is a *function* — which gids a
 * run holds, which spaces a scatter lands on, what the next random pick is —
 * so that the gesture in `game/tile-paint.ts` is about pointers and this is
 * about tiles. It is also what makes the two options on each tool testable
 * without a canvas.
 *
 * **Random is seeded per gesture, not per space.** A scatter that re-rolled
 * every time anything asked what it would do would show one tile under the
 * cursor and lay another — which is precisely what "the cursor shows the next
 * thing to be stamped" forbids. So a pick is *drawn* from a sequence and the
 * sequence only advances when a tile actually lands.
 */

import { gidAt } from "./tiled/gid";
import type { TiledTileset } from "./tiled/types";
import type { TileStamp } from "./tile-layers";
import type { Cell } from "./types";

/**
 * What the pointer is doing on a tile layer, if anything.
 *
 * `null` is every tool that is not one of the two — Select, Pan, Point and
 * Boundary all mean on a tile layer exactly what they mean anywhere else,
 * and so does every ink tool while PSD Edit mode is up over one.
 */
export type TileVerb = "stamp" | "sweep" | "shapefill" | null;

/**
 * Which shape a Shape fill draws.
 *
 * A **rect** is the dragged box, spaces and all. A **circle** is the ellipse
 * inscribed in that same box, which is a circle when the drag is square and
 * an oval when it is not — the reading every drawing program takes of a
 * dragged ellipse, and the one that needs no second gesture to say how wide.
 */
export type TileShape = "rect" | "circle";

/**
 * Everything the canvas needs to know about the tile tool in hand.
 *
 * One record rather than five functions on the scene's config, because they
 * are read together and always at the same moment: the shell knows which tool
 * is held, which way round it is, what was picked in the palette and what the
 * tool's own two options are set to, and the canvas knows none of it.
 */
export interface TileHand {
  verb: TileVerb;
  /** The run picked in the palette — see `editor/tile-palette.ts`. */
  stamp: TileStamp | null;
  /**
   * Stamp: draw from the run rather than laying it out in its own shape.
   * Sweep: scatter the run over the area rather than tiling it.
   */
  random: boolean;
  /** Sweep and Shape fill, scattering only: how many spaces take a tile. */
  density: number;
  /** Shape fill only: which shape the drag describes. */
  shape: TileShape;
  /** Turned round: what the tool would lay, it takes off instead. */
  erasing: boolean;
}

/** What a hand with nothing in it looks like — a scene built by a test. */
export const EMPTY_HAND: TileHand = {
  verb: null,
  stamp: null,
  random: false,
  density: 100,
  shape: "rect",
  erasing: false,
};

/**
 * How much of a swept area a scatter covers, as a percentage.
 *
 * A hundred is every space, which is what makes the control meaningful as it
 * comes down: the difference between a scatter and a tiling at full density
 * is *which* tile lands, not how many. Below that it thins out, which is what
 * a field of rocks or a patch of weeds actually is.
 */
export const DENSITY_DEFAULT = 100;
export const DENSITY_RANGE = { min: 1, max: 100 };

/**
 * Every gid in a picked run, reading across then down.
 *
 * What a random stamp draws from and what a scatter fills with. Empty spaces
 * in the tileset are left out rather than carried as zeroes: a run dragged
 * past the end of a palette should scatter the tiles it caught, not holes.
 */
export function gidsInStamp(
  tilesets: readonly TiledTileset[],
  stamp: TileStamp | null,
): number[] {
  if (!stamp) return [];
  const tileset = tilesets.find((t) => t.firstgid === stamp.firstgid);
  if (!tileset) return [];
  const out: number[] = [];
  for (let row = 0; row < stamp.rows; row++) {
    for (let col = 0; col < stamp.cols; col++) {
      const gid = gidAt(tileset, stamp.col + col, stamp.row + row);
      if (gid !== 0) out.push(gid);
    }
  }
  return out;
}

/**
 * A sequence of picks that can be looked at before it is taken.
 *
 * The whole of what makes "the cursor shows the next thing to be stamped"
 * true. `peek` is what the preview draws and `take` is what the canvas gets,
 * and they are the same tile because the second is the first — the sequence
 * advances on the take and at no other moment.
 *
 * Deliberately not seeded from the document. A scatter here is not a pattern
 * layer: nothing regenerates it, the tiles are written down where they land,
 * and two people would not expect the same field of rocks from the same
 * gesture. `Math.random` is the honest source for a thing that happens once.
 */
export class TilePicks {
  private held: number[] = [];
  private next = 0;

  /** Point the sequence at a run. A run it is already on is left running. */
  aim(gids: readonly number[]): void {
    if (same(this.held, gids)) return;
    this.held = [...gids];
    this.next = pick(this.held);
  }

  /** What the next `take` will hand over, or 0 for an empty run. */
  peek(): number {
    return this.next;
  }

  /** The next tile, and the sequence moves on. */
  take(): number {
    const taken = this.next;
    this.next = pick(this.held);
    return taken;
  }
}

function pick(gids: readonly number[]): number {
  if (gids.length === 0) return 0;
  return gids[Math.floor(Math.random() * gids.length)] ?? 0;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((gid, i) => gid === b[i]);
}

/**
 * The spaces a dragged shape covers.
 *
 * Both shapes are read off the **box between the two corners**, inclusive, so
 * the rectangle is the drag and the ellipse is the one inscribed in it. A
 * drag that never left its space is one space either way, which is what makes
 * a tap on this tool put a tile down rather than nothing.
 *
 * The ellipse test is on each space's **centre** against the unit circle the
 * box maps onto — the same test `cellsInPolygon` makes for a swept outline,
 * for the same reason: a corner is shared with three neighbours, so testing
 * one would take a space in or leave it out depending on which corner was
 * asked about.
 */
export function shapeCells(
  shape: TileShape,
  from: Cell,
  to: Cell,
): Cell[] {
  const left = Math.min(from.cx, to.cx);
  const right = Math.max(from.cx, to.cx);
  const top = Math.min(from.cy, to.cy);
  const bottom = Math.max(from.cy, to.cy);

  const out: Cell[] = [];
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  // Half-widths measured to the outside of the end spaces, so a three-space
  // drag really is three spaces across rather than two and a bit.
  const radiusX = (right - left + 1) / 2;
  const radiusY = (bottom - top + 1) / 2;

  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) {
      if (shape === "circle") {
        const dx = (cx - midX) / radiusX;
        const dy = (cy - midY) / radiusY;
        if (dx * dx + dy * dy > 1) continue;
      }
      out.push({ cx, cy });
    }
  }
  return out;
}

/**
 * Which of a run of spaces a scatter actually lands on.
 *
 * A roll per space rather than a count taken from the total, because a count
 * would have to decide *which* spaces, and every way of deciding that either
 * clumps or makes a lattice. A hundred per cent is every space, and the test
 * is `<` rather than `<=` so that it is the only value that never leaves one
 * out.
 */
export function scattered(cells: readonly Cell[], density: number): Cell[] {
  const held = Math.max(DENSITY_RANGE.min, Math.min(DENSITY_RANGE.max, density));
  if (held >= DENSITY_RANGE.max) return [...cells];
  return cells.filter(() => Math.random() * 100 < held);
}
