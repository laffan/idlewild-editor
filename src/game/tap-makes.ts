/**
 * The two tools whose gesture is a tap on bare ground.
 *
 * Point and Text are the odd pair among the tools: everything else on the
 * canvas either picks something up or draws a stroke, and these two *make a
 * document object where the finger landed*. The gesture is the same and so are
 * the three things that have to be true about it — there is an active layer,
 * it is not locked, and what is made ends up selected — so they are written
 * once, side by side, where the difference between them is the only thing on
 * screen.
 *
 * Its own file for the reason `adjusting.ts` is one: `world-scene.ts` is
 * against the 700-line rule, and none of this touches Phaser, the camera or
 * the display list. What the scene keeps is the tap, and which tool is in
 * hand.
 *
 * **A point takes a space and a word takes a position**, which is the whole of
 * the difference and it is deliberate. A point is a place the game reads back
 * by name — `config.layers[].points` — so a space is what it *is*, and a
 * sub-cell offset would be a number nothing downstream could use. A word is a
 * note in the margin of the artwork: it wants to sit beside a doorway rather
 * than over the space the doorway is in, and it is dragged a whole space at a
 * time afterwards, which keeps whatever offset it landed with.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { addText, newText } from "../lib/text-items";
import type { Point, Selection } from "../lib/types";
import type { TextStyle } from "./text-style";
import * as log from "../lib/log";

/** What making something out of bare ground needs from the scene. */
export interface TapHost {
  store: DocStore;
  grid: Grid;
  activeLayerId: string;
  setSelection: (selection: Selection) => void;
}

/**
 * The layer a tap would land on, or null with the reason already said.
 *
 * A locked layer is the one refusal either tool has, and it says so rather
 * than doing nothing: a tap that makes nothing and prints nothing is a tool
 * that looks broken.
 */
function target(host: TapHost) {
  const layer = host.store.layer(host.activeLayerId);
  if (!layer || layer.locked) {
    log.warn("The active layer is locked");
    return null;
  }
  return layer;
}

/**
 * Put a named place on the active layer, on the space that was tapped.
 *
 * The space rather than the pixel, because a point is a thing standing on one
 * and the space is what the game reads it back as. A blank project's space is
 * a single pixel, so there it is the pixel that was tapped.
 */
export function addPointAt(host: TapHost, world: Point): boolean {
  const layer = target(host);
  if (!layer) return false;
  const point = host.store.addPoint(layer.id, host.grid.worldToCell(world));
  host.setSelection({ kind: "point", layerId: layer.id, pointId: point.id });
  return true;
}

/**
 * Write on the canvas, where it was tapped.
 *
 * What it says is the placeholder, and it is selected on the way out, so the
 * inspector is already open on the field to type into. **There is no caret on
 * the canvas**: a text editor over a Phaser scene would be a second input
 * model — an iPad keyboard, an IME, a selection — for a string that is three
 * words long, and the panel beside it is already where every other property of
 * every other object is typed.
 */
export function addTextAt(
  host: TapHost,
  world: Point,
  style: TextStyle,
): boolean {
  const layer = target(host);
  if (!layer) return false;
  const item = addText(host.store, layer.id, newText(world, style, host.grid));
  host.setSelection({ kind: "text", layerId: layer.id, textId: item.id });
  log.info("Text — type what it says in the panel beside it");
  return true;
}
