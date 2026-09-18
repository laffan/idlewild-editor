/**
 * Turning a word on the canvas into a placed PSD.
 *
 * The fourth bridge into the pipeline, after an image import, a lassoed sketch
 * and a fill — and it is the same sentence again: something the editor holds
 * is rasterised, written into a PSD marked with the grid spaces it covers, and
 * placed back exactly where it was. What is different about this one is *why*
 * it has to exist at all.
 *
 * **A font is not something the game has.** A `TextItem` is drawn by the
 * browser, in a family that is on this device because the operating system
 * ships it — and a published game is a directory of files somebody serves,
 * opened on a machine that may have none of them. Shipping the text as text
 * would mean shipping a font, choosing a fallback, and accepting that the
 * words reflow on the day the fallback is wrong. Pixels have none of those
 * questions in them, and a PSD of the words is also a file somebody can open
 * and paint over, which is what a sign in a game usually wants next.
 *
 * So text is temporary on purpose, and this is the one exit it has.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { psd, toBase64 } from "../lib/ipc";
import {
  fontString,
  lineOffset,
  removeText,
  textById,
  textLines,
  LINE_HEIGHT,
} from "../lib/text-items";
import type { Selection, TextItem } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import {
  EXPORT_SCALE,
  IMPORT_SCALE,
  footprintForBox,
  marksForBox,
  marksForCells,
  psdMargin,
  scaleMarks,
} from "./import-anchor";
import { openPsdProgress } from "./psd-progress";
import * as log from "../lib/log";

/**
 * Write the words into a PSD, place it, and take the note off the canvas.
 *
 * One undo step: the note going and the artwork arriving are one thing, the
 * way a fill's conversion is, or a history that put the note back without
 * taking the file away would leave the same words on the grid twice.
 */
export async function convertTextToPsd(
  projectId: string,
  store: DocStore,
  grid: Grid,
  scene: WorldScene,
  selection: Extract<Selection, { kind: "text" }>,
): Promise<void> {
  const { layerId, textId } = selection;
  const item = textById(store.layer(layerId), textId);
  if (!item || !item.text.trim()) {
    log.warn("There are no words to convert");
    return;
  }

  const raster = rasteriseText(item);
  if (!raster) {
    log.error("Could not draw the text");
    return;
  }

  const progress = openPsdProgress(
    "Converting to PSD",
    firstLine(item),
    "Packing the pixels…",
  );

  try {
    const box = { x: item.x, y: item.y, width: item.width, height: item.height };
    // The spaces the words actually cover, and the lowest corner of them —
    // the same two questions a fill's conversion asks, and for the same
    // reason: the cell range *enclosing* an isometric footprint is a far
    // bigger diamond than the footprint.
    const footprint = footprintForBox(grid, box);
    const anchor = footprint.anchor;
    const anchorWorld = grid.cellToWorld(anchor);
    const art = { x: box.x - anchorWorld.x, y: box.y - anchorWorld.y };

    const result = await psd.fromRgba(
      projectId,
      textName(item),
      raster.width,
      raster.height,
      toBase64(raster.rgba),
      scaleMarks(
        {
          ...(grid.snaps
            ? marksForCells(grid, footprint.cells, anchor, art)
            : marksForBox(grid, box, anchor)),
          // A space of clear canvas around it, as every conversion gets:
          // somewhere to paint the shadow under the letters.
          margin: psdMargin(grid),
        },
        EXPORT_SCALE,
      ),
    );

    await progress.stage("Placing the artwork…");
    store.history.begin();
    try {
      await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
      removeText(store, layerId, textId);
    } finally {
      store.history.end();
    }
    log.info(
      `“${firstLine(item)}” → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not turn the text into a PSD:", err);
  } finally {
    progress.close();
  }
}

/**
 * The words, drawn at `EXPORT_SCALE` into a buffer of their own box.
 *
 * The same canvas the box was measured with, at the same font and the same
 * leading — `lib/text-items.ts` owns both, so what is rasterised is what was
 * on screen rather than a second opinion about how the text lays out.
 *
 * Drawn on the **alphabetic** baseline rather than at the top of each line,
 * because that is what a font size means: `textBaseline: "top"` puts the
 * ascent's own box at the top and moves every glyph down by whatever padding
 * that family leaves, which is exactly the kind of difference that shows when
 * a note is converted and lands two pixels lower than it was.
 */
function rasteriseText(
  item: TextItem,
): { rgba: Uint8ClampedArray; width: number; height: number } | null {
  const width = Math.max(1, Math.ceil(item.width * EXPORT_SCALE));
  const height = Math.max(1, Math.ceil(item.height * EXPORT_SCALE));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.font = fontString(item);
  ctx.fillStyle = item.color;
  ctx.textBaseline = "alphabetic";

  const leading = item.size * LINE_HEIGHT;
  textLines(item).forEach((line, index) => {
    const at = lineOffset(item, ctx.measureText(line).width);
    // The baseline sits within the line box the way Phaser's `Text` puts it:
    // the ascent from the top, which for every family here is close enough to
    // the size itself that one number serves.
    ctx.fillText(line, at, index * leading + item.size);
  });

  return {
    rgba: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
  };
}

/**
 * What the file is called: the words themselves, sanitised.
 *
 * `door to the cave` becomes `door-to-the-cave.psd`, which is a file anybody
 * can find again in `psd/` — and a great deal better than `text-m2k9f1`, which
 * is what every other conversion in this editor has to settle for because a
 * fill and a sketch have no words in them. Rust sanitises the stem itself; this
 * only has to keep it short and stop it being empty.
 */
function textName(item: TextItem): string {
  const words = item.text
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .slice(0, 40)
    .trim();
  return words || `text-${Date.now().toString(36)}`;
}

/** Its first line, for the sheet and the console line. */
function firstLine(item: TextItem): string {
  const line = item.text.split("\n")[0]?.trim() ?? "";
  return line.length > 40 ? `${line.slice(0, 39)}…` : line || "Text";
}
