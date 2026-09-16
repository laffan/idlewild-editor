import { describe, expect, it } from "vitest";
// The scaffold's own canvas module as text, the way the Rust side takes it:
// `include_str!` there, `?raw` here, one file either way. It used to be two
// files — the top of each genre's scene — and holding them to each other was
// half of what this suite did. There is one now, so that half is a test that
// no longer has anything to catch.
import canvasSource from "../../../src-tauri/templates/common/js/shared/canvas.js?raw";
import { drawOrder } from "../draw-order";
import type { Cell, Collider, Placement } from "../../lib/types";

/**
 * One contract, two implementations — the same arrangement the console
 * bridge's snapshot is under, and for the same reason.
 *
 * A PSD is a stack of layers and the order is the artwork: a roof over a
 * tower is not the same picture as a tower over a roof, and an extrusion's
 * `lines`, `shading` and `shape` stacked backwards is a solid with its
 * silhouette painted over everything that made it read as one. The editor
 * gets this right in `doc-renderer.ts`; the game gets it right in the
 * project's own `js/shared/canvas.js`, which cannot import that. So the same
 * ordering exists twice and this holds the two to the same fixtures.
 */
type DrawOrder = (
  placements: readonly Placement[],
  isometric: boolean,
  colliderOf?: (placement: Placement) => Collider | undefined,
) => Placement[];

const templateDrawOrder = blockFrom<DrawOrder>(canvasSource, "drawOrder");

/**
 * The footprint of each file: cell offsets from the anchor, as a collider
 * holds them.
 *
 * Handed to both implementations, which is the point — the editor keeps
 * colliders per PSD key and the exported game's config writes them onto a
 * placement, so the *lookup* differs and the ordering must not.
 */
const footprints = new Map<string, Cell[]>();
const colliderOf = (p: Placement): Collider | undefined => {
  const cells = footprints.get(p.psdKey);
  return cells ? { cells, blocking: true } : undefined;
};

/** A file standing on `deep` spaces, running towards the camera. */
function footprint(key: string, deep: number): string {
  footprints.set(
    key,
    Array.from({ length: deep }, (_, i) => ({ cx: i, cy: 0 })),
  );
  return key;
}

/**
 * `row` is the space the file hangs from, and its footprint runs forward from
 * there — together they give the outermost edge the isometric ordering sorts
 * on. `y` is where the artwork happens to sit up the screen, which is a
 * different question and, for a tall thing, a misleading one.
 */
function placement(
  id: string,
  y: number,
  order?: number,
  instance?: string,
  psdKey = "tower",
  row = 0,
): Placement {
  return {
    id,
    psdKey,
    layerPath: id,
    x: 0,
    y,
    width: 32,
    height: 32,
    anchor: { cx: row, cy: 0 },
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
      placement("far-base", 0, 0, "unit-far", footprint("far", 1), 0),
      placement("far-roof", -40, 1, "unit-far", "far", 0),
      placement("near-base", 200, 0, "unit-near", footprint("near", 1), 12),
      placement("near-roof", 160, 1, "unit-near", "near", 12),
    ],
  ],
  [
    // Both stand on one space at row 0; only the artwork's height differs.
    "a tall thing standing beside a short one",
    [
      placement("bush", -20, 0, "unit-bush", footprint("bush", 1), 0),
      placement("tower", -400, 0, "unit-tower", footprint("tower2", 1), 0),
    ],
  ],
  [
    // The hall's footprint sweeps four spaces past its anchor, so the post
    // standing on row 2 is on the hall's own ground and behind it — even
    // though the hall's *anchor* is further back.
    "a post standing on a hall's own ground",
    [
      placement("post", 60, 0, "unit-post", footprint("post", 1), 2),
      placement("hall", -200, 0, "unit-hall", footprint("hall", 4), 0),
    ],
  ],
  [
    "single-layer placements, which are units of one",
    [
      placement("a", 90, undefined, undefined, footprint("a", 1), 5),
      placement("b", 10, undefined, undefined, footprint("b", 1), 1),
      placement("c", 50, undefined, undefined, footprint("c", 1), 3),
    ],
  ],
  [
    "two units whose near edges are level, which is a tie",
    [
      placement("first", 30, undefined, undefined, footprint("first", 1), 4),
      placement("second", 20, undefined, undefined, footprint("second", 1), 4),
    ],
  ],
  [
    "files with no footprint recorded, which fall back to the anchor",
    [
      placement("x", 30, undefined, undefined, "unknown-x", 6),
      placement("y", 20, undefined, undefined, "unknown-y", 1),
    ],
  ],
  ["nothing at all", []],
];

describe("the game's stacking and the editor's agree", () => {
  for (const isometric of [true, false]) {
    for (const [name, placements] of FIXTURES) {
      it(`${isometric ? "isometric" : "flat"}: ${name}`, () => {
        const mine = drawOrder(placements, isometric, colliderOf).map((p) => p.id);
        const theirs = templateDrawOrder(placements, isometric, colliderOf).map(
          (p) => p.id,
        );
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
      expect(templateDrawOrder(source, true, colliderOf).map((p) => p.id)).toEqual([
        "shape",
        "shading",
        "lines",
      ]);
    }
  });

  it("sorts a unit as one thing, not layer by layer", () => {
    const [, , [, twoUnits]] = FIXTURES;
    const order = templateDrawOrder(twoUnits, true, colliderOf).map((p) => p.id);
    // The far building and everything of it, then the near one — rather than
    // both roofs behind both bases, which is what sorting layer by layer
    // would give.
    expect(order).toEqual(["far-base", "far-roof", "near-base", "near-roof"]);
  });

  /**
   * The key is the ground a thing stands on, not the top of its artwork. A
   * tower's roof is high up the screen and a bush beside it is not, so the old
   * key put the tower behind everything however far forward it stood.
   */
  it("sorts on the ground a unit stands on, not on how tall it is", () => {
    const [, , , [, tall]] = FIXTURES;
    // Both on row 0, so the tie holds and the order given survives.
    expect(templateDrawOrder(tall, true, colliderOf).map((p) => p.id)).toEqual([
      "bush",
      "tower",
    ]);
  });

  /**
   * And the one the *anchor* key got wrong. A unit's anchor is the middle of
   * its footprint, so a wide hall swapped over half way along; the key is the
   * outermost edge of its collider, and a post on the hall's own ground is
   * behind it.
   */
  it("sorts a wide thing on its outermost edge, not on its anchor", () => {
    const [, , , , [, inside]] = FIXTURES;
    expect(templateDrawOrder(inside, true, colliderOf).map((p) => p.id)).toEqual([
      "post",
      "hall",
    ]);
  });

  it("leaves a flat projection in the order things were placed", () => {
    const placed = [placement("a", 90), placement("b", 10)];
    expect(templateDrawOrder(placed, false, colliderOf).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("the scaffold's own stacking", () => {
  it("space a group's children inside their own slot", () => {
    const applyDepth = blockFrom<(object: unknown, depth: number) => void>(
      canvasSource,
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
      canvasSource,
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
 * One managed block of the scaffold, as a callable function.
 *
 * The markers make this exact: the block is a whole declaration between two
 * comments, so it can be evaluated on its own without the module around it.
 * `export` comes off first — the scaffold is modules now, and a Function body
 * is not one — which changes nothing about the declaration under it.
 */
function blockFrom<T>(source: string, id: string): T {
  const body = blockText(source, id).replace(/^export /gm, "");
  return new Function(`${body}\nreturn ${id};`)() as T;
}
