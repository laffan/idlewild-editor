/**
 * What a project is *for* — a game or a printed page — and the arithmetic a
 * printed page needs.
 *
 * Mirrors `src-tauri/src/print.rs`, which carries the argument; the short
 * version is that a print project's PSDs are written at its DPI and every one
 * is processed twice, once at full resolution into `print/` for the PDF and
 * once downsampled into `assets/` at the two pixels to the world pixel every
 * other project's files have. Everything on screen reads `assets/`, so the
 * canvas and the project's own code never see the big files at all.
 *
 * One world pixel is one PostScript point, and the page's top-left corner is
 * the world's origin.
 */

import type { ProjectMeta } from "./project-types";

export type OutputKind = "code" | "print";

/** The resolutions offered. */
export const DPIS = [300, 600] as const;
export type Dpi = (typeof DPIS)[number];

/**
 * What a page is written as: a PDF, the same page as a layered PSD at the
 * project's DPI, or the page as one picture at that DPI — a PNG, or a JPG on
 * white. See `print_pdf.rs`, `print_psd.rs` and `print_png.rs`.
 */
export type PrintFormat = "pdf" | "psd" | "png" | "jpg";
/** The name the project's default goes by — one format. */
export type PrintFormats = PrintFormat;

export const FORMATS: ReadonlyArray<{ value: PrintFormat; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "psd", label: "PSD" },
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
];

/** The units a custom size is typed in. Only how it reads — sizes are points. */
export type PageUnit = "in" | "cm";

/** Mirrored by `Output` in src-tauri/src/print.rs. */
export interface Output {
  kind: OutputKind;
  dpi: number;
  /** One of `PAPERS`' ids, or `custom`. */
  paper: string;
  landscape: boolean;
  /** What a page is written as when the code does not say. */
  formats: PrintFormat;
  /** A custom sheet's size, in points. */
  customWidth: number;
  customHeight: number;
  unit: PageUnit;
  /** The page's top-left corner in the world. */
  x: number;
  y: number;
}

export const DEFAULT_OUTPUT: Output = {
  kind: "code",
  dpi: 300,
  paper: "letter",
  landscape: false,
  formats: "png",
  customWidth: 612,
  customHeight: 792,
  unit: "in",
  x: 0,
  y: 0,
};

/** The paper id for a size somebody typed. */
export const CUSTOM = "custom";

/** Half an inch to four feet, in points — matching `MIN_PAGE`/`MAX_PAGE`. */
export const PAGE_RANGE = { min: 36, max: 3456 } as const;

/**
 * What a page is written as: the formats the call named, or the project's
 * default. Anything else — an earlier build's `both` — reads as a PNG.
 */
export function writes(output: Output, asked?: PrintFormat[]): PrintFormat[] {
  const known = (f: unknown): f is PrintFormat => FORMATS.some((row) => row.value === f);
  const list = (asked ?? []).filter(known);
  if (list.length > 0) return [...new Set(list)];
  return [known(output.formats) ? output.formats : "png"];
}

/** A sheet, portrait, in points. Mirrored by `PAPERS` in print.rs. */
export interface Paper {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PAPERS: ReadonlyArray<Paper> = [
  { id: "letter", label: "Letter", width: 612, height: 792 },
  { id: "legal", label: "Legal", width: 612, height: 1008 },
  { id: "tabloid", label: "Tabloid", width: 792, height: 1224 },
  { id: "a5", label: "A5", width: 420, height: 595 },
  { id: "a4", label: "A4", width: 595, height: 842 },
  { id: "a3", label: "A3", width: 842, height: 1191 },
  { id: "a2", label: "A2", width: 1191, height: 1684 },
];

/** A project's output, filled in. Absent means a game. */
export function projectOutput(meta: ProjectMeta): Output {
  return { ...DEFAULT_OUTPUT, ...(meta.output ?? {}) };
}

export function isPrint(meta: ProjectMeta): boolean {
  return projectOutput(meta).kind === "print";
}

/** The DPI, on one of the two this app writes. */
export function dpiOf(output: Output): Dpi {
  return output.dpi >= 450 ? 600 : 300;
}

export function paperOf(output: Output): Paper {
  return PAPERS.find((p) => p.id === output.paper) ?? PAPERS[0];
}

export function isCustom(output: Output): boolean {
  return output.paper === CUSTOM;
}

/**
 * The sheet in points: a standard one turned for landscape, or the size that
 * was typed, which is already the way round it was typed.
 */
export function pageSize(output: Output): { width: number; height: number } {
  if (isCustom(output)) {
    const clamp = (v: number) =>
      Math.round(Math.min(PAGE_RANGE.max, Math.max(PAGE_RANGE.min, v || 612)));
    return { width: clamp(output.customWidth), height: clamp(output.customHeight) };
  }
  const paper = paperOf(output);
  return output.landscape
    ? { width: paper.height, height: paper.width }
    : { width: paper.width, height: paper.height };
}

/** Points in one of a unit. */
export function pointsPer(unit: PageUnit): number {
  return unit === "cm" ? 72 / 2.54 : 72;
}

/** A length in points, in a unit, to two places at most. */
export function inUnit(points: number, unit: PageUnit): number {
  return Math.round((points / pointsPer(unit)) * 100) / 100;
}

/**
 * What the sheet is called, the way a printer would say it: the paper's name
 * and its size — `Letter · 8.5 × 11 in` — or, for a typed size, the size in
 * the unit it was typed in: `Custom · 30 × 20 cm`.
 */
export function describePage(output: Output): string {
  // A typed size is said as typed — 30 cm, not the 29.99 that whole points
  // would round it back to.
  const typed = (v: number) => Math.min(PAGE_RANGE.max, Math.max(PAGE_RANGE.min, v || 612));
  const { width, height } = isCustom(output)
    ? { width: typed(output.customWidth), height: typed(output.customHeight) }
    : pageSize(output);
  const unit: PageUnit = isCustom(output) ? output.unit : "in";
  const name = isCustom(output) ? "Custom" : paperOf(output).label;
  return `${name} · ${inUnit(width, unit)} × ${inUnit(height, unit)} ${unit}`;
}

/**
 * The project's source scale: pixels in a PSD this editor writes, per world
 * pixel.
 *
 * Every conversion — a fill, a sketch, a merge, an extrusion — draws its own
 * pixels at this and is placed at `IMPORT_SCALE` against the processed
 * manifest. On a game that is `EXPORT_SCALE`, two, and the file and the
 * manifest are the same file. On a print project it is the DPI over 72, and
 * the manifest is the downsampled copy — at two, again — so the placement is
 * the same either way and only the PSD is bigger.
 *
 * Set once per open project, because a conversion is a dozen call sites deep
 * in files that otherwise never see the project's meta, and this is a
 * one-project-at-a-time app — see "One game at a time" in the technical docs.
 */
let sourceScaleNow = 2;
let openMeta: ProjectMeta | null = null;
const pageListeners = new Set<() => void>();

/**
 * Tell the editor which project is open: its source scale, and — on a print
 * project — the sheet, which the screen guide draws on the canvas and the
 * Output section runs on. Called again whenever the sheet changes, and every
 * call tells whoever is listening — see `onPageChange`.
 */
export function setOpenProject(meta: ProjectMeta | null): void {
  openMeta = meta;
  const output = meta ? projectOutput(meta) : DEFAULT_OUTPUT;
  sourceScaleNow = output.kind === "print" ? dpiOf(output) / 72 : 2;
  for (const listener of pageListeners) listener();
}

export function sourceScale(): number {
  return sourceScaleNow;
}

/** The open project, while one is open — what a page change is written to. */
export function openProject(): ProjectMeta | null {
  return openMeta;
}

/** The open print project's sheet, or null for a game. */
export function currentOutput(): Output | null {
  if (!openMeta || !isPrint(openMeta)) return null;
  return projectOutput(openMeta);
}

/**
 * The open print project's page in the world: its corner and its size in
 * points. Null for a game.
 */
export function currentPage(): { x: number; y: number; width: number; height: number } | null {
  const output = currentOutput();
  if (!output) return null;
  return { x: output.x || 0, y: output.y || 0, ...pageSize(output) };
}

/**
 * Be told when the sheet changes — a paper picked in Page Setup, the frame
 * dragged on the canvas. Returns the way to stop being told.
 */
export function onPageChange(listener: () => void): () => void {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
}
