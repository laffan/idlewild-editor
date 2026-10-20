/**
 * What the inspector remembers about a folded section.
 *
 * The DOM pass that turns a heading into a control is not tested — there is no
 * DOM in this suite, by choice, and a fold applied to a `div` is a thing to
 * look at rather than to assert. What is worth pinning is the two decisions it
 * makes, because both are how the fold *stops being annoying*: which name a
 * section is remembered by, and that closing one lasts beyond the panel it was
 * closed in. The panel is rebuilt on every document change — a drag rebuilds it
 * per pointer move — so a fold that did not survive that would never be worth
 * making.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  EDIT_LAYERS,
  isCollapsed,
  resetCollapsedForTests,
  sectionName,
  setCollapsed,
} from "../inspect-collapse";
import { zoneKey } from "../inspect-zone";

/** A `localStorage` for a suite that runs in node. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

beforeEach(() => {
  store.clear();
  resetCollapsedForTests();
});

describe("the name a section is remembered by", () => {
  it("is the heading, for a heading that is only a name", () => {
    expect(sectionName("Transform")).toBe("Transform");
    expect(sectionName("Repeat boundary")).toBe("Repeat boundary");
  });

  /**
   * `Shapes · 2` counts in its own heading, because the list is the subject of
   * that section rather than a footnote under it. Keying on the whole string
   * would reopen it every time somebody added a shape.
   */
  it("drops a count the heading carries", () => {
    expect(sectionName("Shapes · 2")).toBe("Shapes");
    expect(sectionName("Shapes · 3")).toBe("Shapes");
  });
});

describe("what closing one is remembered as", () => {
  it("is nothing, before anything has been closed", () => {
    expect(isCollapsed("Collider")).toBe(false);
  });

  it("holds a closed section closed, and opens it again", () => {
    setCollapsed("Collider", true);
    expect(isCollapsed("Collider")).toBe(true);
    setCollapsed("Collider", false);
    expect(isCollapsed("Collider")).toBe(false);
  });

  it("says nothing about the sections beside it", () => {
    setCollapsed("Collider", true);
    expect(isCollapsed("Info")).toBe(false);
    expect(isCollapsed("Transform")).toBe(false);
  });

  /**
   * Per-install, like a sidebar's width: closing Collider once should keep it
   * closed for the next PSD selected, which is the reason to close it.
   */
  it("survives the panel, and the app", () => {
    setCollapsed("Collider", true);
    resetCollapsedForTests();
    expect(isCollapsed("Collider")).toBe(true);
  });

  /** Blocked site data, or something else's JSON under the same key. */
  it("starts from everything open when the store cannot be read", () => {
    store.set("idlewild.inspector.collapsed", "not json");
    resetCollapsedForTests();
    expect(isCollapsed("Collider")).toBe(false);
    // And it can still be written afterwards.
    setCollapsed("Collider", true);
    expect(isCollapsed("Collider")).toBe(true);
  });
});

/**
 * Edit Layers is the one section that starts shut: a file's stack is as long
 * as the file is deep, and selecting a PSD to move it put the whole list in
 * the way. Opening it is what is remembered, the way closing is for the rest.
 */
describe("a section that starts folded", () => {
  it("is shut before anybody has touched it", () => {
    expect(EDIT_LAYERS).toBe("Edit Layers");
    expect(isCollapsed(EDIT_LAYERS)).toBe(true);
  });

  it("stays open once opened, across the panel and the app", () => {
    setCollapsed(EDIT_LAYERS, false);
    expect(isCollapsed(EDIT_LAYERS)).toBe(false);
    resetCollapsedForTests();
    expect(isCollapsed(EDIT_LAYERS)).toBe(false);
    setCollapsed(EDIT_LAYERS, true);
    resetCollapsedForTests();
    expect(isCollapsed(EDIT_LAYERS)).toBe(true);
  });

  it("leaves every other section starting open", () => {
    setCollapsed(EDIT_LAYERS, false);
    expect(isCollapsed("PSD")).toBe(false);
  });
});

/**
 * The three zone headings fold under the same store the sections do, which is
 * the only reason they persist at all — but they are not sections, and a
 * project whose PSD panel happens to carry a section called *Object* must not
 * close the OBJECT zone with it. One prefix is the whole of the separation.
 */
describe("a zone's fold", () => {
  it("is keyed apart from a section of the same name", () => {
    expect(zoneKey("OBJECT")).not.toBe(sectionName("OBJECT"));
    setCollapsed(zoneKey("OBJECT"), true);
    expect(isCollapsed("OBJECT")).toBe(false);
    expect(isCollapsed(zoneKey("OBJECT"))).toBe(true);
  });

  it("survives the panel, like a section's", () => {
    setCollapsed(zoneKey("TOOL"), true);
    resetCollapsedForTests();
    expect(isCollapsed(zoneKey("TOOL"))).toBe(true);
    expect(isCollapsed(zoneKey("LAYER"))).toBe(false);
  });
});
