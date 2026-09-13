/**
 * New Background, and the three things it can mean.
 *
 * A background layer has no canvas gesture of its own — a backdrop is
 * wherever the camera is, so there is nothing on screen to aim at — which is
 * why the button sits at the foot of the layer's own list in the left
 * sidebar. What it opens is a menu rather than a sheet, because two of the
 * three answers are one click and the third has a question of its own.
 *
 * **Colour** and **gradient** are records on the layer: camera-locked, no
 * extent, nothing to position. The inspector adjusts them.
 *
 * **Image** is not a record at all. It asks how many tiles the backdrop
 * should be, writes a PSD that size — anchor mark and `T | Background`
 * holding one sprite layer to paint into — and places it on the layer like
 * any other file. A picture painted in Photoshop is a thing of a certain size
 * standing in a certain place, which is what a placement already is, and the
 * exported game already loads, places, scales and stacks one. What makes it a
 * background is the layer it is on.
 */

import { h, ICONS } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { addBackground } from "../lib/layer-kinds";
import * as log from "../lib/log";
import { openMenu } from "../lib/menu";
import { openSheet } from "../lib/sheet";
import { psd } from "../lib/ipc";
import type { Background, Cell, Selection } from "../lib/types";
import { IMPORT_SCALE, marksForSelection } from "./import-anchor";
import type { WorldScene } from "../game/world-scene";

/**
 * The slice psd-to-json cuts a tileset into, which is what a *tile* means
 * here. Mirrors `ProcessOptions::default()` on the Rust side: a background
 * asked for in tiles has to be written in the same unit the runtime will load
 * it back in, or "thirty tiles wide" is thirty of something else.
 */
export const TILE_SLICE = 512;

/** What the sheet opens on, and the most it will take. */
const DEFAULT_TILES = { cols: 30, rows: 10 };
const MAX_TILES = 120;

export interface BackgroundDeps {
  projectId: string;
  store: DocStore;
  grid: Grid;
  scene: () => WorldScene | null;
  /** Follow what was just made, so the inspector is describing it. */
  onSelect: (selection: Selection) => void;
  /**
   * Make this the layer new work lands on.
   *
   * Called from inside the menu rather than before it opens, because
   * selecting a layer rebuilds the left panel — and the button the menu hangs
   * from is in it. A menu measures its anchor, and a detached element reports
   * a box of zeros, which is a menu in the corner of the app.
   */
  focusLayer: (layerId: string) => void;
}

/** The menu the New Background button opens. */
export function openNewBackground(
  anchor: HTMLElement,
  layerId: string,
  deps: BackgroundDeps,
): void {
  openMenu(anchor, [
    {
      label: "Colour",
      glyph: ICONS.fill,
      onSelect: () => make(deps, layerId, "color"),
    },
    {
      label: "Gradient",
      glyph: ICONS.gradient,
      onSelect: () => make(deps, layerId, "gradient"),
    },
    {
      label: "Image…",
      glyph: ICONS.file,
      onSelect: () => {
        deps.focusLayer(layerId);
        openBackgroundImage(deps);
      },
    },
  ]);
}

function make(
  deps: BackgroundDeps,
  layerId: string,
  kind: Background["kind"],
): void {
  deps.focusLayer(layerId);
  const made = addBackground(deps.store, layerId, kind);
  deps.onSelect({ kind: "background", layerId, backgroundId: made.id });
  log.info(`${made.name} added to ${deps.store.layer(layerId)?.name ?? "the layer"}`);
}

/**
 * How many tiles the backdrop should be, and then the file.
 *
 * The two numbers are the *document's* size, in the unit the runtime loads it
 * back in. Thirty by ten is a wide strip — a parallax band, a horizon — which
 * is what a tiled backdrop is for nine times in ten, and it is the default
 * for that reason rather than because it is a round number.
 */
export function openBackgroundImage(deps: BackgroundDeps): void {
  const sheet = openSheet({
    title: "New image background",
    subtitle: "How big is the backdrop, in tiles?",
    width: 460,
  });

  const cols = tileField("Across", DEFAULT_TILES.cols);
  const rows = tileField("Down", DEFAULT_TILES.rows);
  const size = h("div", { class: "field-hint" });
  const update = () => {
    size.textContent =
      `${value(cols) * TILE_SLICE} × ${value(rows) * TILE_SLICE} pixels — ` +
      `one tile is ${TILE_SLICE}px, the slice the runtime loads.`;
  };
  cols.addEventListener("input", update);
  rows.addEventListener("input", update);
  update();

  sheet.body.append(
    h("div", { class: "sheet-row control" },
      h("div", { class: "sheet-row-key m", text: "Tiles" }),
      h("div", { class: "sheet-row-value tile-pair" }, cols, h("span", { text: "×" }), rows),
    ),
    size,
    h("div", {
      class: "field-hint",
      text:
        "The file arrives empty, with an anchor and a T | Background group " +
        "holding one sprite layer. Open PSD to paint it.",
    }),
  );

  sheet.actions.append(
    h("button", {
      class: "btn btn-primary",
      text: "Create",
      onClick: () => {
        sheet.close();
        void writeBackground(deps, value(cols), value(rows));
      },
    }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}

function tileField(label: string, initial: number): HTMLInputElement {
  const input = h("input", {
    class: "input tile-field",
    type: "number",
    min: "1",
    max: String(MAX_TILES),
    step: "1",
    "aria-label": label,
  }) as HTMLInputElement;
  input.value = String(initial);
  return input;
}

function value(input: HTMLInputElement): number {
  const n = Math.round(Number(input.value));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_TILES, n));
}

/**
 * Write the file and put it down.
 *
 * Anchored on the origin space with its **top-left** on it, rather than
 * centred the way an imported image is: a backdrop has an opinion about where
 * it begins and none about where its middle is, and a strip thirty tiles wide
 * centred on the origin would start fifteen tiles off the left of everything
 * anybody has built. It lands at `IMPORT_SCALE` like every other PSD that
 * enters this editor, because a backdrop is painted at retina like everything
 * else.
 */
async function writeBackground(
  deps: BackgroundDeps,
  cols: number,
  rows: number,
): Promise<void> {
  const scene = deps.scene();
  if (!scene) return;
  const at: Cell = { cx: 0, cy: 0 };

  try {
    const result = await psd.background(
      deps.projectId,
      `background-${Date.now().toString(36)}`,
      cols,
      rows,
      TILE_SLICE,
      {
        ...marksForSelection(deps.grid, at, at),
        // The artwork starts at the anchor rather than around it.
        art: { x: 0, y: 0 },
      },
    );
    // It lands on the active layer, which the panel made this one on the way
    // into the menu — the same rule Fill and Add Image follow.
    await scene.placePsd(result.key, result.manifest, at, IMPORT_SCALE);
    log.info(
      `${result.key}.psd — ${cols} × ${rows} tiles (${result.width}×${result.height}) ` +
        "— Open PSD to paint it",
    );
  } catch (err) {
    log.error("Could not make that background:", err);
  }
}
