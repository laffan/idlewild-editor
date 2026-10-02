import { describe, expect, it } from "vitest";
import {
  currentPage,
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
  kind: "print",
  dpi,
  paper,
  landscape,
  formats: "pdf",
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
    expect(describePage(print(300))).toBe("Letter — 8.5 × 11 in");
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

describe("what Export writes", () => {
  it("is a PDF, a PSD or both, and a PDF for anything else", () => {
    expect(writes({ ...print(300), formats: "pdf" })).toEqual({ pdf: true, psd: false });
    expect(writes({ ...print(300), formats: "psd" })).toEqual({ pdf: false, psd: true });
    expect(writes({ ...print(300), formats: "both" })).toEqual({ pdf: true, psd: true });
    expect(
      writes({ ...print(300), formats: "tiff" as unknown as Output["formats"] }),
    ).toEqual({ pdf: true, psd: false });
    // A project made before the choice existed writes what it always did.
    expect(writes(projectOutput(meta({ ...print(300) } as Output)))).toEqual({
      pdf: true,
      psd: false,
    });
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
    expect(currentPage()).toEqual({ width: 595, height: 842 });
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
