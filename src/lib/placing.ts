/**
 * Where a manifest layer belongs in the world.
 *
 * `lib/manifest.ts` reads a psd-to-json manifest; this is the other half —
 * the arithmetic that turns one of its layers into a position on the canvas,
 * and back again. It is one formula and its inverses: put the PSD's
 * `P | anchor` mark on the world point it belongs on, then step out to where
 * the layer sits relative to that mark inside the canvas, scaled by how big
 * the artwork is being shown against its own pixels.
 *
 * Apart from the reader because it is a different job with a different reason
 * to change — the reader follows psd-to-json's output, this follows what the
 * canvas does to a placement — and because the two together were over the
 * 700-line rule.
 */

import type { Manifest } from "./manifest";
import type { Point } from "./types";

/**
 * Where a PSD's anchor sits in its canvas, falling back to the middle.
 *
 * The centre is what the editor used before the mark existed and what any
 * PSD from elsewhere still gets — it is the only defensible guess when
 * nothing in the file says otherwise.
 */
export function anchorOffset(manifest: Manifest): { x: number; y: number } {
  return (
    manifest.anchor ?? { x: manifest.width / 2, y: manifest.height / 2 }
  );
}

/**
 * Where the PSD's whole canvas sits in the world, given one placement of it.
 *
 * The frame PSD Edit mode draws, and the thing a placement's own outline is *not*:
 * that box is one layer's artwork, cropped to its pixels, which on a file
 * with a margin or several layers is a good deal smaller than the document
 * somebody opens in Photoshop. Drawing inside the artwork's box and calling
 * it "inside the PSD" is the mismatch this exists to close.
 *
 * The arithmetic is `placedPosition` run over the canvas corner: the anchor
 * mark lands on the placement's grid space, and the top-left of the canvas is
 * however far the mark sits from it, scaled by how big the artwork is being
 * shown against its own pixels.
 */
export function canvasBox(
  anchorWorld: Point,
  manifest: Manifest,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const anchor = anchorOffset(manifest);
  return {
    x: anchorWorld.x - anchor.x * scale,
    y: anchorWorld.y - anchor.y * scale,
    width: manifest.width * scale,
    height: manifest.height * scale,
  };
}

/**
 * Where a manifest layer belongs in the world.
 *
 * The one formula both placing and re-importing use: put the PSD's anchor
 * mark on the grid space's world point, then step out to where this layer
 * sits relative to that mark inside the canvas — scaled, because the
 * displayed size is measured against the size the manifest exported.
 */
export function placedPosition(
  world: Point,
  manifest: Manifest,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  return positionFrom(world, anchorOffset(manifest), entry, scaleX, scaleY);
}

/**
 * The same, against an anchor named outright rather than read from the file.
 *
 * A re-import is the one caller that has a better answer than the manifest
 * does. `anchorOffset` falls back to the canvas centre for a file with no
 * mark, which is the only defensible guess about a file nobody has placed —
 * and quite wrong about one that is already standing on the grid. See
 * `game/reconcile.ts`.
 */
export function positionFrom(
  world: Point,
  anchor: Point,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  return {
    x: world.x + (entry.x - anchor.x) * scaleX,
    y: world.y + (entry.y - anchor.y) * scaleY,
  };
}

/**
 * Where a layer sits relative to the anchor, in the PSD's own pixels.
 *
 * The other half of `positionFrom`: that one turns this offset into a world
 * position, and this is the offset itself. A placement keeps it — see
 * `Placement.fromAnchor` — because it is the only thing that can say where
 * the mark has got to once the placement has been resized, and a re-parse
 * that cannot say that puts the artwork somewhere else.
 */
export function offsetFromAnchor(anchor: Point, entry: Point): Point {
  return { x: entry.x - anchor.x, y: entry.y - anchor.y };
}

/**
 * The anchor a file *would* need for a layer to land on a given spot.
 *
 * The placement formula run backwards. What it is for: a file that has come
 * back from another program without its `P | anchor` — flattened, or saved
 * as a PNG — still has to go back where it was, and where it was is a fact
 * the document holds even though the file has stopped saying it.
 */
export function anchorImpliedBy(
  world: Point,
  at: Point,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  return {
    x: entry.x - (at.x - world.x) / (scaleX || 1),
    y: entry.y - (at.y - world.y) / (scaleY || 1),
  };
}
