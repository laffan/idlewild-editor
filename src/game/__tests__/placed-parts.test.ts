import { describe, expect, it } from "vitest";
import {
  applyHidden,
  applyTransform,
  partsOf,
  type Placed,
} from "../placed-parts";
import type { Placement } from "../../lib/types";

/**
 * A sprite as psd-to-phaser leaves one: at its layer's position in the PSD
 * canvas, with `setOrigin(0, 0)` so it scales away from that corner.
 */
function sprite(x: number, y: number) {
  return {
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    setPosition(nx: number, ny: number) {
      this.x = nx;
      this.y = ny;
      return this;
    },
    setScale(sx: number, sy: number) {
      this.scaleX = sx;
      this.scaleY = sy;
      return this;
    },
  };
}

/**
 * And a Phaser Group, which is what `place()` returns for every category.
 *
 * Its own `setPosition` and `setScale` are the plugin's grafted ones: one
 * pair of numbers forwarded to every child, which is the behaviour this
 * module exists to stop being the whole story.
 */
function group(...children: ReturnType<typeof sprite>[]) {
  return {
    children,
    setPosition(x: number, y: number) {
      for (const child of this.children) child.setPosition(x, y);
      return this;
    },
    setScale(sx: number, sy: number) {
      for (const child of this.children) child.setScale(sx, sy);
      return this;
    },
    getChildren() {
      return this.children;
    },
  };
}

function placement(over: Partial<Placement> = {}): Placement {
  return {
    id: "p1",
    psdKey: "extrude-abc",
    layerPath: "extrude-abc",
    x: -64,
    y: -96,
    width: 128,
    height: 160,
    naturalWidth: 256,
    naturalHeight: 320,
    anchor: { cx: 0, cy: 0 },
    ...over,
  } as Placement;
}

describe("partsOf", () => {
  it("puts a lone sprite at offset zero, which is where it has always gone", () => {
    const only = sprite(128, 64);
    const parts = partsOf(group(only) as unknown as Placed);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ dx: 0, dy: 0 });
  });

  it("measures from the pieces' own corner, which is the placement's", () => {
    // What an extrusion looks like after Photoshop has saved it: the three
    // parts were written at one rect, and come back cropped to their ink —
    // the shading starts half a tile below the silhouette.
    const shape = sprite(128, 64);
    const lines = sprite(128, 64);
    const shading = sprite(128, 128);
    const parts = partsOf(group(shape, lines, shading) as unknown as Placed);
    expect(parts.map((p) => [p.dx, p.dy])).toEqual([
      [0, 0],
      [0, 0],
      [0, 64],
    ]);
  });

  it("walks a group inside a group down to what actually draws", () => {
    const inner = group(sprite(40, 10), sprite(10, 30));
    const outer = group(
      sprite(20, 20) as unknown as ReturnType<typeof sprite>,
      inner as unknown as ReturnType<typeof sprite>,
    );
    const parts = partsOf(outer as unknown as Placed);
    expect(parts.map((p) => [p.dx, p.dy])).toEqual([
      [10, 10],
      [30, 0],
      [0, 20],
    ]);
  });

  it("finds nothing in an empty group", () => {
    expect(partsOf(group() as unknown as Placed)).toEqual([]);
  });
});

describe("applyTransform", () => {
  it("keeps a part's offset inside the placement", () => {
    const shape = sprite(128, 64);
    const shading = sprite(128, 128);
    const placed = group(shape, shading);
    const parts = partsOf(placed as unknown as Placed);

    applyTransform(placed as unknown as Placed, parts, placement());

    // Half size, because a PSD is drawn at 2× and placed at a half of it —
    // so the 64 px the shading hangs down in the file is 32 on the grid.
    expect([shape.x, shape.y]).toEqual([-64, -96]);
    expect([shading.x, shading.y]).toEqual([-64, -64]);
  });

  it("grows the offsets with the placement, not just the pixels", () => {
    const shape = sprite(0, 0);
    const shading = sprite(0, 100);
    const placed = group(shape, shading);
    const parts = partsOf(placed as unknown as Placed);

    applyTransform(
      placed as unknown as Placed,
      parts,
      placement({
        x: 10,
        y: 20,
        width: 200,
        height: 400,
        naturalWidth: 100,
        naturalHeight: 200,
      }),
    );

    expect([shape.x, shape.y]).toEqual([10, 20]);
    // Twice the size, so twice as far down — the parts stay a composition.
    expect([shading.x, shading.y]).toEqual([10, 220]);
    expect([shading.scaleX, shading.scaleY]).toEqual([2, 2]);
  });

  it("puts a single-sprite placement exactly where its x and y say", () => {
    const only = sprite(300, 400);
    const placed = group(only);
    applyTransform(
      placed as unknown as Placed,
      partsOf(placed as unknown as Placed),
      placement({ x: -5, y: 7 }),
    );
    expect([only.x, only.y]).toEqual([-5, 7]);
  });

  it("falls back to the group's own setPosition when there is nothing in it", () => {
    let moved: [number, number] | null = null;
    const empty = {
      setPosition(x: number, y: number) {
        moved = [x, y];
        return this;
      },
      setScale: () => undefined,
      getChildren: () => [],
    };
    applyTransform(empty as unknown as Placed, [], placement({ x: 3, y: 4 }));
    expect(moved).toEqual([3, 4]);
  });
});

/**
 * A named sprite, which is what the plugin actually leaves: `setName(name)`
 * off the manifest entry. The name is the only handle there is on which
 * piece of a placed group is which.
 */
function namedSprite(name: string, x = 0, y = 0) {
  return {
    ...sprite(x, y),
    name,
    visible: true,
    setVisible(v: boolean) {
      this.visible = v;
      return this;
    },
  };
}

describe("turning off the pieces a PSD says are hidden", () => {
  it("hides the ones it names and leaves the rest alone", () => {
    const lines = namedSprite("lines-abc");
    const shading = namedSprite("shading-abc");
    const shape = namedSprite("shape-abc");
    const parts = partsOf(group(lines, shading, shape));

    applyHidden(parts, ["lines-abc"]);

    expect(lines.visible).toBe(false);
    expect(shading.visible).toBe(true);
    expect(shape.visible).toBe(true);
  });

  it("does nothing at all when there is nothing hidden", () => {
    const shape = namedSprite("shape-abc");
    const parts = partsOf(group(shape));
    applyHidden(parts, undefined);
    applyHidden(parts, []);
    expect(shape.visible).toBe(true);
  });

  it("reaches a piece inside a group inside the placement", () => {
    // psd-to-json marks every layer under a hidden folder as hidden in its
    // own right, so the names reach the leaves even though the folder itself
    // is not a piece — only the things that draw are.
    const inner = namedSprite("sketch");
    const outer = namedSprite("hall");
    const parts = partsOf(group(outer, group(inner) as never));

    applyHidden(parts, ["sketch"]);

    expect(inner.visible).toBe(false);
    expect(outer.visible).toBe(true);
  });

  it("carries each piece's name off the object", () => {
    const parts = partsOf(group(namedSprite("a"), namedSprite("b")));
    expect(parts.map((part) => part.name)).toEqual(["a", "b"]);
  });
});
