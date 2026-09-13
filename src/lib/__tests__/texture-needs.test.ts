/**
 * Which textures a layer is waiting on, which is a question about its
 * *category* rather than about its name.
 *
 * This is the shape a backdrop painted in Photoshop came back in and was
 * never drawn from. A `T | Background` group becomes a **tileset**: its
 * textures are `Background_tile_<col>_<row>`, nothing is ever loaded under
 * the name `Background`, and the sprite layer the artist actually paints into
 * is a child of it that psd-to-phaser never loads as a sprite — its own
 * categoriser descends into a group and stops at a tileset.
 *
 * So asking the sprite question about a tileset answers no for ever, and
 * asking it about the tileset's child answers no about a file that is
 * perfectly well loaded. One was a backdrop that never appeared, the other a
 * warning on every backdrop this editor writes.
 *
 * The manifest below is a real one — see
 * `a_painted_backdrop_is_a_tileset_of_slices` in
 * `src-tauri/src/tests/backgrounds.rs`, which is what keeps it real.
 */

import { describe, expect, it } from "vitest";
import { textureNeeds } from "../manifest";

const BACKDROP = [
  { name: "anchor", category: "point", x: 0, y: 0, width: 12, height: 12 },
  { name: "grid-2x2", category: "zone", x: 0, y: 0, width: 64, height: 64 },
  {
    name: "Background",
    category: "tileset",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    columns: 2,
    rows: 1,
    filetype: "png",
    children: [
      {
        name: "background",
        category: "sprite",
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        filePath: "sprites/background.png",
      },
    ],
  },
];

const TOWN = [
  {
    name: "G | town",
    category: "group",
    children: [
      { name: "S | roof", category: "sprite", filePath: "sprites/roof.png" },
      { name: "S | wall", category: "sprite", filePath: "sprites/wall.png" },
    ],
  },
];

describe("what a manifest is waiting on", () => {
  it("wants a texture under a sprite's own name", () => {
    expect(textureNeeds(TOWN)).toEqual([
      { name: "S | roof", keys: ["S | roof"] },
      { name: "S | wall", keys: ["S | wall"] },
    ]);
  });

  it("wants one texture per slice of a tileset, and none under its name", () => {
    const tiles = textureNeeds(BACKDROP).find((n) => n.name === "Background");
    expect(tiles?.keys).toEqual(["Background_tile_0_0", "Background_tile_1_0"]);
    expect(tiles?.keys).not.toContain("Background");
  });

  /** The spurious warning, in one line. */
  it("wants nothing for a sprite inside a tileset", () => {
    expect(textureNeeds(BACKDROP).map((n) => n.name)).toEqual(["Background"]);
  });

  it("wants nothing for the marks, which carry no pixels", () => {
    const names = textureNeeds(BACKDROP).map((n) => n.name);
    expect(names).not.toContain("anchor");
    expect(names).not.toContain("grid-2x2");
  });

  /** A tileset with no counts is one slice, which is the plugin's own loop. */
  it("takes a tileset with no counts as a single slice", () => {
    const bare = [{ name: "Sky", category: "tileset" }];
    expect(textureNeeds(bare)).toEqual([
      { name: "Sky", keys: ["Sky_tile_0_0"] },
    ]);
  });
});

describe("what one layer of a manifest is waiting on", () => {
  it("answers for the layer the path names", () => {
    expect(textureNeeds(BACKDROP, "Background")).toEqual([
      { name: "Background", keys: ["Background_tile_0_0", "Background_tile_1_0"] },
    ]);
  });

  it("answers for a layer inside a group, addressed as place() addresses it", () => {
    expect(textureNeeds(TOWN, "G | town/S | roof")).toEqual([
      { name: "S | roof", keys: ["S | roof"] },
    ]);
  });

  /** A group is placed whole, so it is waiting on all of it. */
  it("answers for a whole group at once", () => {
    expect(textureNeeds(TOWN, "G | town").map((n) => n.name)).toEqual([
      "S | roof",
      "S | wall",
    ]);
  });

  /**
   * Empty means *no answer* rather than *nothing to wait for*, which is why
   * the caller falls back to the leaf name rather than reading it as ready.
   */
  it("says nothing about a path this manifest has never heard of", () => {
    expect(textureNeeds(TOWN, "G | town/S | nobody")).toEqual([]);
    expect(textureNeeds(TOWN, "elsewhere")).toEqual([]);
  });
});
