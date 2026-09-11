import { describe, expect, it } from "vitest";
// The injected bridge as text, the way the Rust side takes it: `include_str!`
// there, `?raw` here, one file either way.
import bridgeSource from "../../../src-tauri/templates/play/console-bridge.js?raw";
import { previewLine, snapshot, text, type LogValue } from "../log-value";

describe("snapshot", () => {
  it("keeps the difference between a number and a string that looks like one", () => {
    expect(snapshot(5)).toEqual({ t: "number", v: "5" });
    expect(snapshot("5")).toEqual({ t: "string", v: "5" });
    expect(snapshot(true)).toEqual({ t: "boolean", v: true });
    expect(snapshot(null)).toEqual({ t: "empty", v: "null" });
    expect(snapshot(undefined)).toEqual({ t: "empty", v: "undefined" });
  });

  it("holds the numbers JSON would lose", () => {
    expect(snapshot(NaN)).toEqual({ t: "number", v: "NaN" });
    expect(snapshot(Infinity)).toEqual({ t: "number", v: "Infinity" });
    expect(snapshot(-0)).toEqual({ t: "number", v: "-0" });
  });

  it("names the class an object came from, and leaves a plain one unnamed", () => {
    class Sprite {
      x = 1;
    }
    expect(snapshot(new Sprite())).toEqual({
      t: "object",
      label: "Sprite",
      entries: [["x", { t: "number", v: "1" }]],
    });
    expect(snapshot({ x: 1 })).toEqual({
      t: "object",
      entries: [["x", { t: "number", v: "1" }]],
    });
  });

  it("opens a Map and a Set, which keep their contents behind an iterator", () => {
    expect(snapshot(new Map([["a", 1]]))).toEqual({
      t: "object",
      label: "Map(1)",
      entries: [["a", { t: "number", v: "1" }]],
    });
    expect(snapshot(new Set(["x"]))).toEqual({
      t: "object",
      label: "Set(1)",
      entries: [["0", { t: "string", v: "x" }]],
    });
  });

  it("cuts a cycle and nothing else", () => {
    const child = { name: "leaf" };
    const both = { a: child, b: child };
    // The same object twice side by side is not a cycle, and calling it one
    // would be a lie about the data.
    expect(snapshot(both)).toEqual({
      t: "object",
      entries: [
        ["a", { t: "object", entries: [["name", { t: "string", v: "leaf" }]] }],
        ["b", { t: "object", entries: [["name", { t: "string", v: "leaf" }]] }],
      ],
    });

    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(snapshot(loop)).toEqual({
      t: "object",
      entries: [["self", { t: "other", v: "[Circular]" }]],
    });
  });

  it("stops at the depth cap and says so", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const a = snapshot(deep) as Extract<LogValue, { t: "object" }>;
    expect(previewLine(a, 9)).toContain("[Object]");
  });

  it("counts what it left out", () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    const shot = snapshot(many) as Extract<LogValue, { t: "array" }>;
    expect(shot.items).toHaveLength(100);
    expect(shot.more).toBe(20);
  });

  it("renders the things it will never open", () => {
    expect(snapshot(function walk() {})).toEqual({ t: "other", v: "ƒ walk()" });
    const err = new Error("boom");
    err.stack = "Error: boom\n  at create (WorldScene.js:8:3)";
    expect(snapshot(err)).toEqual({ t: "other", v: err.stack });
  });
});

describe("previewLine", () => {
  it("quotes a string inside a structure and not at the top of a line", () => {
    expect(previewLine(snapshot("hi"))).toBe('"hi"');
    expect(text(snapshot("hi"))).toBe("hi");
    expect(previewLine(snapshot({ name: "hi" }))).toBe('{name: "hi"}');
  });

  it("gets shorter as it nests, so one line stays one line", () => {
    const value = snapshot({ a: { b: { c: 1 } } });
    expect(previewLine(value)).toBe("{a: {b: {…}}}");
  });

  it("says when a preview is not the whole thing", () => {
    expect(previewLine(snapshot([1, 2, 3, 4, 5, 6]))).toBe("[1, 2, 3, 4, 5, …]");
    expect(previewLine(snapshot([]))).toBe("[]");
    expect(previewLine(snapshot({}))).toBe("{}");
  });
});

/**
 * One contract, two implementations.
 *
 * The game frame cannot import `log-value.ts` — it is a different origin
 * running a plain script the asset server injected — so the same flattening
 * exists twice, once here and once in `templates/play/console-bridge.js`. The
 * bridge hangs its copy off `window.__idlewildSnapshot` for exactly this, and
 * a drift between them would show up as a console that renders the editor's
 * own objects and not the game's.
 */
describe("the bridge's snapshot and this one agree", () => {
  const bridgeSnapshot = loadBridgeSnapshot();

  const fixtures: Array<[string, unknown]> = [
    ["a string", "hello"],
    ["a number", 42],
    ["not a number", NaN],
    ["negative zero", -0],
    ["a boolean", false],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { cx: 3, cy: 4, name: "tile" }],
    ["an array", [1, "two", false, null]],
    ["nesting", { layers: [{ fills: [{ colour: "#ec3013" }] }] }],
    ["past the depth cap", { a: { b: { c: { d: { e: 1 } } } } }],
    ["a map", new Map([["a", 1]])],
    ["a set", new Set([7])],
    ["a long array", Array.from({ length: 120 }, (_, i) => i)],
  ];

  for (const [name, value] of fixtures) {
    it(`agrees on ${name}`, () => {
      expect(bridgeSnapshot(value)).toEqual(snapshot(value));
    });
  }

  it("agrees on a class instance", () => {
    class Body {
      vx = 0;
      vy = 12;
    }
    expect(bridgeSnapshot(new Body())).toEqual(snapshot(new Body()));
  });

  it("agrees on a cycle", () => {
    const make = () => {
      const loop: Record<string, unknown> = { n: 1 };
      loop.self = loop;
      return loop;
    };
    expect(bridgeSnapshot(make())).toEqual(snapshot(make()));
  });
});

/**
 * Run the injected bridge far enough to get its snapshot out.
 *
 * It publishes the function on `window` before it looks for a parent, and
 * bails when there is none — so a stub window with no parent runs the half
 * this test is about and none of the half that would post messages.
 */
function loadBridgeSnapshot(): (value: unknown) => LogValue {
  const win: Record<string, unknown> = {};
  win.parent = win;
  new Function("window", bridgeSource)(win);
  const fn = win.__idlewildSnapshot;
  if (typeof fn !== "function") {
    throw new Error("the bridge no longer exposes its snapshot");
  }
  return fn as (value: unknown) => LogValue;
}
