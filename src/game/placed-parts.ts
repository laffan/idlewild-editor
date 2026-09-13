/**
 * Where the pieces of a placed PSD sit inside it.
 *
 * `P2P.place()` hands back a Phaser **Group**, and a Group is not a
 * container: its children live on the scene's own display list at their own
 * coordinates, and the `setPosition` the plugin grafts on forwards one pair
 * of numbers to every one of them. So moving a placed group put every layer
 * inside it on the same corner — which nothing noticed for as long as the
 * only groups the editor wrote were extrusions, whose three parts go into the
 * file at one size and one offset on purpose.
 *
 * Editing the file outside the app is what ends that, and the margin is what
 * makes it likely. A raster layer's bounds in Photoshop are the box around
 * its ink, so a file saved from there comes back with each part cropped to
 * what it actually draws — an extrusion's shading starts half a tile below
 * its silhouette, and the two stop being the same rectangle. Painting into
 * the clear canvas a conversion leaves does the same thing from the other
 * end: the group's own corner moves out to the new ink. Either way the next
 * parse drew the parts stacked on one corner rather than over each other,
 * and the whole placement appeared to jump.
 *
 * So the offsets are read off the objects the plugin has just made, while
 * they still stand where the manifest put them, and every move afterwards is
 * made against them. They are in the PSD's own pixels, which is what lets
 * them scale with the placement — and that is the other half of the same
 * bug: a resized group used to leave its parts the distance apart they were
 * at 100%.
 */

import type { Placement } from "../lib/types";

/** Anything on the canvas that can be moved, and might hold more of them. */
export interface Placed {
  x?: number;
  y?: number;
  /** What psd-to-phaser named it: the layer's name in the PSD. */
  name?: string;
  setPosition(x: number, y: number): unknown;
  setScale(x: number, y: number): unknown;
  setVisible?: (visible: boolean) => unknown;
  /** Present on a Phaser Group, which is what `place()` returns. */
  getChildren?: () => unknown[];
}

/** One piece of a placed PSD, and where it stands inside it. */
export interface PlacedPart {
  object: Placed;
  /**
   * The layer it was made from, as psd-to-phaser named it.
   *
   * The only handle there is on which piece is which: a placed object carries
   * the layer's name and nothing else about where it came from. It is what
   * turning one layer of a placed group off is done by — see `applyHidden`.
   */
  name: string;
  /** Its offset from the placed box's top-left, in the PSD's own pixels. */
  dx: number;
  dy: number;
}

/**
 * Take a placed object apart into the pieces that can be moved, each with the
 * offset it was made at.
 *
 * The top-left the offsets are measured from is the pieces' own bounding
 * corner, which is the same corner `placedPosition` measured the placement
 * from: psd-to-json gives a group the box around the layers in it, and the
 * plugin makes every one of those layers at its position in the canvas. So
 * offset zero is the placement's own x and y, and a single-sprite placement —
 * every converted image — comes out of here with one part at (0, 0), which is
 * exactly where it was put before this existed.
 */
export function partsOf(object: Placed): PlacedPart[] {
  const found: Placed[] = [];
  collect(object, found);
  if (found.length === 0) return [];

  const xs = found.map((piece) => coordinate(piece.x));
  const ys = found.map((piece) => coordinate(piece.y));
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return found.map((piece, index) => ({
    object: piece,
    name: typeof piece.name === "string" ? piece.name : "",
    dx: xs[index] - left,
    dy: ys[index] - top,
  }));
}

/**
 * Turn off the pieces the PSD says are hidden.
 *
 * Run *after* the placement's own visibility, never instead of it: the
 * plugin grafts `setVisible` onto the Group and forwards it to every child,
 * so showing the placement shows all of it again and the pieces have to be
 * put back down afterwards.
 *
 * A group inside the placed group is not a piece — only the things that draw
 * are — but its children are, and psd-to-json marks every layer under a
 * hidden folder as hidden in its own right, so turning them off one at a time
 * comes to the same picture.
 */
export function applyHidden(
  parts: readonly PlacedPart[],
  hidden: readonly string[] | undefined,
): void {
  if (!hidden || hidden.length === 0) return;
  const off = new Set(hidden);
  for (const part of parts) {
    if (off.has(part.name)) part.object.setVisible?.(false);
  }
}

/**
 * Put a placement's pieces where the document says, at the size it says.
 *
 * Scale first and position after, because a sprite the plugin placed carries
 * `setOrigin(0, 0)` — it scales away from its own top-left, which is the
 * corner being positioned, so the two do not fight.
 *
 * A placement with no pieces to walk falls back to the plugin's own
 * `setPosition`. That is the empty group a layer path which resolves to
 * nothing produces; there is nothing to lay out, and the old behaviour is the
 * honest thing to leave it with.
 */
export function applyTransform(
  object: Placed,
  parts: readonly PlacedPart[],
  placement: Placement,
): void {
  const naturalWidth = placement.naturalWidth || placement.width;
  const naturalHeight = placement.naturalHeight || placement.height;
  const scaleX = naturalWidth ? placement.width / naturalWidth : 1;
  const scaleY = naturalHeight ? placement.height / naturalHeight : 1;
  if (naturalWidth && naturalHeight) object.setScale(scaleX, scaleY);

  if (parts.length === 0) {
    object.setPosition(placement.x, placement.y);
    return;
  }
  for (const part of parts) {
    part.object.setPosition(
      placement.x + part.dx * scaleX,
      placement.y + part.dy * scaleY,
    );
  }
}

/**
 * Walk down to the things that actually draw.
 *
 * A group holds groups — a PSD group inside a PSD group is one on the canvas
 * too — and only the leaves have a position of their own worth keeping.
 * Detected structurally rather than with `instanceof`, so this module stays
 * free of a runtime Phaser import and can be tested outside a browser;
 * `getChildren` is Group's defining method.
 */
function collect(object: unknown, out: Placed[]): void {
  const node = object as Placed | null;
  if (!node) return;
  const children = node.getChildren?.();
  if (Array.isArray(children)) {
    for (const child of children) collect(child, out);
    return;
  }
  if (typeof node.setPosition === "function") out.push(node);
}

function coordinate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
