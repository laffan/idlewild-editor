import { describe, expect, it } from "vitest";
// The two scaffolded scenes as text, the way the Rust side takes them:
// `include_str!` there, `?raw` here, one file either way.
import topdownSource from "../../../src-tauri/templates/topdown/js/scenes/WorldScene.js?raw";
import platformerSource from "../../../src-tauri/templates/platformer/js/scenes/WorldScene.js?raw";
import { drawOrder } from "../doc-renderer";
import type { Placement } from "../../lib/types";

/**
 * One contract, two implementations — the same arrangement the console
 * bridge's snapshot is under, and for the same reason.
 *
 * A PSD is a stack of layers and the order is the artwork: a roof over a
 * tower is not the same picture as a tower over a roof, and an extrusion's
 * `lines`, `shading` and `shape` stacked backwards is a solid with its
 * silhouette painted over everything that made it read as one. The editor
 * gets this right in `doc-renderer.ts`; the game gets it right in the
 * project's own `WorldScene.js`, which cannot import that. So the same
 * ordering exists twice and this holds the two to the same fixtures.
 */
const templateDrawOrder = blockFrom<
  (placements: readonly Placement[], isometric: boolean) => Placement[]
>(topdownSource, "drawOrder");

/**
 * `y` is the top of the artwork and `height` how far down it reaches, so
 * `y + height` is where the thing's feet are — the corner of its footprint
 * nearest the camera, and what the isometric ordering sorts on. How high up
 * the screen the artwork starts is a different question and, for a tall thing,
 * a misleading one.
 */
function placement(
  id: string,
  y: number,
  order?: number,
  instance?: string,
  height = 32,
): Placement {
  return {
    id,
    psdKey: "tower",
    layerPath: id,
    x: 0,
    y,
    width: 32,
    height,
    anchor: { cx: 0, cy: 0 },
    ...(order === undefined ? {} : { order }),
    ...(instance ? { instance } : {}),
  };
}

/** What Apply writes: three parts of one solid, stacked in the file. */
const EXTRUSION = [
  placement("shape", 100, 0, "unit-1"),
  placement("shading", 100, 1, "unit-1"),
  placement("lines", 100, 2, "unit-1"),
];

const FIXTURES: Array<[string, Placement[]]> = [
  ["an extrusion's three parts", EXTRUSION],
  [
    "the same three, listed top-first as the manifest lists them",
    [...EXTRUSION].reverse(),
  ],
  [
    "two units, one nearer the viewer",
    [
      placement("far-base", 0, 0, "unit-far"),
      placement("far-roof", -40, 1, "unit-far"),
      placement("near-base", 200, 0, "unit-near"),
      placement("near-roof", 160, 1, "unit-near"),
    ],
  ],
  [
    // Feet level at y = 0; only the height differs.
    "a tall thing standing beside a short one",
    [
      placement("bush", -20, 0, "unit-bush", 20),
      placement("tower", -400, 0, "unit-tower", 400),
    ],
  ],
  [
    // The building's ground sweeps past the post, so the post is behind it
    // even though the building's *middle* is further back.
    "a post standing on a building's own ground",
    [
      placement("post", 60, 0, "unit-post", 40),
      placement("hall", -200, 0, "unit-hall", 360),
    ],
  ],
  [
    "single-layer placements, which are units of one",
    [placement("a", 90), placement("b", 10), placement("c", 50)],
  ],
  [
    "two units whose feet are level, which is a tie",
    [placement("first", 30), placement("second", 30)],
  ],
  [
    "a document written before order and units existed",
    [placement("x", 30), placement("y", 20)],
  ],
  ["nothing at all", []],
];

describe("the game's stacking and the editor's agree", () => {
  for (const isometric of [true, false]) {
    for (const [name, placements] of FIXTURES) {
      it(`${isometric ? "isometric" : "flat"}: ${name}`, () => {
        const mine = drawOrder(placements, isometric).map((p) => p.id);
        const theirs = templateDrawOrder(placements, isometric).map((p) => p.id);
        expect(theirs).toEqual(mine);
      });
    }
  }
});

describe("what the order actually is", () => {
  it("puts the back of a PSD's stack first, whichever way it arrived", () => {
    // Back to front: `order` counts up from the back, so the parts come out
    // shape, shading, lines — and a manifest listing them the other way round
    // makes no difference.
    for (const source of [EXTRUSION, [...EXTRUSION].reverse()]) {
      expect(templateDrawOrder(source, true).map((p) => p.id)).toEqual([
        "shape",
        "shading",
        "lines",
      ]);
    }
  });

  it("sorts a unit as one thing, not layer by layer", () => {
    const [, , [, twoUnits]] = FIXTURES;
    const order = templateDrawOrder(twoUnits, true).map((p) => p.id);
    // The far building and everything of it, then the near one — rather than
    // both roofs behind both bases, which is what sorting layer by layer
    // would give.
    expect(order).toEqual(["far-base", "far-roof", "near-base", "near-roof"]);
  });

  /**
   * The key is where a thing's feet are, not the top of its artwork. A tower's
   * roof is high up the screen and a bush beside it is not, so the old key put
   * the tower behind everything however far forward it stood.
   */
  it("sorts on where a unit stands, not on how tall it is", () => {
    const [, , , [, tall]] = FIXTURES;
    // Feet level, so the tie holds and the order given survives.
    expect(templateDrawOrder(tall, true).map((p) => p.id)).toEqual([
      "bush",
      "tower",
    ]);
  });

  /**
   * And the one the *anchor* key got wrong. A unit's anchor is the middle of
   * its footprint, so a wide building swapped over half way along; its near
   * corner is the bottom of its artwork, and a post standing on its own ground
   * is behind it.
   */
  it("sorts a wide thing on its near corner, not on its middle", () => {
    const [, , , , [, inside]] = FIXTURES;
    expect(templateDrawOrder(inside, true).map((p) => p.id)).toEqual([
      "post",
      "hall",
    ]);
  });

  it("leaves a flat projection in the order things were placed", () => {
    const placed = [placement("a", 90), placement("b", 10)];
    expect(templateDrawOrder(placed, false).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("both scaffolded scenes", () => {
  for (const id of ["drawOrder", "applyDepth"]) {
    it(`carry the same ${id}`, () => {
      // Found by id rather than by position, so the two cannot drift into
      // stacking their documents differently.
      expect(blockText(platformerSource, id)).toBe(blockText(topdownSource, id));
    });
  }

  it("space a group's children inside their own slot", () => {
    const applyDepth = blockFrom<(object: unknown, depth: number) => void>(
      topdownSource,
      "applyDepth",
    );
    const child = (depth: number) => ({
      depth,
      setDepth(next: number) {
        this.depth = next;
      },
    });
    // As psd-to-phaser leaves them: its own stacking, in no particular order.
    const children = [child(2), child(0), child(1)];
    applyDepth({ getChildren: () => children, setDepth: () => {} }, 5000);

    // Inside 5000 and 5001, so the whole group still sits between the
    // placement below it and the one above, and its own order survives.
    expect(children.map((c) => c.depth)).toEqual([5000.75, 5000.25, 5000.5]);
  });

  it("give a single-layer placement one plain depth", () => {
    const applyDepth = blockFrom<(object: unknown, depth: number) => void>(
      topdownSource,
      "applyDepth",
    );
    let given = -1;
    applyDepth(
      { getChildren: () => [{}], setDepth: (d: number) => (given = d) },
      7,
    );
    expect(given).toBe(7);
  });
});

/** The lines between one block's markers, as the scaffold wrote them. */
function blockText(source: string, id: string): string {
  const lines = source.split("\n");
  const from = lines.findIndex((line) => line.trim() === `// idlewild:begin ${id}`);
  const to = lines.findIndex((line) => line.trim() === `// idlewild:end ${id}`);
  if (from < 0 || to < 0) throw new Error(`no ${id} block in the template`);
  return lines.slice(from + 1, to).join("\n");
}

/**
 * One managed block of a scaffolded scene, as a callable function.
 *
 * The markers make this exact: the block is a whole declaration between two
 * comments, so it can be evaluated on its own without the module around it.
 */
function blockFrom<T>(source: string, id: string): T {
  return new Function(`${blockText(source, id)}\nreturn ${id};`)() as T;
}
