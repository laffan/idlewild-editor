/**
 * Where the layers of a placed PSD belong, and which of them have wandered.
 *
 * A PSD placed on the grid becomes one placement per placeable layer, and all
 * of them are anchored to the **same grid space** — the file's own arrangement
 * is then carried by each placement's offset from that space, which is
 * `positionFrom` run over the layer's position inside the canvas. So the
 * offset a placement holds *is* the file's answer about that layer, and it
 * stays that way through everything the canvas does to a whole unit: a drag
 * moves every anchor by the same cell step, and a resize scales every member
 * against the union box and moves every anchor by the same step again.
 *
 * Opening a unit up is the one thing that breaks the tie. In `adjusting` mode
 * a drag moves the one layer under the finger, which moves *its* anchor and
 * leaves its siblings on theirs — so a unit whose members no longer agree
 * about which space they are on is exactly a unit somebody has moved a layer
 * in. That is the whole detection, and it needs no manifest: the document
 * already says it.
 *
 * Which also decides what putting it back means. Each displaced member keeps
 * the offset it has — that offset is still the PSD's own — and is carried onto
 * the space the rest of the file stands on, so the arrangement that comes back
 * is the one psd-to-json exported rather than one recomputed from a manifest
 * that may have been rewritten since.
 *
 * Pure, and about the document rather than the canvas — the same bargain
 * `unit.ts` and `adjusting.ts` make, so the arithmetic is tested without a
 * Phaser to boot.
 */

import type { Grid } from "../lib/grid";
import type { Cell, Placement } from "../lib/types";

/** Whether two placements stand on the same grid space. */
function sameCell(a: Cell, b: Cell): boolean {
  return a.cx === b.cx && a.cy === b.cy;
}

/** How far back in the PSD's stack a layer sits — zero is the back. */
function orderOf(placement: Placement): number {
  return placement.order ?? 0;
}

/** One candidate space, and the best claim any member on it has to it. */
interface Claim {
  cell: Cell;
  /** How many of the unit's layers stand on it. */
  members: number;
  /** The back-most stack position among them, for the tie. */
  order: number;
  /** And where that member came in the document, for the tie in the tie. */
  at: number;
}

/**
 * The grid space a placed PSD stands on: the one **most of its layers** agree
 * about.
 *
 * Every member is anchored to the same space until somebody moves one, so the
 * usual answer is unanimous and this is a tally with one entry in it. When it
 * is not, the majority is the honest reading of "some layers have been moved":
 * four layers where one was dragged away name the space the other three are
 * still on.
 *
 * An even split is broken by the **back-most** layer's space, and then by the
 * order the placements were made in. The back of a PSD's stack is the ground
 * of whatever is drawn in it — the walls under a roof, an extrusion's
 * silhouette under its shading — so a two-layer file whose roof was nudged
 * puts the roof back rather than carrying the walls after it. It is a
 * tie-break rather than a claim about intent: moving the *ground* layer of a
 * two-layer file and then resetting takes the other layer with it, because
 * the document holds nothing that could tell the two cases apart.
 *
 * Null for a unit with no members, which is a unit that is not there.
 */
export function unitAnchor(members: readonly Placement[]): Cell | null {
  let best: Claim | null = null;
  const claims = new Map<string, Claim>();

  members.forEach((placement, at) => {
    const id = `${placement.anchor.cx},${placement.anchor.cy}`;
    const held = claims.get(id);
    if (held) {
      held.members++;
      if (orderOf(placement) < held.order) {
        held.order = orderOf(placement);
        held.at = at;
      }
    } else {
      claims.set(id, {
        cell: placement.anchor,
        members: 1,
        order: orderOf(placement),
        at,
      });
    }
  });

  for (const claim of claims.values()) {
    if (!best || beats(claim, best)) best = claim;
  }
  return best?.cell ?? null;
}

/** Whether one claim on the unit's space is stronger than another. */
function beats(claim: Claim, held: Claim): boolean {
  if (claim.members !== held.members) return claim.members > held.members;
  if (claim.order !== held.order) return claim.order < held.order;
  return claim.at < held.at;
}

/**
 * The members standing somewhere other than the space the unit is on.
 *
 * Empty for every unit nobody has opened up, which is almost all of them — so
 * the inspector asks this on every render and gets an empty array for the
 * price of a tally.
 */
export function displacedMembers(members: readonly Placement[]): Placement[] {
  const home = unitAnchor(members);
  if (!home) return [];
  return members.filter((placement) => !sameCell(placement.anchor, home));
}

/**
 * Where one displaced member goes when the file's arrangement is put back.
 *
 * The offset it holds from its *own* anchor is kept and the anchor is moved,
 * which is the same arithmetic the drag that displaced it made in reverse: a
 * layer nudged three spaces and reset lands exactly where it was, to the
 * pixel, however the placement has been resized since.
 */
export function homePlacement(
  grid: Grid,
  placement: Placement,
  home: Cell,
): Pick<Placement, "anchor" | "x" | "y"> {
  const was = grid.cellToWorld(placement.anchor);
  const now = grid.cellToWorld(home);
  return {
    anchor: home,
    x: placement.x + (now.x - was.x),
    y: placement.y + (now.y - was.y),
  };
}
