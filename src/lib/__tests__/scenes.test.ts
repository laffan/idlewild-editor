import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore, withScenes } from "../doc-store";
import type { Placement, StoredDoc } from "../types";

// The store writes through `ipc.doc.write`, which wants Tauri. Nothing here
// is about persistence, so the call is stubbed at the boundary.
vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

// And it debounces that write on window timers, where this runs in node. The
// same stub `game/__tests__/reconcile.test.ts` uses, for the same reason: a
// save that actually fired would reach for Tauri.
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function layer(id: string, placements: Placement[] = []) {
  return {
    id,
    name: id,
    locked: false,
    visible: true,
    fills: [],
    placements,
    zones: [],
    strokes: [],
  };
}

function placement(id: string, instance?: string): Placement {
  return {
    id,
    psdKey: "tower",
    layerPath: "tower",
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
    ...(instance ? { instance } : {}),
  };
}

/** A document as a project written before scenes existed would hold it. */
const LEGACY: StoredDoc = {
  version: 1,
  projection: "isometric",
  gridSize: 64,
  layers: [layer("l1"), layer("l2")],
  camera: { x: 10, y: 20, zoom: 2 },
};

describe("migrating a document written before scenes", () => {
  it("folds its layers and its camera into one scene called Main", () => {
    const doc = withScenes(LEGACY);
    expect(doc.version).toBe(2);
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0].name).toBe("Main");
    expect(doc.scenes[0].layers.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(doc.scenes[0].camera).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(doc.activeSceneId).toBe(doc.scenes[0].id);
  });

  it("leaves nothing at the top level to be read twice", () => {
    const doc = withScenes(LEGACY);
    expect(doc.layers).toBeUndefined();
    expect(doc.camera).toBeUndefined();
  });

  it("gives a document with no layers at all somewhere to draw", () => {
    const doc = withScenes({ version: 1, projection: "blank", gridSize: 32 });
    expect(doc.scenes[0].layers).toHaveLength(1);
  });

  it("repairs an activeSceneId that names no scene", () => {
    const doc = withScenes({
      version: 2,
      projection: "blank",
      gridSize: 32,
      scenes: [{ id: "a", name: "A", layers: [layer("l1")] }],
      activeSceneId: "gone",
    });
    expect(doc.activeSceneId).toBe("a");
  });

  it("leaves a document that already has scenes alone", () => {
    const scenes = [
      { id: "a", name: "A", layers: [layer("l1")] },
      { id: "b", name: "B", layers: [layer("l2")] },
    ];
    const doc = withScenes({
      version: 2,
      projection: "blank",
      gridSize: 32,
      scenes,
      activeSceneId: "b",
    });
    expect(doc.scenes).toBe(scenes);
    expect(doc.activeSceneId).toBe("b");
  });
});

describe("scenes", () => {
  let store: DocStore;

  beforeEach(() => {
    store = new DocStore("p1", LEGACY);
  });

  it("answers layer questions about the scene that is open", () => {
    expect(store.layers.map((l) => l.id)).toEqual(["l1", "l2"]);
    const made = store.addScene("Cave");
    // A new scene is a clean canvas: one empty layer, and none of the last
    // one's.
    expect(store.activeSceneId).toBe(made.id);
    expect(store.layers).toHaveLength(1);
    expect(store.layer("l1")).toBeUndefined();

    store.setActiveScene(store.scenes[0].id);
    expect(store.layers.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("writes a layer edit into the scene it was made in", () => {
    const cave = store.addScene("Cave");
    store.addLayer("Walls");
    expect(store.layers.map((l) => l.name)).toEqual(["Walls", "Terrain"]);

    store.setActiveScene(store.scenes[0].id);
    expect(store.layers.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(store.scene(cave.id)?.layers).toHaveLength(2);
  });

  it("keeps a camera per scene, because a scene is a place", () => {
    store.setCamera(5, 6, 3);
    const cave = store.addScene("Cave");
    expect(store.activeScene.camera).toBeUndefined();
    store.setCamera(100, 200, 1);

    store.setActiveScene(store.scenes[0].id);
    expect(store.activeScene.camera).toEqual({ x: 5, y: 6, zoom: 3 });
    expect(store.scene(cave.id)?.camera).toEqual({ x: 100, y: 200, zoom: 1 });
  });

  it("fires scene as well as change when the canvas becomes another one", () => {
    const changes: string[] = [];
    store.addEventListener("change", () => changes.push("change"));
    store.addEventListener("scene", () => changes.push("scene"));

    store.addScene("Cave");
    // change first, so a listener that redraws runs after one that re-reads.
    expect(changes).toEqual(["change", "scene"]);

    changes.length = 0;
    store.renameScene(store.activeSceneId, "Cavern");
    expect(changes).toEqual(["change"]);

    changes.length = 0;
    store.setActiveScene(store.activeSceneId);
    expect(changes).toEqual([]);
  });

  it("keeps at least one scene", () => {
    store.removeScene(store.activeSceneId);
    expect(store.scenes).toHaveLength(1);
  });

  it("opens the first scene when the one you were in is deleted", () => {
    const first = store.activeSceneId;
    const cave = store.addScene("Cave");
    store.removeScene(cave.id);
    expect(store.activeSceneId).toBe(first);
    expect(store.scenes).toHaveLength(1);
  });

  it("gives a duplicate ids of its own, all the way down", () => {
    store.addPlacement("l1", placement("", "unit-1") as Omit<Placement, "id">);
    store.addPlacement("l1", placement("", "unit-1") as Omit<Placement, "id">);
    const source = store.scenes[0];
    const copy = store.duplicateScene(source.id);
    expect(copy).toBeDefined();
    if (!copy) return;

    expect(copy.name).toBe("Main copy");
    expect(store.activeSceneId).toBe(copy.id);
    // Nothing in the copy shares an id with the original: two scenes holding
    // one placement id would be one rendered object belonging to both.
    const ids = (scene: typeof copy) =>
      scene.layers.flatMap((l) => [l.id, ...l.placements.map((p) => p.id)]);
    const before = new Set(ids(source));
    expect(ids(copy).some((id) => before.has(id))).toBe(false);

    // The unit two placements arrived as is still one unit, and not the
    // original's.
    const units = copy.layers[0].placements.map((p) => p.instance);
    expect(new Set(units).size).toBe(1);
    expect(units[0]).not.toBe("unit-1");
  });

  it("rewrites a PSD key in every scene, not just the open one", () => {
    store.addPlacement("l1", placement("") as Omit<Placement, "id">);
    const cave = store.addScene("Cave");
    store.addPlacement(store.layers[0].id, placement("") as Omit<Placement, "id">);

    // A file is one file for the project. A placement left behind in another
    // scene would point at a key that no longer exists and never render.
    store.updatePlacementsEverywhere((p) =>
      p.psdKey === "tower" ? { psdKey: "keep", layerPath: "keep" } : null,
    );

    const keys = [...store.everyPlacement()].map((e) => e.placement.psdKey);
    expect(keys).toEqual(["keep", "keep"]);
    expect([...store.everyPlacement()].map((e) => e.sceneId)).toEqual([
      store.scenes[0].id,
      cave.id,
    ]);
  });

  it("puts a duplicate next to what it came from", () => {
    const first = store.scenes[0].id;
    store.addScene("Cave");
    store.duplicateScene(first);
    expect(store.scenes.map((s) => s.name)).toEqual(["Main", "Main copy", "Cave"]);
  });
});
