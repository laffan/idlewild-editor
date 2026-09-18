/**
 * Reading pixels back off the engine's canvas, for the eyedropper.
 *
 * The WebGL drawing buffer is gone by the time a pointer event is handled —
 * see the note at the top of `lib/eyedropper.ts` — so the renderer is asked
 * instead, during a frame it controls.
 *
 * Two routes, because Phaser's two snapshots cost very different things.
 * `snapshotPixel` reads four bytes and hands back a colour. `snapshotArea`
 * reads the region, copies it to a canvas, and then builds an `Image` out of
 * a data URL — so the patch behind the loupe goes the long way round, and one
 * pixel does not. At eleven CSS pixels square that long way is still a few
 * hundred bytes of PNG, which is the size that makes it affordable on every
 * move of a drag; it is the same call that would be ruinous over a viewport.
 *
 * Only one snapshot can be live per frame, which is why the caller keeps a
 * single read in flight; a second request in the same frame replaces the first
 * and the first's callback never fires. That would hang a promise, so every
 * one here is given a way to settle even when nothing comes back.
 */

import type { EngineSampler } from "../lib/eyedropper";

/** How long a snapshot is given before it is taken to have been dropped. */
const SNAPSHOT_TIMEOUT_MS = 250;

/**
 * An `EngineSampler` over one running game.
 *
 * It declines any canvas that is not this game's, so the eyedropper's walk
 * down the stack keeps working when a second canvas turns up — a thumbnail
 * being taken, a pattern swatch, anything a later version puts on screen.
 */
export function enginePixelSampler(game: Phaser.Game): EngineSampler {
  return (canvas, x, y, width, height) =>
    new Promise<ImageData | null>((resolve) => {
      const renderer = game.renderer;
      if (!renderer || game.canvas !== canvas) {
        resolve(null);
        return;
      }

      // Passed through unscaled, and that is not an oversight. Phaser's
      // snapshot addresses `gl.drawingBufferWidth` — the canvas's backing
      // store — rather than `renderer.width`, which is the game's own units
      // and the two need not agree. So backing pixels in, backing pixels out,
      // which is exactly what `eyedropper.ts` hands over.
      const sx = Math.floor(x);
      const sy = Math.floor(y);
      const sw = Math.max(1, Math.round(width));
      const sh = Math.max(1, Math.round(height));

      let done = false;
      const settle = (pixels: ImageData | null): void => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(pixels);
      };
      const timer = window.setTimeout(() => settle(null), SNAPSHOT_TIMEOUT_MS);

      try {
        if (sw === 1 && sh === 1) {
          renderer.snapshotPixel(sx, sy, (result) => {
            // The callback's type covers all three snapshot methods, and only
            // this one hands back a colour.
            if (result instanceof HTMLImageElement) {
              settle(null);
              return;
            }
            settle(onePixel(result));
          });
          return;
        }

        renderer.snapshotArea(sx, sy, sw, sh, (result) => {
          if (!(result instanceof HTMLImageElement)) {
            settle(null);
            return;
          }
          // Phaser calls back from the image's own `onload`, so it is loaded
          // by the time this runs and can be drawn immediately.
          void readImage(result, sw, sh).then(settle, () => settle(null));
        });
      } catch {
        settle(null);
      }
    });
}

/** One colour, as the 1×1 `ImageData` the caller composites. */
function onePixel(color: Phaser.Display.Color): ImageData {
  const data = new ImageData(1, 1);
  data.data[0] = color.red;
  data.data[1] = color.green;
  data.data[2] = color.blue;
  data.data[3] = Math.round(color.alpha);
  return data;
}

/**
 * A snapshot image, back as pixels.
 *
 * `complete` is the fast path and is the one that runs: Phaser builds the
 * image from a data URL and calls back from its `onload`, so there is nothing
 * left to wait for. Waiting anyway — `decode()` on an image that is already
 * there — costs a whole extra frame of a loupe that is already a frame behind
 * the pointer, which is the difference between a preview that tracks and one
 * that drags. The wait is kept for the case where that stops being true, since
 * drawing an image that has not arrived paints nothing at all.
 */
async function readImage(
  image: HTMLImageElement,
  width: number,
  height: number,
): Promise<ImageData | null> {
  if (!image.complete) {
    await new Promise<void>((done, fail) => {
      image.onload = () => done();
      image.onerror = () => fail(new Error("the snapshot did not load"));
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
