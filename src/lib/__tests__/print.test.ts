import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT,
  currentPage,
  inUnit,
  onPageChange,
  describePage,
  dpiOf,
  isPrint,
  pageSize,
  PAPERS,
  projectOutput,
  setOpenProject,
  sourceScale,
  writes,
  type Output,
} from "../print";
import { EXPORT_SCALE, IMPORT_SCALE } from "../../editor/import-anchor";
import type { ProjectMeta } from "../types";

const meta = (output?: Output): ProjectMeta => ({
  id: "p",
  name: "Page",
  projection: "blank",
  genre: "p2p",
  gridSize: 64,
  createdAt: 0,
  updatedAt: 0,
  layerCount: 1,
  ...(output ? { output } : {}),
});

const print = (dpi: number, paper = "letter", landscape = false): Output => ({
  ...DEFAULT_OUTPUT,
  kind: "print",
  dpi,
  paper,
  landscape,
});

describe("a project's output", () => {
  it("is a game when the meta says nothing", () => {
    expect(isPrint(meta())).toBe(false);
    expect(projectOutput(meta()).kind).toBe("code");
  });

  it("brings the DPI onto one of the two this app writes", () => {
    expect(dpiOf(print(300))).toBe(300);
    expect(dpiOf(print(600))).toBe(600);
    expect(dpiOf(print(72))).toBe(300);
    expect(dpiOf(print(1200))).toBe(600);
  });

  it("turns the sheet for landscape, and falls back to Letter", () => {
    expect(pageSize(print(300, "a4"))).toEqual({ width: 595, height: 842 });
    expect(pageSize(print(300, "a4", true))).toEqual({ width: 842, height: 595 });
    expect(pageSize(print(300, "napkin"))).toEqual({ width: 612, height: 792 });
    expect(describePage(print(300))).toBe("Letter · 8.5 × 11 in");
  });

  it("matches the papers Rust knows, which are the ones on the sheet", () => {
    expect(PAPERS.map((p) => p.id)).toEqual([
      "letter",
      "legal",
      "tabloid",
      "a5",
      "a4",
      "a3",
      "a2",
    ]);
  });
});

describe("a custom sheet", () => {
  it("is the size typed, in the unit it was typed in, whatever the orientation", () => {
    const custom: Output = {
      ...print(300, "custom", true),
      customWidth: (30 / 2.54) * 72,
      customHeight: (20 / 2.54) * 72,
      unit: "cm",
    };
    expect(pageSize(custom)).toEqual({ width: 850, height: 567 });
    expect(describePage(custom)).toBe("Custom · 30 × 20 cm");
    expect(inUnit(612, "in")).toBe(8.5);
  });

  it("is kept between half an inch and four feet", () => {
    const tiny: Output = { ...print(300, "custom"), customWidth: 1, customHeight: 99999 };
    expect(pageSize(tiny)).toEqual({ width: 36, height: 3456 });
  });
});

describe("what a page is written as", () => {
  it("is what the call asked for, or the project's one format", () => {
    expect(writes({ ...print(300), formats: "png" })).toEqual(["png"]);
    expect(writes(print(300), ["pdf", "png", "pdf"])).toEqual(["pdf", "png"]);
    expect(writes({ ...print(300), formats: "jpg" })).toEqual(["jpg"]);
    // An earlier build's `both`, or anything else, is the default: a PNG.
    expect(
      writes({ ...print(300), formats: "both" as unknown as Output["formats"] }),
    ).toEqual(["png"]);
  });
});

describe("the open sheet", () => {
  it("is where the page is in the world, and says when it changes", () => {
    let heard = 0;
    const stop = onPageChange(() => (heard += 1));
    setOpenProject(meta({ ...print(300, "a4"), x: 120, y: -40 }));
    expect(currentPage()).toEqual({ x: 120, y: -40, width: 595, height: 842 });
    setOpenProject(null);
    expect(currentPage()).toBeNull();
    stop();
    setOpenProject(null);
    expect(heard).toBe(2);
  });
});

describe("the source scale", () => {
  it("is EXPORT_SCALE on a game, so nothing about a game changed", () => {
    setOpenProject(meta());
    expect(sourceScale()).toBe(EXPORT_SCALE);
    expect(currentPage()).toBeNull();
  });

  it("is the DPI over 72 on a print project, and the sheet is known", () => {
    setOpenProject(meta(print(600, "a4")));
    expect(sourceScale()).toBeCloseTo(600 / 72);
    expect(currentPage()).toEqual({ x: 0, y: 0, width: 595, height: 842 });
    setOpenProject(null);
    expect(sourceScale()).toBe(EXPORT_SCALE);
  });

  /**
   * The invariant a print project leans on: a file drawn at the source scale,
   * downsampled to screen resolution and placed at `IMPORT_SCALE`, lands at
   * exactly the world size it was drawn at.
   */
  it("round-trips through the downsampled copy at IMPORT_SCALE", () => {
    for (const dpi of [300, 600]) {
      setOpenProject(meta(print(dpi)));
      const world = 123;
      const filePixels = world * sourceScale();
      const screenPixels = filePixels / (sourceScale() / EXPORT_SCALE);
      expect(screenPixels * IMPORT_SCALE).toBeCloseTo(world);
    }
    setOpenProject(null);
  });
});
