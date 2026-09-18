/**
 * The palette's rules, which are about *identity* and *refusal* rather than
 * about colour.
 *
 * Four are load-bearing and none is obvious from the type. A colour is one
 * colour however it was spelt, so `#FFF` and `#ffffff` do not both go in. A
 * re-add does not move a colour, because the order is the order they were
 * chosen in. A fully transparent colour never goes in at all, because a row of
 * empty squares is a row of buttons that do nothing visible. And the ceiling
 * is a refusal rather than a drop off the far end — which is the opposite of
 * what the recents beside it do, and the difference between a decision and a
 * record.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PALETTE, PaletteStore, psdSwatchSize } from "../palette";

/** A `localStorage` for a suite that runs in node. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

beforeEach(() => store.clear());

describe("the working palette", () => {
  it("keeps colours in the order they were added", () => {
    const palette = new PaletteStore();
    palette.add("#ff0000");
    palette.add("#00ff00");
    palette.add("#0000ff");
    expect(palette.list()).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("treats one colour as one colour however it was spelt", () => {
    const palette = new PaletteStore();
    expect(palette.add("#FFF")).toBe(true);
    expect(palette.add("#ffffff")).toBe(false);
    expect(palette.add("#FFFFFFFF")).toBe(false);
    expect(palette.list()).toEqual(["#ffffff"]);
    expect(palette.has("#fff")).toBe(true);
  });

  it("does not move a colour that is re-added", () => {
    const palette = new PaletteStore();
    palette.addMany(["#111111", "#222222", "#333333"]);
    palette.add("#111111");
    expect(palette.list()).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("refuses a colour nobody could see", () => {
    const palette = new PaletteStore();
    expect(palette.add("#ff000000")).toBe(false);
    expect(palette.list()).toEqual([]);
    // A colour that is merely faint is still a colour.
    expect(palette.add("#ff000010")).toBe(true);
  });

  it("refuses anything that is not a colour", () => {
    const palette = new PaletteStore();
    expect(palette.add("rebeccapurple")).toBe(false);
    expect(palette.add("#12345")).toBe(false);
    expect(palette.list()).toEqual([]);
  });

  it("refuses past the ceiling rather than dropping the oldest", () => {
    const palette = new PaletteStore();
    for (let n = 0; n < MAX_PALETTE; n += 1) {
      expect(palette.add(`#${n.toString(16).padStart(6, "0")}`)).toBe(true);
    }
    const before = palette.list();
    expect(palette.add("#abcdef")).toBe(false);
    expect(palette.list()).toEqual(before);
  });

  it("adds a whole row at once, skipping what it already holds", () => {
    const palette = new PaletteStore();
    palette.add("#69d2e7");
    expect(palette.addMany(["#69d2e7", "#a7dbd8", "#e0e4cc"])).toBe(2);
    expect(palette.list()).toEqual(["#69d2e7", "#a7dbd8", "#e0e4cc"]);
    // And a row with nothing new in it changes nothing and says so.
    expect(palette.addMany(["#69d2e7", "#a7dbd8"])).toBe(0);
  });

  it("stops a row at the ceiling instead of overflowing it", () => {
    const palette = new PaletteStore();
    const many = Array.from(
      { length: MAX_PALETTE + 10 },
      (_, n) => `#${n.toString(16).padStart(6, "0")}`,
    );
    expect(palette.addMany(many)).toBe(MAX_PALETTE);
    expect(palette.list()).toHaveLength(MAX_PALETTE);
  });

  it("takes a colour out however it was spelt", () => {
    const palette = new PaletteStore();
    palette.add("#ff0000");
    expect(palette.remove("#F00")).toBe(true);
    expect(palette.list()).toEqual([]);
    expect(palette.remove("#F00")).toBe(false);
  });

  it("comes back as it was left", () => {
    const first = new PaletteStore();
    first.addMany(["#111111", "#222222"]);
    first.attach = true;

    const second = new PaletteStore();
    expect(second.list()).toEqual(["#111111", "#222222"]);
    expect(second.attach).toBe(true);
  });

  it("starts fresh rather than throwing on a store it cannot read", () => {
    store.set("idlewild.palette", "{not json");
    expect(new PaletteStore().list()).toEqual([]);

    store.set("idlewild.palette", JSON.stringify(["#ff0000", 7, "nope", "#00ff00"]));
    expect(new PaletteStore().list()).toEqual(["#ff0000", "#00ff00"]);
  });

  it("tells every listener once per change", () => {
    const palette = new PaletteStore();
    let heard = 0;
    palette.addEventListener("change", () => (heard += 1));
    palette.addMany(["#111111", "#222222", "#333333"]);
    expect(heard).toBe(1);
    // A refusal is not a change.
    palette.add("#111111");
    expect(heard).toBe(1);
    palette.attach = true;
    expect(heard).toBe(2);
    palette.attach = true;
    expect(heard).toBe(2);
  });
});

describe("the swatch size a PSD gets", () => {
  it("is a quarter of the grid", () => {
    expect(psdSwatchSize(64)).toBe(16);
    expect(psdSwatchSize(256)).toBe(64);
  });

  it("never goes below something an eyedropper can hit", () => {
    // The smallest grid this editor offers is 8, whose quarter is 2.
    expect(psdSwatchSize(8)).toBe(4);
    expect(psdSwatchSize(0)).toBe(4);
    expect(psdSwatchSize(Number.NaN)).toBe(4);
  });
});
