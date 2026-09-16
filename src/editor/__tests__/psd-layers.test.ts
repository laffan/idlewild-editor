import { describe, expect, it } from "vitest";
import { manifestName, psdLayerOwner } from "../psd-layer-owner";
import { groupLabel, layerLabel, paintable } from "../psd-layer-row";
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
      type: null, isGroup: category === "group", depth: 0,
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

/**
 * Which rows offer the pen.
 *
 * The case worth being firm about is an extrusion's own layers: they are
 * sprites, and Apply regenerates every one of them under the file's key — so
 * a drawing painted into one would look like it had worked right up until the
 * next time the solid behind it was pulled, and then be gone.
 */
describe("which rows PSD Edit mode can draw into", () => {
  function layer(
    name: string,
    category: PsdLayerInfo["category"],
  ): PsdLayerInfo {
    return {
      index: 0, name, category,
      visible: true, opacity: 255, width: 10, height: 10, x: 0, y: 0,
      type: null, isGroup: category === "group", depth: 0,
    };
  }
  const owner = (l: PsdLayerInfo, isExtrusion = true) =>
    psdLayerOwner(l, "extrude-abc", isExtrusion, () => {});

  it("offers it on an ordinary sprite", () => {
    const sprite = layer("S | tower", "sprite");
    expect(paintable(sprite, owner(sprite, false))).toBe(true);
  });

  it("keeps it off a tileset, a point and a zone", () => {
    for (const [name, category] of [
      ["T | ground", "tileset"],
      ["P | spawn", "point"],
      ["Z | water", "zone"],
      ["just a layer", "ignored"],
    ] as const) {
      const held = layer(name, category);
      expect(paintable(held, owner(held, false))).toBe(false);
    }
  });

  it("keeps it off a group, which is a folder rather than pixels", () => {
    const group = layer("G | enemies", "group");
    expect(paintable(group, owner(group, false))).toBe(false);
  });

  it("keeps it off the two marks and off an extrusion's own layers", () => {
    for (const name of [
      "P | anchor",
      "Z | grid",
      "G | extrude-abc",
      "S | shape-abc",
      "S | lines-abc",
      "S | shading-abc",
    ]) {
      const held = layer(name, name.startsWith("S") ? "sprite" : "group");
      expect(paintable(held, owner(held))).toBe(false);
    }
  });

  it("still offers it on a layer somebody added to an extruded file", () => {
    // The point of the rule being about ownership rather than about the file:
    // a layer painted over a greybox survives every Apply, so it is a layer
    // worth drawing in.
    const mine = layer("S | brickwork", "sprite");
    expect(paintable(mine, owner(mine))).toBe(true);
  });
});

/**
 * What a group row says it is.
 *
 * Not every group is a folder. `S | confetti | atlas |` is a group in
 * Photoshop and a single image to the game — psd-to-json composites what is
 * inside it into one PNG and the children survive only as frames of it. The
 * panel called all of them "group · N layers", which is the one thing about
 * such a file that is not true, and is what an author sees when they convert
 * a group to an atlas and nothing appears to have changed.
 */
describe("groupLabel", () => {
  function group(
    category: PsdLayerInfo["category"],
    type: string | null,
  ): PsdLayerInfo {
    return {
      index: 0, name: "confetti", category, type,
      visible: true, opacity: 255, width: 10, height: 10, x: 0, y: 0,
      isGroup: true, depth: 0,
    };
  }

  it("names a composited sprite by its type, and counts frames", () => {
    expect(groupLabel(group("sprite", "atlas"), 6)).toBe("atlas · 6 frames");
    expect(groupLabel(group("sprite", "spritesheet"), 4)).toBe(
      "spritesheet · 4 frames",
    );
    expect(groupLabel(group("sprite", "animation"), 3)).toBe(
      "animation · 3 frames",
    );
  });

  it("says a plain sprite group is merged, because it is", () => {
    expect(groupLabel(group("sprite", null), 2)).toBe("sprite · 2 layers merged");
    expect(groupLabel(group("tileset", null), 2)).toBe("tileset · 2 layers merged");
  });

  it("leaves a real group alone", () => {
    expect(groupLabel(group("group", null), 2)).toBe("group · 2 layers");
  });

  it("counts one of anything in the singular", () => {
    expect(groupLabel(group("sprite", "atlas"), 1)).toBe("atlas · 1 frame");
    expect(groupLabel(group("group", null), 1)).toBe("group · 1 layer");
  });

  /**
   * The type is matched as typed. psd-to-json copies the segment through and
   * psd-to-phaser compares it against "atlas" exactly, so `Atlas` is a group
   * that will not become an atlas — and a row that tidied the spelling would
   * promise something the export does not deliver.
   */
  it("does not claim an atlas for a spelling the pipeline will not match", () => {
    expect(groupLabel(group("sprite", "Atlas"), 6)).toBe(
      "sprite · 6 layers merged",
    );
  });
});

/**
 * The pen on a frame of a composited group.
 *
 * A child of `S | confetti | atlas |` is a sprite by its name and has no
 * artwork of its own anywhere downstream — psd-to-json folds it into the atlas
 * and exports no PNG, psd-to-phaser stops at the atlas and loads no texture.
 * The pen there opens PSD Edit mode over a picture that cannot be found.
 */
describe("paintable inside a composited group", () => {
  function row(
    name: string,
    category: PsdLayerInfo["category"],
    depth: number,
    type: string | null = null,
    isGroup = false,
  ): PsdLayerInfo {
    return {
      index: 0, name, category, type,
      visible: true, opacity: 255, width: 10, height: 10, x: 0, y: 0,
      isGroup, depth,
    };
  }

  const atlas = row("S | confetti | atlas |", "sprite", 0, "atlas", true);
  const tiles = row("T | ground", "tileset", 0, null, true);
  const folder = row("G | town", "group", 0, null, true);
  const frame = row("S | purple", "sprite", 1);

  it("declines a frame of an atlas", () => {
    expect(paintable(frame, null, atlas)).toBe(false);
  });

  it("declines a layer inside a tileset", () => {
    expect(paintable(frame, null, tiles)).toBe(false);
  });

  it("still offers a sprite inside a real group", () => {
    expect(paintable(frame, null, folder)).toBe(true);
  });

  it("still offers a sprite at the top level", () => {
    expect(paintable(row("S | hero", "sprite", 0), null, null)).toBe(true);
  });

  it("answers as before when nothing says what encloses it", () => {
    expect(paintable(row("S | hero", "sprite", 0), null)).toBe(true);
  });
});

/**
 * What a single layer's row says it is.
 *
 * The size, as it always did — and the type, which the line used to drop.
 * Dropping it mattered most where the type cannot work: `atlas`,
 * `spritesheet` and `animation` are each built out of a *group's* children,
 * so a lone layer wearing one of those names produces no atlas at all.
 * psd-to-json writes a plain sprite and a note nobody reads, and the author
 * is left with a layer called an atlas that is not one.
 */
describe("layerLabel", () => {
  function layer(
    category: PsdLayerInfo["category"],
    type: string | null,
  ): PsdLayerInfo {
    return {
      index: 0, name: "thing", category, type,
      visible: true, opacity: 255, width: 128, height: 160, x: 0, y: 0,
      isGroup: false, depth: 0,
    };
  }

  it("shows category and size, as it always did", () => {
    expect(layerLabel(layer("sprite", null))).toBe("sprite · 128 × 160");
    expect(layerLabel(layer("point", null))).toBe("point · 128 × 160");
    expect(layerLabel(layer("zone", null))).toBe("zone · 128 × 160");
    expect(layerLabel(layer("ignored", null))).toBe("ignored · 128 × 160");
  });

  it("says a composited type on a lone layer needs a group", () => {
    expect(layerLabel(layer("sprite", "atlas"))).toBe("atlas · needs a group");
    expect(layerLabel(layer("sprite", "spritesheet"))).toBe(
      "spritesheet · needs a group",
    );
    expect(layerLabel(layer("sprite", "animation"))).toBe(
      "animation · needs a group",
    );
  });

  it("shows a tile type, which a lone tileset layer can have", () => {
    expect(layerLabel(layer("tileset", "jpg"))).toBe("tileset · jpg · 128 × 160");
    expect(layerLabel(layer("tileset", null))).toBe("tileset · 128 × 160");
  });

  /** A spelling the pipeline will not match is not a type it should announce. */
  it("does not warn about a type the pipeline ignores anyway", () => {
    expect(layerLabel(layer("sprite", "Atlas"))).toBe("sprite · 128 × 160");
    expect(layerLabel(layer("sprite", "wobble"))).toBe("sprite · 128 × 160");
  });
});

/** A group carrying a tile type says so too. */
describe("groupLabel with a tile type", () => {
  it("keeps the category and adds the format", () => {
    expect(
      groupLabel(
        {
          index: 0, name: "ground", category: "tileset", type: "jpg",
          visible: true, opacity: 255, width: 10, height: 10, x: 0, y: 0,
          isGroup: true, depth: 0,
        },
        3,
      ),
    ).toBe("tileset · jpg · 3 layers merged");
  });
});
