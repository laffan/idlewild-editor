/**
 * Undo, as the store actually drives it.
 *
 * Written against `DocStore` rather than against `DocHistory` alone, because
 * the thing worth asserting is not that a stack pops — it is that the stack
 * and the store's immutability agree: a step is one commit, a group is one
 * step however many commits are inside it, and a document restored two edits
 * back is the document that was there two edits back rather than a partial
 * copy of it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../doc-store";
import { DocHistory } from "../doc-history";
import type { GameDoc, StoredDoc } from "../types";

// The store writes through `ipc.doc.write`, which wants Tauri. Nothing here
// is about persistence, so the call is stubbed at the boundary.
vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

// And it debounces that write on window timers, where this runs in node.
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function layer(id: string) {
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

const BLANK: StoredDoc = {
  version: 2,
  projection: "orthogonal",
  gridSize: 32,
  scenes: [{ id: "s1", name: "Main", layers: [layer("l1")] }],
  activeSceneId: "s1",
};

let store: DocStore;

beforeEach(() => {
  store = new DocStore("p", structuredClone(BLANK));
});

describe("one edit, one step", () => {
  it("has nothing to undo until something is edited", () => {
    expect(store.history.canUndo).toBe(false);
    expect(store.history.canRedo).toBe(false);
    expect(store.history.undo()).toBe(false);
  });

  it("takes an edit back, and puts it back again", () => {
    store.renameLayer("l1", "Ground");
    expect(store.history.canUndo).toBe(true);

    expect(store.history.undo()).toBe(true);
    expect(store.layer("l1")?.name).toBe("l1");
    expect(store.history.canUndo).toBe(false);
    expect(store.history.canRedo).toBe(true);

    expect(store.history.redo()).toBe(true);
    expect(store.layer("l1")?.name).toBe("Ground");
  });

  it("walks back through a run of edits in order", () => {
    store.renameLayer("l1", "A");
    store.renameLayer("l1", "B");
    store.renameLayer("l1", "C");

    store.history.undo();
    expect(store.layer("l1")?.name).toBe("B");
    store.history.undo();
    expect(store.layer("l1")?.name).toBe("A");
    store.history.undo();
    expect(store.layer("l1")?.name).toBe("l1");
    expect(store.history.canUndo).toBe(false);
  });

  it("restores what was there, not a shape like it", () => {
    const fill = store.addFill("l1", {
      cells: [{ cx: 1, cy: 1 }],
      kind: "color",
      color: "#fff",
      walkable: true,
    });
    const before = store.doc;
    store.removeFill("l1", fill.id);
    expect(store.layer("l1")?.fills).toHaveLength(0);

    store.history.undo();
    // The same object, because a commit replaces rather than writes through:
    // undo is handing back the document that was there.
    expect(store.doc).toBe(before);
    expect(store.layer("l1")?.fills[0].id).toBe(fill.id);
  });

  it("drops the redo stack once a new edit branches off it", () => {
    store.renameLayer("l1", "A");
    store.history.undo();
    expect(store.history.canRedo).toBe(true);

    store.renameLayer("l1", "B");
    expect(store.history.canRedo).toBe(false);
    expect(store.history.depths).toEqual({ undo: 1, redo: 0 });
  });

  it("forgets the oldest step rather than the newest at the limit", () => {
    // Against the stack directly, with a limit small enough to reach: the
    // far end is the one nobody is about to press, so that is the one to go.
    let held = { at: 0 } as unknown as GameDoc;
    const history = new DocHistory(
      { current: () => held, restore: (doc) => (held = doc) },
      2,
    );
    const states = [0, 1, 2, 3].map((at) => ({ at }) as unknown as GameDoc);
    for (const state of states) {
      history.record(held);
      held = state;
    }
    expect(history.depths.undo).toBe(2);

    history.undo();
    expect((held as unknown as { at: number }).at).toBe(2);
    history.undo();
    expect((held as unknown as { at: number }).at).toBe(1);
    // Not back to 0: that step fell off the far end.
    expect(history.canUndo).toBe(false);
  });
});

describe("a group", () => {
  it("is one step however many commits are inside it", () => {
    store.history.group(() => {
      store.renameLayer("l1", "A");
      store.addLayer("Second");
      store.setLayerLocked("l1", true);
    });
    expect(store.history.depths.undo).toBe(1);

    store.history.undo();
    expect(store.layers).toHaveLength(1);
    expect(store.layer("l1")?.name).toBe("l1");
    expect(store.layer("l1")?.locked).toBe(false);
  });

  it("leaves no step at all when nothing inside it wrote", () => {
    store.history.begin();
    store.history.end();
    expect(store.history.canUndo).toBe(false);
  });

  it("closes on the outermost end, not the first", () => {
    store.history.begin();
    store.renameLayer("l1", "A");
    store.history.begin();
    store.renameLayer("l1", "B");
    store.history.end();
    store.renameLayer("l1", "C");
    store.history.end();

    expect(store.history.depths.undo).toBe(1);
    store.history.undo();
    expect(store.layer("l1")?.name).toBe("l1");
  });

  it("closes even when what it wraps throws", () => {
    expect(() =>
      store.history.group(() => {
        store.renameLayer("l1", "A");
        throw new Error("no");
      }),
    ).toThrow("no");
    // Not still open: the next edit is a step of its own.
    store.renameLayer("l1", "B");
    expect(store.history.depths.undo).toBe(2);
  });
});

describe("silence", () => {
  it("writes without leaving a step", () => {
    store.history.silence(() => store.renameLayer("l1", "Repaired"));
    expect(store.layer("l1")?.name).toBe("Repaired");
    expect(store.history.canUndo).toBe(false);
  });

  it("covers a group nested inside it", () => {
    store.history.silence(() => {
      store.history.group(() => store.renameLayer("l1", "Repaired"));
    });
    expect(store.history.canUndo).toBe(false);
  });
});

describe("what is not a step", () => {
  it("does not record looking at another scene", () => {
    store.addScene("Cave");
    const scenes = store.scenes.map((s) => s.id);
    store.setActiveScene(scenes[0]);
    // The scene was added — that is an edit — but the switch back was not.
    expect(store.history.depths.undo).toBe(1);
  });

  it("does not record a camera move", () => {
    store.setCamera(10, 20, 2);
    expect(store.history.canUndo).toBe(false);
  });
});

describe("undoing into another scene", () => {
  it("says the canvas has to be rebuilt, not just re-read", () => {
    const events: string[] = [];
    store.addEventListener("change", () => events.push("change"));
    store.addEventListener("scene", () => events.push("scene"));

    store.addScene("Cave");
    events.length = 0;
    store.history.undo();

    // `change` first, so a listener that re-reads runs before one that
    // redraws — the same order an edit and a switch fire in.
    expect(events).toEqual(["change", "scene"]);
    expect(store.scenes).toHaveLength(1);
    expect(store.activeSceneId).toBe("s1");
  });

  it("stays quiet about the scene when the undo is inside one", () => {
    const events: string[] = [];
    store.addEventListener("scene", () => events.push("scene"));
    store.renameLayer("l1", "A");
    store.history.undo();
    expect(events).toEqual([]);
  });
});

describe("a barrier", () => {
  it("forgets both directions, because going back would be a lie", () => {
    store.renameLayer("l1", "A");
    store.history.undo();
    expect(store.history.depths).toEqual({ undo: 0, redo: 1 });

    store.history.clear();
    expect(store.history.depths).toEqual({ undo: 0, redo: 0 });
  });
});

describe("the change event", () => {
  it("fires when what the buttons would do moves", () => {
    let beats = 0;
    store.history.addEventListener("change", () => (beats += 1));

    store.renameLayer("l1", "A");
    expect(beats).toBe(1);
    store.history.undo();
    expect(beats).toBe(2);
    store.history.redo();
    expect(beats).toBe(3);
    store.history.clear();
    expect(beats).toBe(4);
  });

  it("fires once for a group, not once per write inside it", () => {
    let beats = 0;
    store.history.addEventListener("change", () => (beats += 1));
    store.history.group(() => {
      store.renameLayer("l1", "A");
      store.renameLayer("l1", "B");
      store.renameLayer("l1", "C");
    });
    // The one entry the group pushed. Closing it changes nothing, because a
    // group that wrote nothing never pushed in the first place.
    expect(beats).toBe(1);
  });
});
