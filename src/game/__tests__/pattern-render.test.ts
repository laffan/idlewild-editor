/**
 * A pattern layer's copies, and the one thing that must never be left behind.
 *
 * These are Phaser groups holding sprites on the textures behind a PSD key.
 * A re-import, a rename and a repoint all evict those textures and load them
 * again, and a copy left pointing at an evicted one is not a blank sprite: it
 * is a throw inside Phaser's renderer on every frame from then on. The pass
 * dies part-way through, so the lattice stops being drawn — and anything
 * waiting on a completed pass, such as the thumbnail a project is closed by,
 * waits for ever. That is the bug this file exists for.
 *
 * The scene is a stub. Nothing here is about what Phaser draws; it is about
 * which objects this renderer is still holding, which is a question it can be
 * asked directly.
 */

import { describe, expect, it, vi } from "vitest";
import { PatternRender } from "../pattern-render";
import { DocStore } from "../../lib/doc-store";
import { emptyLayer } from "../../lib/doc-shape";
import { Grid } from "../../lib/grid";
import type { GameDoc, Layer, Placement } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

/** One placed object, and whether anything has destroyed it. */
interface Made {
  psdKey: string;
  destroyed: boolean;
}

function fakeScene(made: Made[], loaded: Set<string>) {
  const graphics = {
    clear: vi.fn(),
    setDepth: vi.fn(),
    lineStyle: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    strokePath: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    add: { graphics: () => graphics },
    cameras: { main: { zoom: 1 } },
    // Keyed on the manifest layer's name, which in these fixtures is the PSD
    // key — the check psd-to-phaser's own `place` makes before it warns.
    textures: { exists: (key: string) => loaded.has(key) },
    P2P: {
      // Set as soon as `data.json` parses, which is several frames before any
      // image lands. Believing it was the bug; both have to be true.
      getData: (psdKey: string) => (loaded.has(psdKey) ? { original: {} } : undefined),
      place: (_scene: unknown, psdKey: string) => {
        const object: Made = { psdKey, destroyed: false };
        made.push(object);
        return {
          setPosition: vi.fn(),
          setScale: vi.fn(),
          setDepth: vi.fn(),
          setVisible: vi.fn(),
          destroy: () => {
            object.destroyed = true;
          },
        };
      },
    },
  };
}

function placement(psdKey: string): Placement {
  return {
    id: `p-${psdKey}`,
    psdKey,
    layerPath: psdKey,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    naturalWidth: 32,
    naturalHeight: 32,
    anchor: { cx: 0, cy: 0 },
    instance: `u-${psdKey}`,
  };
}

function patternLayer(keys: string[]): Layer {
  return {
    ...emptyLayer("Pattern 1"),
    kind: "pattern",
    pattern: {
      type: "grid",
      density: 4,
      repeat: { cols: 4, rows: 4 },
      seed: 1,
      shapes: [],
    },
    placements: keys.map(placement),
  };
}

function setup(keys: string[]) {
  const made: Made[] = [];
  const loaded = new Set(keys);
  const scene = fakeScene(made, loaded);
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    activeSceneId: "scene-main",
    scenes: [{ id: "scene-main", name: "Main", layers: [patternLayer(keys)] }],
  };
  const store = new DocStore("test", doc);
  const render = new PatternRender(
    scene as unknown as ConstructorParameters<typeof PatternRender>[0],
    store,
    new Grid("orthogonal", 32),
  );
  return { made, render, loaded };
}

const view = { from: { cx: 0, cy: 0 }, to: { cx: 7, cy: 7 } };

describe("a pattern layer's copies", () => {
  it("are made for the spaces in view", () => {
    const { made, render } = setup(["tree"]);
    render.sync(view);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((m) => m.psdKey === "tree")).toBe(true);
  });

  it("are re-used when the camera has not moved", () => {
    const { made, render } = setup(["tree"]);
    render.sync(view);
    const first = made.length;
    render.sync(view);
    expect(made).toHaveLength(first);
  });

  /**
   * The regression. Before this, a re-import evicted the textures and left
   * these holding them: `frame.source.resolution` of null inside the
   * renderer, every frame, for the rest of the session.
   */
  it("are destroyed before their file's textures are evicted", () => {
    const { made, render } = setup(["tree"]);
    render.sync(view);
    expect(made.some((m) => !m.destroyed)).toBe(true);

    render.dropKey("tree");
    expect(made.every((m) => m.destroyed)).toBe(true);
  });

  it("leave another file's copies alone", () => {
    const { made, render } = setup(["tree", "rock"]);
    render.sync(view);
    render.dropKey("tree");

    const trees = made.filter((m) => m.psdKey === "tree");
    const rocks = made.filter((m) => m.psdKey === "rock");
    expect(trees.length).toBeGreaterThan(0);
    expect(rocks.length).toBeGreaterThan(0);
    expect(trees.every((m) => m.destroyed)).toBe(true);
    expect(rocks.every((m) => m.destroyed)).toBe(false);
  });

  /**
   * Dropping has to rebuild on the next frame even though the camera has not
   * moved. The range is all `sync` compares, so without clearing it the
   * pattern would simply be gone until somebody panned.
   */
  it("come back on the next frame after the file is restored", () => {
    const { made, render } = setup(["tree"]);
    render.sync(view);
    const first = made.length;
    render.dropKey("tree");
    render.restoreKey("tree");
    render.sync(view);
    expect(made.length).toBe(first * 2);
    expect(made.slice(first).every((m) => !m.destroyed)).toBe(true);
  });

  /**
   * The second half of the same bug. `dropKey` runs *before* the eviction and
   * the load that replaces it, and this renderer is on the frame loop — so
   * without a guard it rebuilds inside that window, against textures that are
   * not there, and psd-to-phaser makes sprites with nothing in them.
   */
  it("make nothing while a file is being rewritten, even once it is back", () => {
    const { made, render } = setup(["tree"]);
    render.dropKey("tree");
    render.sync(view);
    // The texture is there and the manifest parsed — but the eviction has not
    // happened yet, so anything made now is on a texture about to be
    // destroyed. Only the other end of `dropKey` clears it.
    expect(made).toEqual([]);

    render.restoreKey("tree");
    render.sync(view);
    expect(made.length).toBeGreaterThan(0);
  });

  it("make nothing from a file the plugin has not loaded", () => {
    const { made, render, loaded } = setup(["tree"]);
    loaded.delete("tree");
    render.sync(view);
    expect(made).toEqual([]);
  });

  /**
   * And the range must not be remembered as done, or the pattern would stay
   * missing over exactly the ground that was in view when the file was
   * rewritten — until somebody panned somewhere that had to be built fresh.
   */
  it("try the same range again once the file has arrived", () => {
    const { made, render, loaded } = setup(["tree"]);
    loaded.delete("tree");
    render.sync(view);
    expect(made).toEqual([]);

    loaded.add("tree");
    render.sync(view);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((m) => !m.destroyed)).toBe(true);
  });

  it("take down what is standing on a file that has gone", () => {
    const { made, render, loaded } = setup(["tree"]);
    render.sync(view);
    expect(made.some((m) => !m.destroyed)).toBe(true);

    loaded.delete("tree");
    render.invalidate();
    render.sync(view);
    expect(made.every((m) => m.destroyed)).toBe(true);
  });

  it("all go when the scene does", () => {
    const { made, render } = setup(["tree"]);
    render.sync(view);
    render.clear();
    expect(made.every((m) => m.destroyed)).toBe(true);
  });
});
