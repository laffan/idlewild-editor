import { describe, expect, it } from "vitest";
import { manifestName, psdLayerOwner } from "../psd-layers";
import type { PsdLayerInfo } from "../../lib/ipc";

/**
 * `manifestName` decides whether renaming a PSD layer takes a placement with
 * it: a placement points at its layer by the name psd-to-json exported, and
 * that is the *second* pipe segment, not the whole thing. Kept in step with
 * `parse_layer_name` in psd-to-json-rust's parser.rs.
 */
describe("manifestName", () => {
  it("takes the name from the second segment", () => {
    expect(manifestName("S | tower")).toBe("tower");
    expect(manifestName("P | anchor")).toBe("anchor");
  });

  it("ignores the category, so a retyped prefix is not a rename", () => {
    expect(manifestName("T | tower")).toBe(manifestName("S | tower"));
  });

  it("reads the type and attribute segments psd-to-json also allows", () => {
    expect(manifestName("S | door | swing | depth:2")).toBe("door");
    expect(manifestName("Z | water | walkable:false")).toBe("water");
  });

  it("is null for a name the parser ignores", () => {
    // No pipe at all, more segments than the format has, and an empty name:
    // psd-to-json exports none of these, so there is no path to move.
    expect(manifestName("just a layer")).toBeNull();
    expect(manifestName("S | a | b | c | d")).toBeNull();
    expect(manifestName("S |   ")).toBeNull();
  });

  it("trims, because Photoshop names carry whatever spacing was typed", () => {
    expect(manifestName("S|tower")).toBe("tower");
    expect(manifestName("S  |  tower  ")).toBe("tower");
  });
});

/**
 * Some layers belong to the app rather than to whoever opens the file, and
 * their names are load-bearing: `P | anchor` is looked up by name on every
 * parse, and an extrusion's artwork layer is regenerated under the file's own
 * key each time the solid is applied again.
 */
describe("psdLayerOwner", () => {
  function layer(name: string, category: PsdLayerInfo["category"]): PsdLayerInfo {
    return {
      index: 0, name, category,
      visible: true, opacity: 255, width: 10, height: 10, x: 0, y: 0,
      isGroup: category === "group", depth: 0,
    };
  }
  const noop = () => {};
  const owner = (l: PsdLayerInfo, isExtrusion = true) =>
    psdLayerOwner(l, "extrude-abc", isExtrusion, noop);

  it("owns both orienting marks, on any file that carries them", () => {
    expect(owner(layer("P | anchor", "point"), false)?.reason).toContain("cannot be renamed");
    expect(owner(layer("Z | grid", "zone"), false)?.reason).toContain("cannot be renamed");
  });

  it("owns an extrusion's group, and offers the way back into the mode", () => {
    const held = owner(layer("G | extrude-abc", "group"));
    expect(held?.action?.label).toContain("Continue extruding");
  });

  it("owns every part inside it, without repeating the button", () => {
    for (const name of ["S | shape-abc", "S | shading-abc", "S | lines-abc"]) {
      const held = owner(layer(name, "sprite"));
      expect(held?.reason, name).toContain("cannot be renamed");
      expect(held?.action, name).toBeUndefined();
    }
  });

  it("leaves the same layers alone on a PSD that is not an extrusion", () => {
    expect(owner(layer("G | extrude-abc", "group"), false)).toBeNull();
    expect(owner(layer("S | shape-abc", "sprite"), false)).toBeNull();
  });

  it("leaves everything the author named alone", () => {
    expect(owner(layer("S | tower", "sprite"))).toBeNull();
    expect(owner(layer("T | ground", "tileset"))).toBeNull();
    // A point of their own is theirs: only the mark this editor writes is not.
    expect(owner(layer("P | spawn", "point"))).toBeNull();
  });

  it("reads the exported name rather than the whole label", () => {
    expect(owner(layer("P | anchor | note", "point"))?.reason).toBeTruthy();
  });
});
