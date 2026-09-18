/**
 * Reading one pixel back off the engine's canvas, for the eyedropper.
 *
 * The WebGL drawing buffer is gone by the time a pointer event is handled —
 * see the note at the top of `lib/eyedropper.ts` — so the renderer is asked
 * instead, during a frame it controls. `snapshotPixel` is Phaser's cheapest
 * snapshot: it reads four bytes rather than compositing the viewport into an
 * `Image`, and it is the only one that would be worth doing on every move of
 * a drag.
 *
 * Only one snapshot can be live per frame, which is why the caller keeps a
 * single read in flight; a second request in the same frame replaces the
 * first and the first's callback never fires. That would hang a promise, so
 * every one here is given a way to settle even when nothing comes back.
 */

import type { EngineSampler } from "../lib/eyedropper";
import { rgbToHex } from "../lib/color";

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
  return (canvas, x, y) =>
    new Promise<string | null>((resolve) => {
      const renderer = game.renderer;
      if (!renderer || game.canvas !== canvas) {
        resolve(null);
        return;
      }

      // The renderer addresses its own pixels, which are the canvas's backing
      // store on every scale mode this editor uses. Scaled rather than passed
      // through, so a build that gave the renderer a different resolution
      // reads the pixel somebody pointed at rather than one near it.
      const sx = Math.floor((x / canvas.width) * renderer.width);
      const sy = Math.floor((y / canvas.height) * renderer.height);

      let done = false;
      const settle = (hex: string | null): void => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(hex);
      };
      const timer = window.setTimeout(() => settle(null), SNAPSHOT_TIMEOUT_MS);

      try {
        renderer.snapshotPixel(sx, sy, (result) => {
          // The callback's type covers all three snapshot methods, and only
          // this one hands back a colour.
          if (result instanceof HTMLImageElement) {
            settle(null);
            return;
          }
          settle(
            result.alpha === 0
              ? null
              : rgbToHex({ r: result.red, g: result.green, b: result.blue }),
          );
        });
      } catch {
        settle(null);
      }
    });
}
