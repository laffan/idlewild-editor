import { describe, expect, it } from "vitest";
import { carryGridAlign, gridAlignOf, rememberGridAlign } from "../psd-grid-align";
import { Grid } from "../../lib/grid";
import { gridAlignFor } from "../../lib/grid-align";
import { setOpenProject } from "../../lib/print";
import type { ProjectMeta } from "../../lib/types";

const meta = (): ProjectMeta => ({
  id: "p",
  name: "P",
  projection: "isometric",
  genre: "p2p",
  gridSize: 32,
  createdAt: 0,
  updatedAt: 0,
  layerCount: 1,
});

describe("psd grid alignment", () => {
  it("has a plane on an isometric grid only", () => {
    const iso = gridAlignFor(new Grid("isometric", 32), { runs: "cx", upright: false });
    expect(iso).not.toBeNull();
    expect(iso!.runs).toBe("cx");
    expect(Math.hypot(iso!.ax, iso!.ay)).toBeCloseTo(1);
    expect(gridAlignFor(new Grid("orthogonal", 32), { runs: "cx", upright: false })).toBeNull();
    // Upright: the file's columns run straight down the screen.
    const standing = gridAlignFor(new Grid("isometric", 32), { runs: "cy", upright: true })!;
    expect(standing.bx).toBeCloseTo(0);
    expect(standing.by).toBeCloseTo(1);
  });

  it("keeps the open project's settings, and carries them with a file", () => {
    setOpenProject(meta());
    const align = gridAlignFor(new Grid("isometric", 32), { runs: "cx", upright: false })!;
    expect(gridAlignOf("tower")).toBeNull();
    rememberGridAlign("tower", align);
    carryGridAlign("tower", "tower-copy", false);
    carryGridAlign("tower", "keep", true);
    expect(gridAlignOf("tower")).toBeNull();
    expect(gridAlignOf("tower-copy")).toEqual(align);
    expect(gridAlignOf("keep")).toEqual(align);
    setOpenProject(null);
  });
});
