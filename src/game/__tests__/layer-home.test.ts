/**
 * Where a placed PSD's layers belong, and putting a nudged one back.
 *
 * The arithmetic is the drag in `game/drag.ts` run backwards, so these tests
 * run the drag first — anchor by anchor, the way the controller does — and
 * then assert that the reset lands on the pixel it left from. Doing it that
 * way is the point: the two have to agree, and a test that only checked the
 * reset against numbers typed out by hand would go on passing if the drag
 * changed under it.
 */

import { describe, expect, it } from "vitest";
import { Grid } from "../../lib/grid";
import type { Cell, Placement } from "../../lib/types";
import { displacedMembers, homePlacement, unitAnchor } from "../layer-home";

const grid = new Grid("isometric", 64);

/**
 * One member of a unit, standing where the file puts it.
 *
 * `offset` is what the placement holds from its anchor — the PSD's own answer
 * about that layer — so a member is written the way `place()` writes one.
 */
function member(
  id: string,
  anchor: Cell,
  offset: { x: number; y: number },
  order = 0,
): Placement {
  const world = grid.cellToWorld(anchor);
  return {
    id,
    psdKey: "tower",
    layerPath: `S | ${id}`,
    x: world.x + offset.x,
    y: world.y + offset.y,
    width: 100,
    height: 100,
    naturalWidth: 200,
    naturalHeight: 200,
    anchor,
    instance: "unit-1",
    order,
  };
}

/** The one move that displaces a layer: a drag inside an opened-up unit. */
function nudge(placement: Placement, by: Cell): Placement {
  const anchor = {
    cx: placement.anchor.cx + by.cx,
    cy: placement.anchor.cy + by.cy,
  };
  const was = grid.cellToWorld(placement.anchor);
  const now = grid.cellToWorld(anchor);
  return {
    ...placement,
    anchor,
    x: now.x + (placement.x - was.x),
    y: now.y + (placement.y - was.y),
  };
}

describe("the space a placed PSD stands on", () => {
  it("is the one every layer agrees about, when nobody has moved one", () => {
    const at = { cx: 4, cy: 2 };
    const unit = [
      member("walls", at, { x: 0, y: 0 }, 0),
      member("roof", at, { x: 12, y: -40 }, 1),
    ];
    expect(unitAnchor(unit)).toEqual(at);
    expect(displacedMembers(unit)).toEqual([]);
  });

  it("is where the majority still stands when one has been dragged away", () => {
    const at = { cx: 4, cy: 2 };
    const unit = [
      member("ground", at, { x: 0, y: 0 }, 0),
      member("walls", at, { x: 4, y: -20 }, 1),
      member("roof", at, { x: 12, y: -40 }, 2),
    ];
    const moved = [unit[0], unit[1], nudge(unit[2], { cx: 3, cy: 0 })];

    expect(unitAnchor(moved)).toEqual(at);
    expect(displacedMembers(moved).map((p) => p.id)).toEqual(["roof"]);
  });

  it("falls to the back-most layer's space when the split is even", () => {
    // Two layers, one moved: there is no majority, so the ground the rest of
    // the picture stands on wins and the roof is what comes back.
    const at = { cx: 0, cy: 0 };
    const walls = member("walls", at, { x: 0, y: 0 }, 0);
    const roof = nudge(member("roof", at, { x: 12, y: -40 }, 1), {
      cx: 2,
      cy: -1,
    });

    expect(unitAnchor([walls, roof])).toEqual(at);
    expect(displacedMembers([walls, roof]).map((p) => p.id)).toEqual(["roof"]);
    // And the other way round, which is the case the document cannot tell
    // apart: moving the ground carries the roof after it.
    const movedWalls = nudge(walls, { cx: 2, cy: -1 });
    expect(unitAnchor([movedWalls, member("roof", at, { x: 12, y: -40 }, 1)]))
      .toEqual(movedWalls.anchor);
  });

  it("has nothing to say about a unit with no members", () => {
    expect(unitAnchor([])).toBeNull();
    expect(displacedMembers([])).toEqual([]);
  });
});

describe("putting a nudged layer back", () => {
  it("lands it exactly where the drag picked it up from", () => {
    const at = { cx: 4, cy: 2 };
    const roof = member("roof", at, { x: 12, y: -40 }, 1);
    const moved = nudge(roof, { cx: 3, cy: -2 });

    const home = homePlacement(grid, moved, at);
    expect(home.anchor).toEqual(at);
    expect(home.x).toBeCloseTo(roof.x);
    expect(home.y).toBeCloseTo(roof.y);
  });

  it("keeps the offset a resize left on it", () => {
    // A unit resized after the nudge holds a different offset from its anchor,
    // and that offset is still the file's — scaled. The reset moves the
    // anchor and nothing else, so the size the user chose survives it.
    const at = { cx: 1, cy: 1 };
    const roof = member("roof", at, { x: 12, y: -40 }, 1);
    const moved = nudge(roof, { cx: 1, cy: 0 });
    const resized = { ...moved, x: moved.x + 7.5, y: moved.y - 3.25 };

    const home = homePlacement(grid, resized, at);
    expect(home.x - grid.cellToWorld(at).x).toBeCloseTo(12 + 7.5);
    expect(home.y - grid.cellToWorld(at).y).toBeCloseTo(-40 - 3.25);
  });

  it("does nothing to a member already on the unit's space", () => {
    const at = { cx: 2, cy: 5 };
    const walls = member("walls", at, { x: 3, y: -9 });
    expect(homePlacement(grid, walls, at)).toEqual({
      anchor: at,
      x: walls.x,
      y: walls.y,
    });
  });
});
