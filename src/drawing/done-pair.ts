/**
 * The baked canvas, and a spare it swaps with — Hush's deltas #29 and #31.
 *
 * WebKit rasterises Canvas2D on the CPU and, at commit, uploads whatever
 * region of a *visible* canvas was dirtied, at about 280 MB/s. Fully dirtying
 * a 4096² canvas therefore costs about 235 ms however cheap the drawing was —
 * and a re-anchor dirties the whole thing, whether it re-bakes or slides. A
 * canvas at 1 % opacity is still composited (so GPU-backed) but its writes
 * skip that upload. So anything that rewrites the whole picture — a slide, a
 * re-bake — draws into the near-invisible spare and then **swaps the two
 * canvases' roles**: an opacity flip, a class flip and a context rebind, all
 * compositor-cheap, landing in the same commit as the stage's new transform.
 * The visible canvas is never fully dirtied. Hush measured each step of this
 * on an iPad; see its `README-DRAWING.md`.
 *
 * And the slide copies *across* the pair rather than drawing the canvas onto
 * itself: a canvas used as its own `drawImage` source makes WebKit snapshot
 * the whole surface, a ~230 ms GPU→CPU readback even for a 1 × 1 rectangle.
 *
 * The spare is 1 × 1 until the first time it is needed, so a surface that
 * never re-anchors with anything on it — a plan nobody drew — never holds a
 * second backing. The ghost of the old frame left on it shows at 1 % and is
 * not worth the clear.
 */

import { context, stageCanvas } from "./tail-canvas";

export class DonePair {
  /** The canvas on screen. Read it fresh: a swap changes which one it is. */
  ctx: CanvasRenderingContext2D;
  private spare: CanvasRenderingContext2D;
  /** Both canvases, the spare first so it sits under the done one. */
  readonly els: readonly HTMLCanvasElement[];
  private pixels = 1;
  private dpr = 1;

  constructor() {
    const done = stageCanvas("draw-done");
    const spare = stageCanvas("draw-done draw-spare");
    spare.style.opacity = "0.01";
    this.ctx = context(done);
    this.spare = context(spare);
    this.els = [spare, done];
  }

  get canvas(): HTMLCanvasElement {
    return this.ctx.canvas;
  }

  /** Size the visible canvas — the spare follows the first time it is drawn into. */
  size(pixels: number, dpr: number): void {
    this.pixels = pixels;
    this.dpr = dpr;
    sizeCanvas(this.ctx.canvas, pixels, dpr);
  }

  /**
   * Draw a whole new frame aside, cleared first, and show it. `draw` is
   * handed the spare at the identity transform.
   */
  paintAside(draw: (ctx: CanvasRenderingContext2D) => void): void {
    const spare = this.backSpare();
    spare.setTransform(1, 0, 0, 1, 0, 0);
    spare.clearRect(0, 0, this.pixels, this.pixels);
    draw(spare);
    spare.setTransform(1, 0, 0, 1, 0, 0);
    this.swap();
  }

  /**
   * Move the picture by `dx`, `dy` whole pixels and show it moved. What the
   * move uncovers is transparent.
   */
  shift(dx: number, dy: number): void {
    const spare = this.backSpare();
    spare.save();
    spare.setTransform(1, 0, 0, 1, 0, 0);
    // `copy` replaces the whole spare with the moved picture, so nothing of
    // its last frame survives where the move uncovers.
    spare.globalCompositeOperation = "copy";
    spare.drawImage(this.ctx.canvas, dx, dy);
    spare.restore();
    this.swap();
  }

  private backSpare(): CanvasRenderingContext2D {
    const el = this.spare.canvas;
    if (el.width !== this.pixels || el.style.width !== `${this.pixels / this.dpr}px`) {
      sizeCanvas(el, this.pixels, this.dpr);
    }
    return this.spare;
  }

  private swap(): void {
    const shown = this.spare;
    const hidden = this.ctx;
    shown.canvas.style.opacity = "";
    hidden.canvas.style.opacity = "0.01";
    shown.canvas.classList.remove("draw-spare");
    hidden.canvas.classList.add("draw-spare");
    this.ctx = shown;
    this.spare = hidden;
  }
}

export function sizeCanvas(el: HTMLCanvasElement, pixels: number, dpr: number): void {
  el.width = pixels;
  el.height = pixels;
  el.style.width = `${pixels / dpr}px`;
  el.style.height = `${pixels / dpr}px`;
}
