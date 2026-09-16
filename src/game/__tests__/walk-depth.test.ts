/**
 * Where a character sorts among the things it is walking through.
 *
 * On an isometric grid the object nearer the camera is the object further down
 * the screen, so a character standing behind a tree has to draw behind it and
 * standing in front has to draw in front. The depth it needs is not a constant:
 * it is a place in the same ordering everything on its layer is already in.
 * `walkDepth` is that lookup, and it lives in the scaffolded scene, so it is
 * tested the way `drawOrder` is — pulled out of the template by its markers and
 * run.
 *
 * **Where the line is** is the thing this file is about. An object's key is its
 * *nearest ground point*: the bottom of its artwork, which is the corner of its
 * footprint closest to the camera. That is the line straight up from the
 * outermost angle of the box, and passing it is what turns behind into in
 * front. The two keys this replaced were wrong in opposite directions — the
 * artwork's top edge is a fact about how tall a thing is, and the unit's anchor
 * is the middle of its footprint, which made a character walking through a
 * building swap over half way along.
 *
 * The second thing it is about is the sliver. Placement `k` sits at `base + k`
 * and `applyDepth` spaces the parts of a multi-layer PSD across the *whole*
 * interval above it — 0.25, 0.5 and 0.75 for a three-layer building — so a
 * depth landing on an integer, or anywhere but the very top of that interval,
 * puts the character between somebody's walls and their roof. Half a step,
 * which is the obvious number, is the worst one.
 */

import { describe, expect, it } from "vitest";
import canvasSource from "../../../src-tauri/templates/common/js/shared/canvas.js?raw";
import characterSource from "../../../src-tauri/templates/topdown/js/shared/character.js?raw";

interface Among {
  base: number;
  near: number[];
}

interface Placed {
  id: string;
  instance?: string;
  anchor: { cx: number; cy: number };
  collider?: { cells: { cx: number; cy: number }[]; blocking: boolean };
}

// Three blocks over two files, because the answer is split the way the
// scaffold is: `canvas.js` sorts a layer and records each unit's line —
// `nearPoints` asks `drawOrder`'s own `nearRow` for it, so the number is
// worked out one way whether it is being sorted or searched — and
// `character.js` is what searches. Pulled out by id rather than by file, so
// moving one between modules is not a test to rewrite.
const { walkDepth, nearPoints, groundOf } = blockFrom<{
  walkDepth: (among: Among, y: number) => number;
  nearPoints: (order: readonly Placed[], halfTile: number) => number[];
  groundOf: (character: Walker) => number;
}>(
  [canvasSource, characterSource],
  ["drawOrder", "nearPoints", "walkDepth"],
  ["walkDepth", "nearPoints", "groundOf"],
);

/** As much of the character prefab as the ground point reads. */
interface Walker {
  ground?: number;
  sprite: { y: number; displayHeight?: number; originY?: number };
}

/**
 * A 64px isometric grid: a tile is 32 high, so a space's own diamond reaches
 * 16 either side of its middle and a row is 16 world pixels.
 */
const HALF = 16;
/** The middle of the space on isometric row `cx + cy`. */
const middleOf = (row: number) => row * HALF;
/** The corner of that space nearest the camera — its bottom vertex. */
const nearOf = (row: number) => (row + 1) * HALF;

/**
 * A layer of four placements: a wall standing on row 0, a building whose
 * footprint runs from row 2 to row 5, and a post on row 9.
 *
 * The building is the case the anchor key got wrong. Its middle is row 3½ and
 * its nearest corner is the bottom of row 5, and a character walking through it
 * must stay behind it until it is past that corner rather than swapping over in
 * the middle of the floor.
 */
const among: Among = {
  base: 4000,
  near: [nearOf(0), nearOf(5), nearOf(5), nearOf(9)],
};

/** The depth of a character standing in the middle of a given row. */
function at(row: number): number {
  return walkDepth(among, middleOf(row));
}

/** How far into a placement's own interval its topmost layer sits. */
function partOf(parts: number): number {
  return parts / (parts + 1);
}

describe("where the line falls", () => {
  /**
   * The building covers rows 2 to 5 and its nearest corner is the bottom of
   * row 5. A character anywhere on that ground is inside the footprint, with
   * the near wall still between it and the camera.
   */
  it("keeps a character behind a building it is standing inside", () => {
    for (const row of [2, 3, 4, 5]) {
      // Behind the building, which is the second and third entries: a depth
      // below base + 1 is behind both of them.
      expect(at(row)).toBeLessThan(among.base + 1);
    }
  });

  it("lets it out in front once it is past the near corner", () => {
    // One row on from the building's own ground, and clear of it.
    expect(at(6)).toBeGreaterThan(among.base + 2);
  });

  /**
   * The regression in one line. The building's middle is row 3½; the old key
   * swapped there, so a character standing on the near half of a building's
   * own floor was drawn over its near wall.
   */
  it("does not swap at the middle of a footprint", () => {
    expect(at(4)).toBe(at(2));
    expect(at(4)).not.toBe(at(6));
  });

  it("is behind everything when it is further away than all of it", () => {
    expect(at(-3)).toBeCloseTo(3999.999, 6);
    expect(at(-3)).toBeLessThan(among.base);
  });

  it("is in front of everything when it is nearer than all of it", () => {
    expect(at(99)).toBeCloseTo(4003.999, 6);
    expect(at(99)).toBeGreaterThan(among.base + 3 + partOf(50));
  });

  /**
   * A space whose middle is level with an object's near corner is beside it,
   * not behind it — on an isometric grid the two spaces share an edge and the
   * character is the half of the pair nearer the camera.
   */
  it("draws in front of what it is level with", () => {
    expect(walkDepth(among, nearOf(0))).toBeGreaterThan(among.base);
  });
});

describe("the depth it hands back", () => {
  /**
   * The one this exists to get right, and the one a half step gets wrong.
   * A placement's own depth is an integer and `applyDepth` fills the interval
   * above it with that PSD's layers, so a character has to land above every one
   * of them and below the next integer.
   */
  it("never lands among the layers of a placed PSD", () => {
    for (let row = -10; row <= 20; row++) {
      const fraction = at(row) - Math.floor(at(row));
      // Above the topmost layer even of a fifty-layer file.
      expect(fraction).toBeGreaterThan(partOf(50));
      expect(fraction).toBeLessThan(1);
    }
  });

  it("never goes backwards as the character comes forward", () => {
    let last = -Infinity;
    for (let y = -400; y <= 400; y += 4) {
      const depth = walkDepth(among, y);
      expect(depth).toBeGreaterThanOrEqual(last);
      last = depth;
    }
  });

  /** A layer with nothing on it: still a valid depth, still above its fill. */
  it("has an answer for a layer holding nothing", () => {
    const empty = walkDepth({ base: 4000, near: [] }, 50);
    expect(empty).toBeCloseTo(3999.999, 6);
    // Above the fill, which sits a whole step under the layer's own slot.
    expect(empty).toBeGreaterThan(4000 - 1);
  });

  /**
   * The position is continuous, so the depth moves with the tween rather than
   * snapping a space at a time — a character part way between two spaces has a
   * well-defined place in the order.
   */
  it("takes a position between two spaces", () => {
    expect(walkDepth(among, middleOf(3) + HALF / 2)).toBe(at(3));
  });
});

/**
 * Every member of a placed unit carries its *unit's* line, and the line comes
 * off the collider.
 *
 * Two claims in one. The **collider** is the record of which spaces a file
 * stands on, so its outermost edge is the corner of the footprint nearest the
 * camera — which is what a character has to pass to stop being behind it.
 * Guessing that from where the pixels end is a guess: a cast shadow, a
 * transparent margin or a picture pasted flat all move the pixels and none of
 * them move the ground.
 *
 * And **per unit**, which is the half that is easy to get wrong and impossible
 * to see. `drawOrder` hands back a flat list — a three-layer building is three
 * entries — and one number per placement would not be sorted. Worse than
 * unsorted, it would be wrong: a character between two of a building's layers
 * would land between them and be drawn inside it.
 */
describe("the list a character searches", () => {
  /** Half a tile of screen height, which is what one isometric row is worth. */
  const HALF_TILE = 16;
  const on = (row: number, deep = 1) => ({
    anchor: { cx: row, cy: 0 },
    collider: {
      cells: Array.from({ length: deep }, (_, i) => ({ cx: i, cy: 0 })),
      blocking: true,
    },
  });

  /** A building on rows 2 to 5, placed back to front as `drawOrder` gives it. */
  const building: Placed[] = [
    { id: "walls", instance: "b", ...on(2, 4) },
    { id: "roof", instance: "b", ...on(2, 4) },
  ];

  it("gives every layer of a unit the same number", () => {
    // The footprint's outermost space is row 5, so the line is row 6.
    expect(nearPoints(building, HALF_TILE)).toEqual([96, 96]);
  });

  it("never dips, so a search over it is a search over something sorted", () => {
    const order: Placed[] = [
      ...building,
      { id: "post", ...on(8) },
      { id: "hall-back", instance: "h", ...on(9, 3) },
      { id: "hall-top", instance: "h", ...on(9, 3) },
    ];
    const near = nearPoints(order, HALF_TILE);
    expect(near).toEqual([96, 96, 144, 192, 192]);
    for (let i = 1; i < near.length; i++) {
      expect(near[i]).toBeGreaterThanOrEqual(near[i - 1]);
    }
  });

  /**
   * The one the *anchor* key got wrong. The building is anchored on row 2 and
   * its footprint runs to row 5, so a character standing on row 4 is on its
   * own ground — inside it, with the near wall still in the way.
   */
  it("keeps a character behind a building it is standing inside", () => {
    const among: Among = { base: 4000, near: nearPoints(building, HALF_TILE) };
    for (const row of [2, 3, 4, 5]) {
      expect(walkDepth(among, row * HALF_TILE)).toBeLessThan(4000);
    }
    // And out the other side, once it is past the outermost edge.
    expect(walkDepth(among, 6 * HALF_TILE)).toBeGreaterThan(4001);
  });

  /** A placement with no unit is a unit of one — a document before instances. */
  it("takes a placement with no unit as its own", () => {
    expect(nearPoints([{ id: "loose", ...on(3) }], HALF_TILE)).toEqual([64]);
  });

  /** No collider yet — the frame or two after a file lands. The anchor. */
  it("falls back to the anchor for a file with no footprint recorded", () => {
    const loose: Placed[] = [{ id: "fresh", anchor: { cx: 7, cy: 0 } }];
    expect(nearPoints(loose, HALF_TILE)).toEqual([128]);
  });

  it("has nothing to say about an empty layer", () => {
    expect(nearPoints([], HALF_TILE)).toEqual([]);
  });
});

/**
 * Where the character is measured from, which is the bottom of its artwork.
 *
 * The comparison only means something if both sides are the same kind of
 * number. An object's is the near vertex of the outermost space its collider
 * covers — the bottom of that footprint — so the character's has to be the
 * bottom of *its* own, and `sprite.y` is not that: anything drawn from its
 * middle sits half its height up the screen.
 *
 * On the default grid that half is exactly one isometric row, because the
 * template's rectangle is half a space tall and a row is half a tile. So
 * sorting on the middle is not a fraction out — it is a whole row out, in the
 * direction that keeps the character behind things it has already walked past.
 */
describe("the point a character is measured from", () => {
  /** A 64px isometric project: 32px tile, 16px row, a 32px-tall character. */
  const rect = (y: number): Walker => ({
    sprite: { y, displayHeight: 32, originY: 0.5 },
  });

  it("takes the bottom of the artwork, not its middle", () => {
    expect(groundOf(rect(100))).toBe(116);
  });

  /**
   * The regression, stated as geometry. A character standing on row R has its
   * middle on that row's centre line and its bottom edge on the row's near
   * vertex — which is where an object standing on row R is measured to. Off by
   * the middle, it reads as standing on row R − 1.
   */
  it("puts a character standing on a space on that space's near vertex", () => {
    const row = 5;
    expect(groundOf(rect(middleOf(row)))).toBe(nearOf(row));
    // And the middle is a whole row short of it.
    expect(nearOf(row) - middleOf(row)).toBe(HALF);
  });

  /**
   * The regression run through the search. The building's line is the near
   * vertex of row 5, so a character standing on row 5 has its feet on that
   * line and is past it. Measured on its middle it is still behind, and does
   * not catch up until row 6 — a whole row late, every time.
   */
  it("comes out in front a row earlier than the middle did", () => {
    expect(groundOf(rect(middleOf(5)))).toBe(nearOf(5));

    expect(walkDepth(among, groundOf(rect(middleOf(5))))).toBeGreaterThan(
      among.base + 2,
    );
    expect(walkDepth(among, middleOf(5))).toBeLessThan(among.base + 1);
    expect(walkDepth(among, middleOf(6))).toBeGreaterThan(among.base + 2);
  });

  /** Scale counts: `displayHeight` rather than `height`. */
  it("reads the drawn height, so a scaled character still stands on it", () => {
    expect(groundOf({ sprite: { y: 0, displayHeight: 64, originY: 0.5 } })).toBe(32);
  });

  /**
   * The hook for artwork a bounding box describes badly — empty space under
   * the feet, or a sprite given its feet as its origin, whose bottom edge is
   * the middle of the space rather than the near vertex of it.
   */
  it("lets a prefab name its own ground point", () => {
    expect(groundOf({ ground: 7, sprite: { y: 100, displayHeight: 32 } })).toBe(7);
    // Zero is a ground point, not a missing one.
    expect(groundOf({ ground: 0, sprite: { y: 100, displayHeight: 32 } })).toBe(0);
  });

  /** A prefab from before any of this: no size to read, and no crash. */
  it("falls back to the middle when there is nothing to measure", () => {
    expect(groundOf({ sprite: { y: 42 } })).toBe(42);
  });

  /** Feet as the origin: the bottom edge is the position itself. */
  it("takes the position as given when the origin is already the feet", () => {
    expect(groundOf({ sprite: { y: 80, displayHeight: 48, originY: 1 } })).toBe(80);
  });
});

/**
 * Managed blocks of the scaffold, as the functions they declare.
 *
 * Found in whichever of the given files holds each one, and stripped of
 * `export` — the scaffold is modules now, and a Function body is not one.
 */
function blockFrom<T>(sources: string[], ids: string[], names: string[]): T {
  const body = ids.map((id) => {
    for (const source of sources) {
      const lines = source.split("\n");
      const from = lines.findIndex((l) => l.trim() === `// idlewild:begin ${id}`);
      const to = lines.findIndex((l) => l.trim() === `// idlewild:end ${id}`);
      if (from >= 0 && to >= 0) {
        return lines.slice(from + 1, to).join("\n").replace(/^export /gm, "");
      }
    }
    throw new Error(`no ${id} block in the template`);
  });
  return new Function(
    `${body.join("\n")}\nreturn { ${names.join(", ")} };`,
  )() as T;
}
