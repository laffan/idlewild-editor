/**
 * The tool under the pointer, drawn where it would land.
 *
 * Every painting app does this and for one reason: a brush is a size, a tip
 * and a colour, and none of the three is knowable from a crosshair. Until a
 * mark is down you are guessing, and the guess is wrong most often exactly
 * when it matters — the first stroke on a fresh canvas, a pattern whose scale
 * you have just changed, a shape you have just picked off the palette.
 *
 * **It is the mark, not a drawing of the mark.** What this paints is one stamp
 * of the real tool, through the same `renderLive` a session paints through, at
 * a lower opacity. So the tip is the tip, the pattern is on the world's own
 * lattice, and a shape fills the space it is going to fill — and none of it
 * can drift from what the tool does, because there is no second painter to
 * drift.
 *
 * It lives on the **live canvas**, beside the eraser's disc, which means it
 * costs nothing to take away: the next `beginLive` clears the rectangle this
 * one reported, so pressing to draw removes the preview without anybody
 * having to remember to. See `Surface.beginLive`.
 */

import type { AtlasCache } from "./atlas";
import { markBox, renderLive } from "./render";
import type { Surface } from "./surface";
import type { StampBox } from "./tools-stamp";
import type { DrawingTool, StrokeStyle } from "./types";

/**
 * How much of its own opacity the preview keeps.
 *
 * Enough to read the tip's shape and the pattern's density against the
 * artwork, little enough that it is never mistaken for ink already down.
 */
const FADE = 0.45;

/** What a tool turned round previews in — the editor's accent, as everywhere. */
const ERASE_RED = "#ec3013";

/** Which tools have a preview worth painting. */
export function hasToolCursor(tool: DrawingTool): boolean {
  return tool === "pencil" || tool === "pattern" || tool === "shape";
}

/**
 * Paint one stamp of `tool` at the pointer, faded.
 *
 * `boxAt` answers where a shape stamp would go — the grid space under the
 * point — and is the same function the shape session stamps through, so the
 * preview lands on the space the stamp will.
 */
export function drawToolCursor(
  surface: Surface,
  atlas: AtlasCache,
  tool: DrawingTool,
  style: StrokeStyle,
  x: number,
  y: number,
  boxAt: (x: number, y: number) => StampBox | null,
): void {
  if (!hasToolCursor(tool)) return;

  // A shape fills a *space*, so its preview is the space it would fill rather
  // than something under the pointer: the stamp is taken from the same place
  // the session takes it.
  const box = tool === "shape" ? boxAt(x, y) : null;
  if (tool === "shape" && !box) return;

  const shown: StrokeStyle = {
    ...style,
    // Never the erase path here. `renderLive` composites `destination-out`
    // when a mark is erasing, and a hole punched in the live canvas shows
    // nothing at all — the erase is cut into the *baked* canvas by the
    // session, which has not happened yet. So the preview draws the mark and
    // says "taking out" with its colour instead.
    erase: false,
    color: style.erase ? ERASE_RED : style.color,
    ...(box
      ? {
          mode: "shape" as const,
          stamp: { width: box.width, height: box.height, diamond: box.diamond },
        }
      : {}),
  };

  const at = box ? { x: box.x, y: box.y } : { x, y };
  const stream = [{ point: [at.x, at.y] as [number, number], pressure: 1 }];
  const bounds = markBox(stream, shown.size, shown.mode, {
    paint: shown.paint,
    stamp: shown.stamp,
    erase: false,
  });
  if (!bounds) return;

  const ctx = surface.beginLive();
  ctx.save();
  ctx.globalAlpha = FADE;
  renderLive(ctx, stream, shown, atlas);
  if (style.erase) outline(ctx, surface, shown, at, box);
  ctx.restore();
  surface.endLive(bounds);
}

/** The dark backing the red ring is drawn over — see `outline`. */
const ERASE_HALO = "rgba(32, 30, 29, 0.55)";

/**
 * The red ring round a tool that is turned round.
 *
 * The tint alone is not enough: a six-pixel tip tinted red over artwork that
 * is *already* red is nothing at all, which is exactly the block-out somebody
 * reaches for the eraser on. And for a pattern there is barely a mark to tint,
 * because a pattern is mostly holes.
 *
 * So it is a ring, and the ring is drawn twice — a dark halo under a red line.
 * One colour cannot be seen against every ground, and this canvas has two of
 * them by design: a pale blue lattice, and whatever has been painted on it.
 */
function outline(
  ctx: CanvasRenderingContext2D,
  surface: Surface,
  style: StrokeStyle,
  at: { x: number; y: number },
  box: StampBox | null,
): void {
  const line = surface.worldPerScreenPixel;
  ctx.globalAlpha = 1;
  ctx.beginPath();

  if (!box) {
    // Half the tip, with a floor: a one-pixel brush still needs a ring big
    // enough to aim with.
    ctx.arc(at.x, at.y, Math.max(line * 3, style.size / 2), 0, Math.PI * 2);
  } else if (box.diamond) {
    // The space itself on an isometric project, which is the diamond
    // inscribed in the box rather than the box.
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    ctx.moveTo(midX, box.y);
    ctx.lineTo(box.x + box.width, midY);
    ctx.lineTo(midX, box.y + box.height);
    ctx.lineTo(box.x, midY);
    ctx.closePath();
  } else {
    ctx.rect(box.x, box.y, box.width, box.height);
  }

  ctx.strokeStyle = ERASE_HALO;
  ctx.lineWidth = line * 3.5;
  ctx.stroke();
  ctx.strokeStyle = ERASE_RED;
  ctx.lineWidth = line * 1.5;
  ctx.stroke();
}
