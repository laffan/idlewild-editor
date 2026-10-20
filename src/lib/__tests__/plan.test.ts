/**
 * A scene's plan — see `lib/plan.ts` — and the stroke source the plan's ink
 * layer draws through (`drawing/stroke-store.ts`).
 */

import { describe, expect, it } from "vitest";
import { hasPlan, planOf, planSource, withPlan } from "../plan";
import { StrokeStore } from "../../drawing/stroke-store";
import type { DocStore } from "../doc-store";
import type { GameDoc, Scene, Stroke } from "../types";

function stroke(id: string): Stroke {
  return { id, points: [0, 0, 1, 10, 10, 1], brushId: 0, size: 4, color: "#0a84ff", mode: "ink", createdAt: 0 };
}

const scene = (id: string, plan?: Stroke[]): Scene => ({ id, name: id, layers: [], ...(plan ? { plan } : {}) });

/** The two things a plan needs of the store: the open scene, and an edit. */
function fakeStore(doc: Pick<GameDoc, "scenes" | "activeSceneId">) {
  let state = doc as GameDoc;
  let edits = 0;
  const store = {
    get activeScene() {
      return state.scenes.find((s) => s.id === state.activeSceneId)!;
    },
    get activeSceneId() {
      return state.activeSceneId;
    },
    editDoc(update: (doc: GameDoc) => GameDoc) {
      state = update(state);
      edits++;
    },
    layer: () => undefined,
  };
  return { store: store as unknown as DocStore, state: () => state, edits: () => edits };
}

describe("a scene's plan", () => {
  it("is empty, the same empty list every time, on a scene nobody has planned", () => {
    expect(planOf(scene("a"))).toEqual([]);
    expect(planOf(scene("a"))).toBe(planOf(scene("b")));
    expect(hasPlan(scene("a"))).toBe(false);
    expect(hasPlan(scene("a", [stroke("s")]))).toBe(true);
  });

  it("drops the field rather than keeping an empty list", () => {
    const planned = withPlan(scene("a"), [stroke("s")]);
    expect(planned.plan).toHaveLength(1);
    expect("plan" in withPlan(planned, [])).toBe(false);
  });
});

describe("planSource", () => {
  it("reads and writes the open scene's plan, as one edit, and no layer", () => {
    const fake = fakeStore({ scenes: [scene("a"), scene("b", [stroke("old")])], activeSceneId: "b" });
    const store = new StrokeStore(fake.store, "", planSource(fake.store));
    expect(store.strokes.map((s) => s.id)).toEqual(["old"]);
    store.add([0, 0, 1, 5, 5, 1]);
    expect(fake.edits()).toBe(1);
    expect(fake.state().scenes[1].plan).toHaveLength(2);
    expect(fake.state().scenes[0].plan).toBeUndefined();
    store.remove(fake.state().scenes[1].plan!.map((s) => s.id));
    expect("plan" in fake.state().scenes[1]).toBe(false);
  });
});
