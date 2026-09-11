import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { DocRenderer, type PlacedObject } from "../doc-renderer";
import type { GameDoc, Placement } from "../../lib/types";

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

function doc(...placements: Placement[]): GameDoc {
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
