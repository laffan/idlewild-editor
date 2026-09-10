import { describe, expect, it } from "vitest";
import { manifestName } from "../psd-layers";

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
