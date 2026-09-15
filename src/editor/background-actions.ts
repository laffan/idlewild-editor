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
 * **Image** is not a record at all. It asks how much ground the backdrop
 * covers, writes a PSD that size — anchor mark and `T | Background`
 * holding one sprite layer to paint into — and places it on the layer like
 * any other file. A picture painted in Photoshop is a thing of a certain size
 * standing in a certain place, which is what a placement already is, and the
 * exported game already loads, places, scales and stacks one. What makes it a
 * background is the layer it is on.
 *
 * A **tile** here is a space of this project's grid, which is the only unit
 * anybody using this editor has been counting in. It was psd-to-json's 512px
 * slice, which is a number about how a tileset is cut up for the runtime to
 * load and says nothing about how much ground a backdrop covers: "thirty
 * tiles wide" came out fifteen thousand pixels across on a thirty-two pixel
 * grid, four hundred and eighty spaces of ground for a strip somebody wanted
 * thirty. The slice is still 512 and still psd-to-json's business; it is
 * simply not the question the sheet is asking.
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
import {
  EXPORT_SCALE,
  IMPORT_SCALE,
  marksForSelection,
  scaleMarks,
} from "./import-anchor";
import { openPsdProgress } from "./psd-progress";
import type { WorldScene } from "../game/world-scene";

/** What the sheet opens on, and the most it will take. */
const DEFAULT_SPACES = { cols: 30, rows: 10 };
const MAX_SPACES = 120;

/**
 * A ceiling on the file, in its own pixels.
 *
 * A backdrop is one raster the size of the whole backdrop, and the buffer for
 * it exists before the file does. Rust refuses past this too — see
 * `MAX_BACKGROUND_PIXELS` — but a refusal after the wait is a wait for
 * nothing, and the count is on screen while somebody types it, so the sheet
 * says so first and the two numbers are deliberately the same.
 */
const MAX_BACKDROP_PIXELS = 160_000_000;

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
 * How much ground the backdrop covers, and then the file.
 *
 * The two numbers are grid spaces — the unit everything else in this editor
 * is counted in. Thirty by ten is a wide strip: a parallax band, a horizon,
 * which is what a tiled backdrop is for nine times in ten.
 *
 * What that comes to in pixels depends on the project, so the sheet works it
 * out as the numbers are typed rather than naming a figure that would be
 * wrong on any grid but one. It is also where the ceiling is enforced: a
 * backdrop too big to hold is a disabled button and a sentence, not a wait
 * that ends in a refusal.
 */
export function openBackgroundImage(deps: BackgroundDeps): void {
  const sheet = openSheet({
    title: "New image background",
    subtitle: "How much ground does the backdrop cover?",
    width: 460,
  });

  const cols = spaceField("Across", DEFAULT_SPACES.cols);
  const rows = spaceField("Down", DEFAULT_SPACES.rows);
  const size = h("div", { class: "field-hint" });
  const create = h("button", {
    class: "btn btn-primary",
    text: "Create",
    onClick: () => {
      sheet.close();
      void writeBackground(deps, value(cols), value(rows));
    },
  }) as HTMLButtonElement;

  const update = () => {
    const across = value(cols);
    const down = value(rows);
    const file = backdropSize(deps.grid, across, down);
    const tooBig = file.width * file.height > MAX_BACKDROP_PIXELS;
    create.disabled = tooBig;
    size.textContent = tooBig
      ? `${file.width} × ${file.height} pixels — past the ` +
        `${MAX_BACKDROP_PIXELS / 1_000_000} megapixel limit. Ask for fewer spaces.`
      : `${file.width} × ${file.height} pixels, at twice the size it is shown ` +
        "at — the resolution everything else in the project is painted at.";
  };
  cols.addEventListener("input", update);
  rows.addEventListener("input", update);
  update();

  sheet.body.append(
    h("div", { class: "sheet-row control" },
      h("div", { class: "sheet-row-key m", text: "Spaces" }),
      h("div", { class: "sheet-row-value tile-pair" }, cols, h("span", { text: "×" }), rows),
    ),
    size,
    h("div", {
      class: "field-hint",
      text:
        "The file arrives empty, with an anchor, the grid drawn on it and a " +
        "T | Background group holding one sprite layer. Open PSD to paint it.",
    }),
  );

  sheet.actions.append(
    create,
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}

/**
 * The ground a backdrop of this many spaces covers, and the file that holds it.
 *
 * The same arithmetic `generatePsdForRegion` does for a marquee, which is the
 * point: a backdrop is a blank PSD over a range of spaces, anchored on the
 * origin, and the only thing that makes it a backdrop is the layer it lands
 * on. Written at `EXPORT_SCALE` and placed at `IMPORT_SCALE`, so the world
 * geometry is exactly the spaces asked for and the file has twice the pixels.
 */
function backdropSize(
  grid: Grid,
  cols: number,
  rows: number,
): {
  from: Cell;
  to: Cell;
  bounds: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
} {
  const from: Cell = { cx: 0, cy: 0 };
  const to: Cell = { cx: cols - 1, cy: rows - 1 };
  const bounds = grid.rangeBounds(from, to);
  return {
    from,
    to,
    bounds,
    width: Math.max(1, Math.round(bounds.width * EXPORT_SCALE)),
    height: Math.max(1, Math.round(bounds.height * EXPORT_SCALE)),
  };
}

function spaceField(label: string, initial: number): HTMLInputElement {
  const input = h("input", {
    class: "input tile-field",
    type: "number",
    min: "1",
    max: String(MAX_SPACES),
    step: "1",
    "aria-label": label,
  }) as HTMLInputElement;
  input.value = String(initial);
  return input;
}

function value(input: HTMLInputElement): number {
  const n = Math.round(Number(input.value));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_SPACES, n));
}

/**
 * Write the file and put it down.
 *
 * Anchored on the origin space with its **top-left** on it, rather than
 * centred the way an imported image is: a backdrop has an opinion about where
 * it begins and none about where its middle is, and a strip thirty spaces
 * wide centred on the origin would start fifteen spaces off the left of
 * everything anybody has built. It lands at `IMPORT_SCALE` like every other
 * PSD that enters this editor, because a backdrop is painted at retina like
 * everything else.
 *
 * The marks are the selection's, so the file opens with the grid drawn on it
 * — thirty spaces of footprint rather than one — and the `Z | grid` zone
 * describes the ground the backdrop really covers.
 *
 * The sheet stays up while all of that happens. This is the longest wait in
 * the editor by a distance: tens of megapixels to allocate, deflate, parse
 * and slice, inside a single `await` that used to leave a still canvas and no
 * word of what was going on.
 */
async function writeBackground(
  deps: BackgroundDeps,
  cols: number,
  rows: number,
): Promise<void> {
  const scene = deps.scene();
  if (!scene) return;

  const { from, to, bounds, width, height } = backdropSize(deps.grid, cols, rows);
  const anchorWorld = deps.grid.cellToWorld(from);
  const progress = openPsdProgress(
    "Making the background",
    `${cols} × ${rows} spaces, ${width} × ${height} pixels`,
    "Writing the file…",
  );

  try {
    const result = await psd.background(
      deps.projectId,
      `background-${Date.now().toString(36)}`,
      width,
      height,
      scaleMarks(
        {
          ...marksForSelection(deps.grid, from, to),
          // The artwork covers the footprint exactly, so it says so rather
          // than being centred on the anchor like an imported image.
          art: { x: bounds.x - anchorWorld.x, y: bounds.y - anchorWorld.y },
        },
        EXPORT_SCALE,
      ),
    );
    await progress.stage("Loading the artwork…");
    // It lands on the active layer, which the panel made this one on the way
    // into the menu — the same rule Fill and Add Image follow.
    await scene.placePsd(result.key, result.manifest, from, IMPORT_SCALE);
    log.info(
      `${result.key}.psd — ${cols} × ${rows} spaces ` +
        `(${result.width}×${result.height}) — Open PSD to paint it`,
    );
  } catch (err) {
    log.error("Could not make that background:", err);
  } finally {
    // However that went: a sheet with no way out is not a thing to leave up.
    progress.close();
  }
}
