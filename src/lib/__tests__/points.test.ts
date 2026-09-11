import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore, withScenes } from "../doc-store";
import type { Layer, StoredDoc } from "../types";

// The store writes through `ipc.doc.write`, which wants Tauri, and debounces
// on window timers where this runs in node. The same two stubs `scenes.test.ts`
// uses, for the same reason: nothing here is about persistence.
vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function layer(id: string): Layer {
  return {
    id,
    name: id,
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    points: [],
    zones: [],
    strokes: [],
  };
}

const DOC: StoredDoc = {
  version: 2,
  projection: "orthogonal",
  gridSize: 64,
  scenes: [{ id: "s1", name: "Main", layers: [layer("l1"), layer("l2")] }],
  activeSceneId: "s1",
};

describe("named points", () => {
  let store: DocStore;

  beforeEach(() => {
    store = new DocStore("p1", structuredClone(DOC));
  });

  it("names each one after the scene, not after its layer", () => {
    // Two layers each starting at "Point 1" would be two points with one
    // name, and the game reads them by name.
    const a = store.addPoint("l1", { cx: 0, cy: 0 });
    const b = store.addPoint("l2", { cx: 1, cy: 0 });
    expect([a.name, b.name]).toEqual(["Point 1", "Point 2"]);
  });

  it("fills a hole rather than counting", () => {
    const first = store.addPoint("l1", { cx: 0, cy: 0 });
    store.addPoint("l1", { cx: 1, cy: 0 });
    store.removePoint("l1", first.id);
    expect(store.addPoint("l1", { cx: 2, cy: 0 }).name).toBe("Point 1");
  });

  it("takes a name it is given", () => {
    expect(store.addPoint("l1", { cx: 0, cy: 0 }, "Cave mouth").name).toBe(
      "Cave mouth",
    );
  });
});

describe("the scene's start point", () => {
  let store: DocStore;

  beforeEach(() => {
    store = new DocStore("p1", structuredClone(DOC));
  });

  it("is one point, and naming another releases the first", () => {
    const a = store.addPoint("l1", { cx: 0, cy: 0 });
    const b = store.addPoint("l2", { cx: 4, cy: 4 });
    store.setStartPoint(a.id);
    expect(store.startPoint?.id).toBe(a.id);
    store.setStartPoint(b.id);
    expect(store.startPoint?.id).toBe(b.id);
    expect(store.activeScene.startPointId).toBe(b.id);
  });

  it("is found wherever in the scene it lives", () => {
    const b = store.addPoint("l2", { cx: 4, cy: 4 });
    store.setStartPoint(b.id);
    expect(store.startPoint?.cell).toEqual({ cx: 4, cy: 4 });
  });

  it("is cleared by deleting the point that holds it", () => {
    const a = store.addPoint("l1", { cx: 0, cy: 0 });
    store.setStartPoint(a.id);
    store.removePoint("l1", a.id);
    expect(store.activeScene.startPointId).toBeUndefined();
    expect(store.startPoint).toBeUndefined();
  });

  it("is cleared by deleting the layer that holds it", () => {
    const a = store.addPoint("l2", { cx: 0, cy: 0 });
    store.setStartPoint(a.id);
    store.removeLayer("l2");
    expect(store.activeScene.startPointId).toBeUndefined();
  });

  it("survives deleting a layer that does not hold it", () => {
    const a = store.addPoint("l1", { cx: 0, cy: 0 });
    store.setStartPoint(a.id);
    store.removeLayer("l2");
    expect(store.activeScene.startPointId).toBe(a.id);
  });

  it("belongs to the scene it was set on", () => {
    const a = store.addPoint("l1", { cx: 0, cy: 0 });
    store.setStartPoint(a.id);
    const second = store.addScene("Cave");
    expect(second.startPointId).toBeUndefined();
    store.setActiveScene("s1");
    expect(store.startPoint?.id).toBe(a.id);
  });

  it("follows a duplicate onto the copy's own point", () => {
    const a = store.addPoint("l1", { cx: 2, cy: 3 }, "Gate");
    store.setStartPoint(a.id);
    const copy = store.duplicateScene("s1");

    // A real copy: its own point, its own id, and the designation pointing
    // at that one rather than at the original's, which is in another scene.
    const copied = copy?.layers[0].points[0];
    expect(copied).toBeDefined();
    expect(copied?.id).not.toBe(a.id);
    expect(copied?.name).toBe("Gate");
    expect(copy?.startPointId).toBe(copied?.id);
  });
});

describe("a document written before points existed", () => {
  it("gets an empty list on every layer rather than an undefined", () => {
    const doc = withScenes({
      version: 2,
      projection: "blank",
      gridSize: 32,
      scenes: [
        {
          id: "a",
          name: "A",
          // As it comes off disk: no `points` at all.
          layers: [{ ...layer("l1"), points: undefined as unknown as [] }],
        },
      ],
      activeSceneId: "a",
    });
    expect(doc.scenes[0].layers[0].points).toEqual([]);
  });
});
