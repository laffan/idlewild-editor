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
 * What Export writes: the page as a PDF, the same page as a layered PSD at the
 * project's DPI, or both. See `print_psd.rs` for what the PSD is.
 */
export type PrintFormats = "pdf" | "psd" | "both";

export const FORMATS: ReadonlyArray<{ value: PrintFormats; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "psd", label: "PSD" },
  { value: "both", label: "PDF + PSD" },
];

/** Mirrored by `Output` in src-tauri/src/print.rs. */
export interface Output {
  kind: OutputKind;
  dpi: number;
  /** One of `PAPERS`' ids. */
  paper: string;
  landscape: boolean;
  formats: PrintFormats;
}

export const DEFAULT_OUTPUT: Output = {
  kind: "code",
  dpi: 300,
  paper: "letter",
  landscape: false,
  formats: "pdf",
};

/** Whether Export writes a PDF, and whether it writes a PSD. */
export function writes(output: Output): { pdf: boolean; psd: boolean } {
  const formats = FORMATS.some((f) => f.value === output.formats)
    ? output.formats
    : "pdf";
  return { pdf: formats !== "psd", psd: formats !== "pdf" };
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

/** The sheet in points, turned for landscape. */
export function pageSize(output: Output): { width: number; height: number } {
  const paper = paperOf(output);
  return output.landscape
    ? { width: paper.height, height: paper.width }
    : { width: paper.width, height: paper.height };
}

/** Inches, for saying a sheet's size the way a printer would. */
export function describePage(output: Output): string {
  const { width, height } = pageSize(output);
  const inches = (pt: number) => Math.round((pt / 72) * 100) / 100;
  return `${paperOf(output).label} — ${inches(width)} × ${inches(height)} in`;
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
let pageNow: { width: number; height: number } | null = null;

/**
 * Tell the editor which project is open: its source scale, and — on a print
 * project — the sheet, which the screen guide draws on the canvas. Page Setup
 * calls it again when the paper changes.
 */
export function setOpenProject(meta: ProjectMeta | null): void {
  const output = meta ? projectOutput(meta) : DEFAULT_OUTPUT;
  const print = output.kind === "print";
  sourceScaleNow = print ? dpiOf(output) / 72 : 2;
  pageNow = print ? pageSize(output) : null;
}

export function sourceScale(): number {
  return sourceScaleNow;
}

/** The open print project's sheet in points, or null for a game. */
export function currentPage(): { width: number; height: number } | null {
  return pageNow;
}
