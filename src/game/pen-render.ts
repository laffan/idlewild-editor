/**
 * What pen mode draws: the edge of the PSD's canvas, and the dim over
 * everything that is not inside it.
 *
 * The counterpart to `extrude-render.ts`, and deliberately the same idea —
 * chrome saying the canvas is in a mode — with one difference that matters.
 * Extrude's scrim is pinned to the screen and covers the lot; this one has a
 * hole in it, because the whole point of the mode is that there is somewhere
 * you are drawing *into*. Phaser's Graphics has no even-odd fill, so the hole
 * is made the way it is made on paper: four rectangles around the gap.
 *
 * Those four are cut from **what the camera can currently see**, not from a
 * rectangle big enough to cover any camera at all. The screen-sized constant
 * `extrude-render.ts` gets away with is what a scrim pinned to the screen
 * can do; a world-space fill has to be honest about the zoom, and a quick
 * arithmetic answer — one number large enough for the widest possible view —
 * puts tens of thousands of units of geometry through the batch and comes
 * back with holes in it. So the dim follows the camera, which is a redraw per
 * frame of four rectangles and cheaper than being clever about when to.
 *
 * The frame itself is in world space, and only its outline is sized in screen
 * pixels — like every other hairline in this editor.
 */

import type Phaser from "phaser";
import type { Bounds } from "../drawing/types";

/** Above the document, below the selection overlay and the marquee. */
const DIM_DEPTH = 920_000;
const FRAME_DEPTH = 930_000;

const ACCENT = 0xec3013;

/**
 * How far past the edge of the view the dim is drawn, in world units.
 *
 * Only has to cover the frame or two a camera can move in before the next
 * redraw, which is the same overdraw the grid renderer leaves itself.
 */
const OVERDRAW = 256;

/** How long the tick at each corner of the frame is, in screen pixels. */
const CORNER_PX = 14;

export class PenRender {
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly frame: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.dim = scene.add.graphics().setDepth(DIM_DEPTH);
    this.frame = scene.add.graphics().setDepth(FRAME_DEPTH);
  }

  /**
   * @param box the PSD's canvas, in world pixels.
   * @param camera the scene's, for the zoom the outline is sized against and
   *        the world rectangle the dim is cut out of.
   */
  render(box: Bounds, camera: Phaser.Cameras.Scene2D.Camera): void {
    const scale = 1 / camera.zoom;
    const { x, y, width, height } = box;

    // The view, grown a little, and the frame clamped inside it: what is
    // filled is always four rectangles about the size of the screen, whatever
    // the camera is doing and wherever the file is.
    const view = camera.worldView;
    const left = view.left - OVERDRAW;
    const top = view.top - OVERDRAW;
    const right = view.right + OVERDRAW;
    const bottom = view.bottom + OVERDRAW;
    const gapLeft = clamp(x, left, right);
    const gapRight = clamp(x + width, left, right);
    const gapTop = clamp(y, top, bottom);
    const gapBottom = clamp(y + height, top, bottom);

    const d = this.dim;
    d.clear();
    d.fillStyle(0x201e1d, 0.45);
    // Around the gap, not over it: above, below, and the two sides between.
    d.fillRect(left, top, right - left, gapTop - top);
    d.fillRect(left, gapBottom, right - left, bottom - gapBottom);
    d.fillRect(left, gapTop, gapLeft - left, gapBottom - gapTop);
    d.fillRect(gapRight, gapTop, right - gapRight, gapBottom - gapTop);

    const f = this.frame;
    f.clear();
    f.lineStyle(2 * scale, ACCENT, 1);
    f.strokeRect(x, y, width, height);
    // Corner ticks, thicker than the edge. On a large PSD the four sides can
    // all be off screen at once, and a frame you cannot see is not a frame:
    // the corners are what you look for when you pan back to find it.
    const arm = Math.min(CORNER_PX * scale, width / 3, height / 3);
    f.lineStyle(4 * scale, ACCENT, 1);
    for (const [cx, sx] of [
      [x, 1],
      [x + width, -1],
    ] as const) {
      for (const [cy, sy] of [
        [y, 1],
        [y + height, -1],
      ] as const) {
        f.beginPath();
        f.moveTo(cx + sx * arm, cy);
        f.lineTo(cx, cy);
        f.lineTo(cx, cy + sy * arm);
        f.strokePath();
      }
    }
  }

  /** Take it down, leaving the canvas as it was. */
  clear(): void {
    this.dim.clear();
    this.frame.clear();
  }

  destroy(): void {
    this.dim.destroy();
    this.frame.destroy();
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
