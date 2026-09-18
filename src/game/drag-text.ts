/**
 * The two drags a note answers: moving it, and setting the width of its column.
 *
 * Its own file because it is the one pair in `drag.ts` that needs a note's own
 * coordinate frame — the shear that lays a note into the grid means neither the
 * handle's position nor the width a drag is asking for can be read off the
 * world box — and because that file is against the 700-line rule. Everything
 * here hands its answer back through the same `start` the rest of the
 * controller uses, so a text drag is a `DragState` like any other.
 */

import { HANDLE_SCREEN_PX } from "./resize";
import { makeId } from "../lib/doc-store";
import {
  addText,
  planeFor,
  textById,
  textFrame,
  textPoint,
} from "../lib/text-items";
import type { Cell, Point, Selection, TextItem } from "../lib/types";
import type { DragHost, DragState } from "./drag";

type TextSelection = Extract<Selection, { kind: "text" }>;

/**
 * A word, picked up anywhere inside its measured box.
 *
 * The box rather than the letters, for the reason `pickText` gives: the gap
 * inside an O is not a hole a drag should fall through.
 */
export function beginTextDrag(
  host: DragHost,
  selection: TextSelection,
  world: Point,
  grabCell: Cell,
  alt: boolean,
  start: (state: DragState) => void,
): boolean {
  const layer = host.store.layer(selection.layerId);
  if (!layer || layer.locked) return false;
  const item = textById(layer, selection.textId);
  if (!item) return false;
  if (
    world.x < item.x ||
    world.x > item.x + item.width ||
    world.y < item.y ||
    world.y > item.y + item.height
  ) {
    return false;
  }

  // Option-drag copies, as it does for a fill, an image and a boundary: the
  // copy is what moves, and the original stays where it was.
  const dragged = alt ? copyText(host, layer.id, item) : item;
  start({
    kind: "text",
    layerId: layer.id,
    id: dragged.id,
    grabCell,
    at: { x: dragged.x, y: dragged.y },
  });
  return true;
}

/**
 * The wrap handle at the end of a note's column.
 *
 * Only on a note that wraps: the handle *is* the column's width, and a note
 * with no column has no width to set. Hit-tested in **text space** rather than
 * against a world rectangle, because on a note laid into the grid the column
 * runs off along a diagonal and its end is nowhere near the box's corner —
 * which is the same reason the overlay draws the handle through `textPoint`.
 */
export function beginWrapDrag(
  host: DragHost,
  selection: TextSelection,
  world: Point,
  start: (state: DragState) => void,
): boolean {
  const layer = host.store.layer(selection.layerId);
  if (!layer || layer.locked) return false;
  const item = textById(layer, selection.textId);
  if (!item || item.wrapWidth === undefined) return false;

  const frame = textFrame(item, planeFor(item, host.grid));
  const at = textPoint(frame, frame.flat.width, frame.flat.height / 2);
  // The same size to the finger at any zoom, as every handle on this canvas is.
  const reach = HANDLE_SCREEN_PX / host.zoom() / 2;
  if (Math.abs(world.x - at.x) > reach || Math.abs(world.y - at.y) > reach) {
    return false;
  }

  start({ kind: "wrap", layerId: layer.id, id: item.id, frame });
  return true;
}

function copyText(host: DragHost, layerId: string, item: TextItem): TextItem {
  const copy = addText(host.store, layerId, { ...item, id: makeId("text") });
  host.setSelection({ kind: "text", layerId, textId: copy.id });
  return copy;
}
