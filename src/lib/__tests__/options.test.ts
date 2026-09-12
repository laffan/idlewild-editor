/**
 * What a project's options are when the project does not say.
 *
 * This is the migration path and nothing else: every `meta.json` written
 * before the options existed has no `options` at all, and what it has always
 * *been* is no pixel snapping, zoom 1, and a character — the scaffold wrote
 * one every time. A default that got any of those wrong would change how an
 * existing project renders the next time it was opened, which is the one thing
 * a new field must not do.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, projectOptions, type ProjectMeta } from "../types";

function meta(options?: ProjectMeta["options"]): ProjectMeta {
  return {
    id: "p1",
    name: "Marsh Kingdom",
    projection: "isometric",
    gridSize: 64,
    createdAt: 0,
    updatedAt: 0,
    layerCount: 1,
    ...(options ? { options } : {}),
  };
}

describe("a project's options", () => {
  it("are the defaults when the project was written before them", () => {
    expect(projectOptions(meta())).toEqual(DEFAULT_OPTIONS);
    expect(DEFAULT_OPTIONS).toEqual({
      pixelArt: false,
      roundPixels: false,
      defaultZoom: 1,
      character: true,
    });
  });

  it("are what the project says where it says anything", () => {
    const options = projectOptions(
      meta({
        pixelArt: true,
        roundPixels: true,
        defaultZoom: 3,
        character: false,
      }),
    );
    expect(options.pixelArt).toBe(true);
    expect(options.defaultZoom).toBe(3);
    expect(options.character).toBe(false);
  });

  it("fills in a field a half-written meta is missing", () => {
    // Rust writes the whole object, so this is a hand-edited file or an
    // archive from a build that had fewer of them. Either way the answer is
    // the field's default rather than undefined reaching a camera.
    const partial = { pixelArt: true } as ProjectMeta["options"];
    expect(projectOptions(meta(partial))).toEqual({
      ...DEFAULT_OPTIONS,
      pixelArt: true,
    });
  });

  it("does not hand back the shared default object", () => {
    const options = projectOptions(meta());
    options.defaultZoom = 4;
    expect(DEFAULT_OPTIONS.defaultZoom).toBe(1);
  });
});
