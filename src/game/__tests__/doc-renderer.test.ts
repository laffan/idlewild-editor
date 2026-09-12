import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { DocRenderer, type PlacedObject } from "../doc-renderer";
import type { StoredDoc, Placement } from "../../lib/types";

/** Enough of a Graphics for the renderer to draw fills and zones into. */
function graphics(): Phaser.GameObjects.Graphics {
  const g: Record<string, unknown> = {};
  const chain = () => g;
  for (const name of [
    "setDepth", "clear", "fillStyle", "lineStyle", "beginPath", "moveTo",
    "lineTo", "closePath", "fillPath", "strokePath", "destroy",
  ]) {
    g[name] = chain;
  }
  return g as unknown as Phaser.GameObjects.Graphics;
}

const scene = { add: { graphics } } as unknown as Phaser.Scene;

/** A placed object that only remembers whether it was told to show. */
function placed(): PlacedObject & { visible: boolean } {
  return {
    visible: true,
    setPosition: () => undefined,
    setScale: () => undefined,
    setDepth: () => undefined,
    setVisible(v: boolean) {
      this.visible = v;
      return this;
    },
    destroy: () => undefined,
  };
}

/** A child of a placed group, as psd-to-phaser leaves one: it has a depth. */
function child(depth: number): { depth: number; setDepth: (v: number) => void } {
  return {
    depth,
    setDepth(v: number) {
      this.depth = v;
    },
  };
}

/**
 * A placed *group*, which is what psd-to-phaser hands back — and what an
 * extrusion's artwork is, three parts deep.
 */
function placedGroup(...children: ReturnType<typeof child>[]): PlacedObject & {
  children: ReturnType<typeof child>[];
  flattened: number | null;
} {
  return {
    children,
    flattened: null,
    setPosition: () => undefined,
    setScale: () => undefined,
    setDepth(v: number) {
      // What the grafted method does: one number for every child.
      this.flattened = v;
      for (const c of this.children) c.setDepth(v);
      return this;
    },
    setVisible: () => undefined,
    destroy: () => undefined,
    getChildren() {
      return this.children;
    },
  };
}

function placement(id: string, instance: string): Placement {
  return {
    id,
    psdKey: "extrude-abc",
    layerPath: `layer-${id}`,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
    instance,
  };
}

function doc(...placements: Placement[]): StoredDoc {
  return {
    version: 1,
    projection: "isometric",
    gridSize: 64,
    layers: [
      {
        id: "l1",
        name: "Foreground",
        locked: false,
        visible: true,
        fills: [],
        placements,
        points: [],
        zones: [],
        strokes: [],
      },
    ],
  };
}

describe("suppressing a placed unit", () => {
  function setUp() {
    const one = placement("a", "unit-1");
    const two = placement("b", "unit-1");
    const other = placement("c", "unit-2");
    const store = new DocStore("p", doc(one, two, other));
    const renderer = new DocRenderer(scene, store, new Grid("isometric", 64));
    const objects = { a: placed(), b: placed(), c: placed() };
    renderer.attach("l1", one, objects.a);
    renderer.attach("l1", two, objects.b);
    renderer.attach("l1", other, objects.c);
    return { renderer, objects };
  }

  it("takes every member of the unit off the canvas, and nothing else", () => {
    const { renderer, objects } = setUp();
    renderer.suppressInstance("unit-1");
    expect(objects.a.visible).toBe(false);
    expect(objects.b.visible).toBe(false);
    expect(objects.c.visible).toBe(true);
  });

  it("puts it back when nothing is being worked on", () => {
    const { renderer, objects } = setUp();
    renderer.suppressInstance("unit-1");
    renderer.suppressInstance(null);
    expect(objects.a.visible).toBe(true);
    expect(objects.b.visible).toBe(true);
  });

  it("keeps it hidden across an ordinary repaint", () => {
    const { renderer, objects } = setUp();
    renderer.suppressInstance("unit-1");
    renderer.render();
    expect(objects.a.visible).toBe(false);
  });

  it("changes nothing in the document, so a cancelled session leaves no trace", () => {
    const one = placement("a", "unit-1");
    const store = new DocStore("p", doc(one));
    const renderer = new DocRenderer(scene, store, new Grid("isometric", 64));
    renderer.attach("l1", one, placed());
    renderer.suppressInstance("unit-1");
    expect(store.layers[0].placements).toHaveLength(1);
    expect(store.layers[0].placements[0]).toEqual(one);
  });
});

/**
 * The bug this exists for: an extrusion's three parts came back in the wrong
 * order on the canvas while the PSD itself was right.
 *
 * psd-to-phaser grafts its own `setDepth` onto a Group and that one recurses,
 * giving every child the same number — so the stacking the manifest carried
 * was thrown away the moment the editor set the placement's depth.
 */
describe("depth on a placed group", () => {
  function setUp(...depths: number[]) {
    const one = placement("a", "unit-1");
    const store = new DocStore("p", doc(one));
    const renderer = new DocRenderer(scene, store, new Grid("isometric", 64));
    const group = placedGroup(...depths.map(child));
    renderer.attach("l1", one, group);
    return group;
  }

  it("keeps the parts in the order the manifest gave them", () => {
    // As psd-to-phaser leaves them: shape at the back, lines in front.
    const group = setUp(0, 1, 2);
    const after = group.children.map((c) => c.depth);
    expect(after[0]).toBeLessThan(after[1]);
    expect(after[1]).toBeLessThan(after[2]);
    expect(new Set(after).size, "every part needs its own depth").toBe(3);
  });

  it("keeps them inside the placement's own step, not over the next one", () => {
    const group = setUp(0, 1, 2);
    const base = Math.floor(group.children[0].depth);
    for (const c of group.children) {
      expect(c.depth).toBeGreaterThan(base);
      expect(c.depth).toBeLessThan(base + 1);
    }
  });

  it("says the same thing on a repaint, having re-ranked its own numbers", () => {
    const one = placement("a", "unit-1");
    const store = new DocStore("p", doc(one));
    const renderer = new DocRenderer(scene, store, new Grid("isometric", 64));
    const group = placedGroup(child(2), child(0), child(1));
    renderer.attach("l1", one, group);
    const first = group.children.map((c) => c.depth);
    renderer.render();
    expect(group.children.map((c) => c.depth)).toEqual(first);
  });

  it("leaves a single-sprite placement exactly as it was", () => {
    const group = setUp(0);
    expect(group.flattened).not.toBeNull();
  });
});

/**
 * And the same bug in the other grafted method.
 *
 * `setPosition` recurses too, so a placed group put every part on the
 * placement's own corner. That was invisible while the only groups the editor
 * wrote were extrusions — whose three parts go into the file at one size and
 * one offset — and stopped being invisible the day those files gained a
 * margin to paint in: Photoshop crops a layer to its ink, so a saved
 * extrusion comes back with its shading half a tile below its silhouette, and
 * anything painted past the artwork moves the group's corner.
 */
describe("position on a placed group", () => {
  /** A sprite the plugin has placed: at its layer's spot in the canvas. */
  function part(x: number, y: number) {
    return {
      x,
      y,
      setPosition(nx: number, ny: number) {
        this.x = nx;
        this.y = ny;
        return this;
      },
      setScale: () => undefined,
      setDepth: () => undefined,
    };
  }

  function partGroup(...children: ReturnType<typeof part>[]) {
    return {
      children,
      setPosition(x: number, y: number) {
        for (const c of this.children) c.setPosition(x, y);
        return this;
      },
      setScale: () => undefined,
      setDepth: () => undefined,
      setVisible: () => undefined,
      destroy: () => undefined,
      getChildren() {
        return this.children;
      },
    };
  }

  function setUp(group: ReturnType<typeof partGroup>, over: Partial<Placement> = {}) {
    const one = { ...placement("a", "unit-1"), ...over };
    const store = new DocStore("p", doc(one));
    const renderer = new DocRenderer(scene, store, new Grid("isometric", 64));
    renderer.attach("l1", one, group);
    return renderer;
  }

  it("keeps each part's offset inside the placement", () => {
    // A file back from Photoshop: shape and lines on the artwork's corner,
    // shading cropped to its own ink half a tile down.
    const shape = part(128, 64);
    const shading = part(128, 128);
    setUp(partGroup(shape, shading), {
      x: -64,
      y: -96,
      width: 128,
      height: 160,
      naturalWidth: 256,
      naturalHeight: 320,
    });

    expect([shape.x, shape.y]).toEqual([-64, -96]);
    // Placed at half size, so the 64 px it hangs down in the file is 32 here.
    expect([shading.x, shading.y]).toEqual([-64, -64]);
  });

  it("still stacks the parts when the file puts them all on one corner", () => {
    const a = part(40, 40);
    const b = part(40, 40);
    setUp(partGroup(a, b), { x: 7, y: 9, naturalWidth: 32, naturalHeight: 32 });
    expect([a.x, a.y]).toEqual([7, 9]);
    expect([b.x, b.y]).toEqual([7, 9]);
  });

  it("moves them further apart as the placement grows", () => {
    const shape = part(0, 0);
    const shading = part(0, 100);
    setUp(partGroup(shape, shading), {
      x: 0,
      y: 0,
      width: 200,
      height: 400,
      naturalWidth: 100,
      naturalHeight: 200,
    });
    expect(shading.y).toBe(200);
  });
});
