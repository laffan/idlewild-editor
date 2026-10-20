/**
 * Grid Alignment for a placed PSD, in the inspector's PSD section: the same
 * controls a note has — Align to the grid, which diagonal, Upright — and
 * Rasterize Grid Alignment.
 *
 * **The PSD is not changed.** The setting is the file's, kept by key in the
 * project (`ProjectMeta.gridAlign`), and every time the pipeline parses the
 * file it parses a slanted copy instead (`psd_grid_align.rs`). So the canvas,
 * Play, a publish and a print export all show it slanted, an edit to the file
 * comes back slanted, and turning it off puts the artwork back flat. Because
 * it is the file's, every placement of the file is slanted together; Make
 * Unique first for one that should differ.
 *
 * **Rasterize** writes the slanted copy over the file itself and drops the
 * setting — after asking (`confirmRasterize`), because the flat original is then gone.
 *
 * Only on an isometric project, as a note's switch is: on an orthogonal or
 * blank one the grid's plane is the screen, and a switch that does nothing
 * says the feature is broken rather than inapplicable.
 */

import { h } from "../lib/dom";
import type { Grid } from "../lib/grid";
import { gridAlignFor, type GridAlign } from "../lib/grid-align";
import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import { optionSegmented, optionSwitch } from "../lib/options-controls";
import { openProject } from "../lib/print";
import { confirmSheet } from "../lib/sheet";

/** A file's alignment, or null for one drawn flat. */
export function gridAlignOf(key: string): GridAlign | null {
  return openProject()?.gridAlign?.[key] ?? null;
}

/** The editor's copy of the meta, brought level with what was written. */
export function rememberGridAlign(key: string, align: GridAlign | null): void {
  const meta = openProject();
  if (!meta) return;
  const next = { ...(meta.gridAlign ?? {}) };
  if (align) next[key] = align;
  else delete next[key];
  meta.gridAlign = next;
}

/** A file renamed or copied takes its alignment with it — `carry` in Rust. */
export function carryGridAlign(from: string, to: string, moved: boolean): void {
  const align = gridAlignOf(from);
  if (!align) return;
  rememberGridAlign(to, align);
  if (moved) rememberGridAlign(from, null);
}

export interface GridAlignDeps {
  projectId: string;
  grid: Grid;
  /** The new manifest is in: re-place the file's layers against it. */
  applyManifest: (key: string, manifest: string) => Promise<void>;
}

/** Lay the file into the grid — or flat again, with null. */
export async function changeGridAlign(
  deps: GridAlignDeps,
  key: string,
  how: { runs: "cx" | "cy"; upright: boolean } | null,
): Promise<void> {
  const align = how ? gridAlignFor(deps.grid, how) : null;
  if (how && !align) return;
  try {
    const manifest = await psd.setGridAlign(deps.projectId, key, align);
    rememberGridAlign(key, align);
    await deps.applyManifest(key, manifest);
    log.info(align ? `${key}.psd — laid into the grid` : `${key}.psd — flat again`);
  } catch (err) {
    log.error(`Could not align ${key}.psd to the grid:`, err);
  }
}

/** Ask before the flat original is gone — before the rows go busy. */
export function confirmRasterize(key: string): Promise<boolean> {
  return confirmSheet(
    `Rasterize grid alignment in ${key}.psd?`,
    "The PSD itself is rewritten slanted, and the flat original is gone. Its " +
      "layers and their names stay as they are.",
    "Rasterize",
  );
}

/** Write the slant into the file itself. */
export async function rasterizeGridAlign(deps: GridAlignDeps, key: string): Promise<void> {
  try {
    const manifest = await psd.rasterizeGridAlign(deps.projectId, key);
    rememberGridAlign(key, null);
    await deps.applyManifest(key, manifest);
    log.info(`${key}.psd — grid alignment rasterized into the file`);
  } catch (err) {
    log.error(`Could not rasterize ${key}.psd's grid alignment:`, err);
  }
}

/**
 * The section's rows: the switch, then — only while it is on — the diagonal,
 * Upright and Rasterize. The same shape as a note's, for the same reasons.
 */
export function gridAlignRows(
  key: string,
  busy: boolean,
  onChange: (how: { runs: "cx" | "cy"; upright: boolean } | null) => void,
  onRasterize: () => void,
): HTMLElement {
  const align = gridAlignOf(key);
  const runs = align?.runs ?? "cx";
  const upright = align?.upright ?? false;
  const toggle = optionSwitch(!!align, (on) => onChange(on ? { runs, upright } : null), "Align to the grid");
  if (busy) (toggle.root as HTMLButtonElement).disabled = true;
  const rows: HTMLElement[] = [
    h(
      "div",
      {
        class: "inspect-row",
        title:
          "The artwork is laid along the grid's own two axes, so it reads as part " +
          "of the world rather than facing the viewer. The PSD itself is not changed.",
      },
      h("span", { class: "inspect-key m", text: busy ? "Slanting the artwork…" : "Align to the grid" }),
      toggle.root,
    ),
  ];
  if (align) {
    const diagonal = optionSegmented(
      [
        { value: "cx", label: "NW→SE" },
        { value: "cy", label: "SW→NE" },
      ],
      runs,
      (next) => onChange({ runs: next === "cy" ? "cy" : "cx", upright }),
    );
    diagonal.root.title = "Which of the grid's two diagonals the artwork's rows follow.";
    rows.push(
      h(
        "div",
        { class: "inspect-bar" },
        diagonal.root,
        h("button", {
          class: "panel-btn",
          text: "Upright",
          disabled: busy,
          "aria-pressed": String(upright),
          title:
            "Lying down, the artwork is painted on the floor. Upright, its columns " +
            "run straight down the screen, the way a sign on the face of a wall does.",
          onClick: () => onChange({ runs, upright: !upright }),
        }),
      ),
      h("button", {
        class: "panel-btn",
        text: "Rasterize Grid Alignment",
        disabled: busy,
        title: "Write the slant into the PSD itself, rather than into its processed copy",
        onClick: onRasterize,
      }),
    );
  }
  return h(
    "div",
    { class: "psd-grid-align" },
    h("div", { class: "psd-grid-align-name", text: "Grid Alignment" }),
    h("div", { class: "inspect-stack" }, ...rows),
  );
}
