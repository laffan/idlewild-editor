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
import topdownSource from "../../../src-tauri/templates/topdown/js/scenes/WorldScene.js?raw";

interface Among {
  base: number;
  near: number[];
}

interface Placed {
  id: string;
  instance?: string;
  y: number;
  height: number;
}

const { walkDepth, nearPoints } = blockFrom<{
  walkDepth: (among: Among, y: number) => number;
  nearPoints: (order: readonly Placed[]) => number[];
}>(topdownSource, "walkDepth", ["walkDepth", "nearPoints"]);

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
 * Every member of a placed unit carries its *unit's* nearest ground point.
 *
 * This is the half that is easy to get wrong and impossible to see. The list
 * `walkDepth` searches is flat — a three-layer building is three entries — and
 * a roof's bottom edge sits above the walls' under it, so each placement's own
 * number dips in the middle of a unit. A binary search over that does not
 * merely give a fuzzy answer: it finds a place *between* two layers of one
 * building and draws the character inside it.
 */
describe("the list a character searches", () => {
  /** A building placed back to front, as `drawOrder` hands it over. */
  const building: Placed[] = [
    { id: "walls", instance: "b", y: 100, height: 70 },
    { id: "roof", instance: "b", y: 40, height: 40 },
  ];

  it("gives every layer of a unit the same number", () => {
    // The walls reach 170 and the roof stops at 80; the unit's is 170.
    expect(nearPoints(building)).toEqual([170, 170]);
  });

  it("never dips, so a search over it is a search over something sorted", () => {
    const order: Placed[] = [
      ...building,
      { id: "post", y: 300, height: 20 },
      { id: "wall-back", instance: "w", y: 320, height: 40 },
      { id: "wall-top", instance: "w", y: 280, height: 30 },
    ];
    const near = nearPoints(order);
    expect(near).toEqual([170, 170, 320, 360, 360]);
    for (let i = 1; i < near.length; i++) {
      expect(near[i]).toBeGreaterThanOrEqual(near[i - 1]);
    }
  });

  /**
   * The failure the dip caused, stated as the assertion it broke: a character
   * level with the roof's bottom edge but well behind the walls has to be
   * behind the whole building, not between its two layers.
   */
  it("keeps a character out of the middle of a building", () => {
    const among: Among = { base: 4000, near: nearPoints(building) };
    // 90 is past the roof's own bottom (80) and short of the walls' (170).
    expect(walkDepth(among, 90)).toBeLessThan(4000);
  });

  /** A placement with no unit is a unit of one — a document before instances. */
  it("takes a placement with no unit as its own", () => {
    expect(nearPoints([{ id: "loose", y: 10, height: 5 }])).toEqual([15]);
  });

  it("has nothing to say about an empty layer", () => {
    expect(nearPoints([])).toEqual([]);
  });
});

/** One managed block of the scaffolded scene, as the functions it declares. */
function blockFrom<T>(source: string, id: string, names: string[]): T {
  const lines = source.split("\n");
  const from = lines.findIndex((line) => line.trim() === `// idlewild:begin ${id}`);
  const to = lines.findIndex((line) => line.trim() === `// idlewild:end ${id}`);
  if (from < 0 || to < 0) throw new Error(`no ${id} block in the template`);
  return new Function(
    `${lines.slice(from + 1, to).join("\n")}\nreturn { ${names.join(", ")} };`,
  )() as T;
}
