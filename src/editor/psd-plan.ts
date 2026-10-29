/**
 * Include plan's picture: the scene's plan — Plan mode's strokes and the
 * pictures dropped on it — cut to a PSD's box, which `psd_context.rs` writes
 * into the file as a layer called `plan`, on top, each time it is opened or
 * shared.
 *
 * The same box and the same density as Include context (`psdBox`), so the
 * plan lines up with the artwork pixel for pixel. What differs is the
 * backdrop: there is none. Context is a picture of the canvas; this is the
 * tracing paper alone, on transparency, so it can sit over the artwork.
 *
 * **The pictures lose their white.** On the canvas a plan picture is
 * multiplied, so its white vanishes into whatever is under it. A layer in a
 * PSD written by the fork is a normal layer, and an opaque white rectangle
 * over the artwork would hide it — so each picture is turned back into the
 * plan's blue at the strength its darkness had, which over the artwork reads
 * as the multiply did. Its baked tones run from white to `PLAN_COLOR` by
 * darkness (`plan-image-bake.ts`), so the darkness is read straight back off
 * the red channel.
 *
 * **The strokes are drawn on a sheet of their own**, over the pictures,
 * because the plan's eraser strokes cut plan ink and nothing else — on the
 * canvas the pictures are a different layer from the ink, and here they have
 * to stay one.
 */

import { strokeBox, boxesOverlap } from "../drawing/geometry";
import { renderStroke } from "../drawing/render";
import type { Box } from "../game/context-capture";
import { planImagesOf, planOf, type PlanImage } from "../lib/plan";
import { toBlue } from "./plan-image-bake";
import { psdBox, type ContextDeps, type ContextPicture } from "./psd-context";

/**
 * The plan inside the file's box; `"empty"` when the box holds none of it,
 * which takes an old plan layer out rather than writing a clear one; null
 * when the file is not placed or nothing could be drawn.
 */
export async function planPicture(
  deps: ContextDeps,
  key: string,
): Promise<ContextPicture | "empty" | null> {
  const at = await psdBox(deps, key);
  if (!at) return null;
  const { box, width, height } = at;
  const scene = deps.store.activeScene;
  const images = planImagesOf(scene).filter((image) => boxesOverlap(reach(image), box));
  const strokes = planOf(scene).filter((stroke) => {
    const around = strokeBox(stroke);
    return !!around && boxesOverlap(around, box);
  });
  if (images.length === 0 && strokes.length === 0) return "empty";

  const canvas = sheet(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const sx = width / box.width;
  const sy = height / box.height;

  if (images.length > 0) {
    for (const image of images) await drawPicture(ctx, image, box, sx, sy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const data = ctx.getImageData(0, 0, width, height);
    toBlue(data.data);
    ctx.putImageData(data, 0, 0);
  }

  const atlas = deps.drawing?.()?.atlas;
  if (strokes.length > 0 && atlas) {
    const ink = sheet(width, height);
    const inkCtx = ink.getContext("2d");
    if (inkCtx) {
      inkCtx.setTransform(sx, 0, 0, sy, -box.x * sx, -box.y * sy);
      for (const stroke of strokes) renderStroke(inkCtx, stroke, atlas);
      ctx.drawImage(ink, 0, 0);
    }
  }

  const rgba = ctx.getImageData(0, 0, width, height).data;
  return { width, height, rgba };
}

function sheet(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The box a picture covers once turned — enough to ask whether it is in view. */
function reach(image: PlanImage): Box {
  const turn = image.rotation ?? 0;
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const width = image.width * cos + image.height * sin;
  const height = image.width * sin + image.height * cos;
  const cx = image.x + image.width / 2;
  const cy = image.y + image.height / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** One picture, where it stands, at its angle and opacity. */
async function drawPicture(
  ctx: CanvasRenderingContext2D,
  image: PlanImage,
  box: Box,
  sx: number,
  sy: number,
): Promise<void> {
  const el = new Image();
  el.src = image.src;
  try {
    await el.decode();
  } catch {
    return;
  }
  ctx.setTransform(sx, 0, 0, sy, -box.x * sx, -box.y * sy);
  ctx.translate(image.x + image.width / 2, image.y + image.height / 2);
  ctx.rotate(image.rotation ?? 0);
  ctx.globalAlpha = image.opacity ?? 1;
  ctx.drawImage(el, -image.width / 2, -image.height / 2, image.width, image.height);
  ctx.globalAlpha = 1;
}
