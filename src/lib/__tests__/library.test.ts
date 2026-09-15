/**
 * The library's rules, which are about *identity* rather than about geometry.
 *
 * Three of them are load-bearing and none is obvious from the type: editing a
 * built-in makes a copy in its place, removing a built-in only takes it out of
 * the palette, and a row that has left the palette is still drawable — because
 * a document names it by id and a project that used it must not go blank.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Library } from "../library/store";

/** A `localStorage` for a suite that runs in node. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

interface Row {
  id: string;
  name: string;
  value: number;
}

const DEFAULTS: readonly Row[] = [
  { id: "one", name: "One", value: 1 },
  { id: "two", name: "Two", value: 2 },
];

function make(): Library<Row> {
  return new Library<Row>({
    storageKey: "test.library",
    idPrefix: "row_",
    defaults: DEFAULTS,
  });
}

beforeEach(() => store.clear());

describe("a library", () => {
  it("starts as its defaults, in their own order", () => {
    expect(make().list().map((r) => r.id)).toEqual(["one", "two"]);
  });

  it("copies a built-in rather than editing it, and puts the copy in its place", () => {
    const library = make();
    const id = library.save("one", { name: "One, denser", value: 11 });

    expect(id).not.toBe("one");
    expect(library.list().map((r) => r.id)).toEqual([id, "two"]);
    // The built-in itself is untouched and still reachable.
    expect(library.get("one")).toEqual(DEFAULTS[0]);
    expect(library.get(id)).toEqual({ id, name: "One, denser", value: 11 });
  });

  it("writes a custom row through, keeping its id", () => {
    const library = make();
    const id = library.add({ name: "Mine", value: 7 });
    expect(library.save(id, { name: "Mine", value: 8 })).toBe(id);
    expect(library.get(id)?.value).toBe(8);
  });

  it("puts a duplicate beside the thing it is a copy of", () => {
    const library = make();
    const copy = library.duplicate("one");
    expect(library.list().map((r) => r.id)).toEqual(["one", copy, "two"]);
    expect(library.get(copy)?.name).toBe("One copy");
    expect(library.get(copy)?.value).toBe(1);
  });

  it("renames a built-in without touching its geometry", () => {
    const library = make();
    library.rename("one", "Ein");
    expect(library.get("one")).toEqual({ id: "one", name: "Ein", value: 1 });
  });

  /**
   * The one that matters for a document: a stroke naming a row that is no
   * longer offered still has a row to draw.
   */
  it("keeps a removed built-in reachable, and restores it", () => {
    const library = make();
    library.remove("one");
    expect(library.list().map((r) => r.id)).toEqual(["two"]);
    expect(library.get("one")).toEqual(DEFAULTS[0]);

    library.restoreDefaults();
    expect(library.list().map((r) => r.id)).toEqual(["one", "two"]);
  });

  it("removes a custom row for good", () => {
    const library = make();
    const id = library.add({ name: "Mine", value: 7 });
    library.remove(id);
    expect(library.get(id)).toBeNull();
  });

  it("keeps customs when the defaults are restored", () => {
    const library = make();
    const id = library.add({ name: "Mine", value: 7 });
    library.remove("two");
    library.restoreDefaults();
    expect(library.list().map((r) => r.id)).toEqual(["one", "two", id]);
  });

  it("reorders", () => {
    const library = make();
    library.reorder("two", 0);
    expect(library.list().map((r) => r.id)).toEqual(["two", "one"]);
  });

  it("comes back the same in the next session", () => {
    const first = make();
    const id = first.add({ name: "Mine", value: 7 });
    first.reorder(id, 0);
    first.select(id);

    const second = make();
    expect(second.list().map((r) => r.id)).toEqual([id, "one", "two"]);
    expect(second.selectedId).toBe(id);
    expect(second.get(id)?.value).toBe(7);
  });

  it("starts fresh rather than throwing on a stored value it cannot read", () => {
    store.set("test.library", "{ not json");
    expect(make().list().map((r) => r.id)).toEqual(["one", "two"]);
  });

  it("falls back to the first row when the selected one has gone", () => {
    const library = make();
    const id = library.add({ name: "Mine", value: 7 });
    library.select(id);
    library.remove(id);
    expect(library.selectedId).toBe("one");
  });

  it("says which rows are the binary's", () => {
    const library = make();
    expect(library.isDefault("one")).toBe(true);
    expect(library.isDefault(library.add({ name: "Mine", value: 7 }))).toBe(false);
  });
});
