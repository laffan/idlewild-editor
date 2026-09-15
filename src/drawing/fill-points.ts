/**
 * The sweep fill's other half: a shape tapped out a corner at a time.
 *
 * The freehand sweep in `tools.ts` is a gesture — press, run the outline,
 * release, and what lands is where the hand went. That is the right shape for
 * an organic blob and the wrong one for anything with corners in it: a sweep
 * cannot be corrected after the fact, because the release is the commit, so a
 * shape that came out nearly right has to be drawn again from scratch.
 *
 * This is the same tool aimed differently. Tap to drop a corner, drag any
 * corner to move it, and the shape is not committed until you say so — by
 * tapping the first corner again, which is how a polygon has been closed in
 * every drawing program since the first one, or from the Fill button in the
 * inspector's TOOL section for anyone who would rather press a button.
 *
 * ## It outlives a gesture, which nothing else here does
 *
 * Every other tool is a `ToolSession`: a pointer goes down, the session
 * records, the pointer comes up and the session is over. This holds its
 * points *between* gestures — that is the whole feature — so the state lives
 * on the object and each gesture is a thin session over it. The drawing layer
 * keeps one of these per layer instance and clears it whenever the tool, the
 * document layer or the fill mode changes, because a half-built shape is
 * about the thing you are currently pointing at and nothing else.
 */

import type { StrokeStore } from "./stroke-store";
import type { Surface } from "./surface";
import { toFlat, type InkPoint } from "./geometry";
import { boundsOf, fillPreview, type ToolSession } from "./tools";
import type { Bounds, StrokeStyle } from "./types";

const ACCENT = "#ec3013";

/** How near a tap has to land to take hold of a corner, in screen pixels. */
const HANDLE_HIT_PX = 14;

/** How big the corner handles are drawn, in screen pixels. */
const HANDLE_PX = 5;

/** How far a press may travel and still count as a tap, in screen pixels. */
const TAP_SLOP_PX = 4;

/** The fewest corners that enclose anything. */
const MIN_POINTS = 3;

export class PointFill {
  private points: InkPoint[] = [];
  private readonly surface: Surface;
  private readonly store: StrokeStore;
  /** Told whenever the shape changes, so the shell can re-offer its buttons. */
  private readonly onChange: () => void;

  constructor(surface: Surface, store: StrokeStore, onChange: () => void) {
    this.surface = surface;
    this.store = store;
    this.onChange = onChange;
  }

  /** How many corners are down. Zero is "nothing started". */
  get count(): number {
    return this.points.length;
  }

  /** Whether there is a shape to fill. */
  get canFill(): boolean {
    return this.points.length >= MIN_POINTS;
  }

  /**
   * The box the corners cover, in world units, or null for no shape.
   *
   * What the floating Fill / Cancel bar stands over. The handles are not
   * counted into it: they are drawn at a fixed screen size, so growing the box
   * by them would make the bar drift away from the shape as you zoom out.
   */
  box(): Bounds | null {
    if (this.points.length === 0) return null;
    return boundsOf(this.points, 0);
  }

  /**
   * One gesture over the shape: take hold of a corner, or drop a new one.
   *
   * A new corner is dropped *and held*, so a tap places it and a press-drag
   * places it where the finger settles — the same gesture either way, which
   * is what saves this from being two.
   */
  begin(x: number, y: number, style: StrokeStyle): ToolSession {
    const grabbed = this.nearest(x, y);
    const index = grabbed >= 0 ? grabbed : this.points.push({ x, y, pressure: 1 }) - 1;
    const from = { x: this.points[index].x, y: this.points[index].y };
    if (grabbed < 0) this.onChange();
    this.repaint(style);

    return {
      move: (mx, my) => {
        this.points[index] = { x: mx, y: my, pressure: 1 };
        this.repaint(style);
      },
      end: () => {
        const moved =
          Math.hypot(this.points[index].x - from.x, this.points[index].y - from.y) >
          this.slop(TAP_SLOP_PX);
        // Tapping the corner you started from closes the shape, which is how
        // a polygon is closed everywhere else. Only a corner that was already
        // there: the first tap of a new shape lands on nothing and must not
        // fill the nothing it landed on.
        if (!moved && grabbed === 0 && this.canFill) {
          this.fill(style);
          return;
        }
        if (moved) this.onChange();
        this.repaint(style);
      },
    };
  }

  /**
   * Lay the shape down as a fill, and start again empty.
   *
   * It lands as a `fill`-mode stroke, which is what the freehand sweep lands
   * as too — so it erases, undoes, exports and applies into a PSD through
   * machinery that already exists and knows nothing about how it was aimed.
   */
  fill(style: StrokeStyle): boolean {
    if (!this.canFill) return false;
    // Before the stroke, not after: an erasing shape has been previewed by
    // cutting the baked canvas, and stamping the real one over a preview that
    // is still there would take the same pixels out twice.
    this.surface.endErase();
    this.store.add(toFlat(this.points), { ...style, mode: "fill" });
    this.clear();
    return true;
  }

  /** Throw the half-built shape away. */
  clear(): void {
    if (this.points.length === 0) return;
    this.points = [];
    this.surface.clearLive();
    this.surface.endErase();
    this.onChange();
  }

  /** Take the last corner back off, which is what a mis-tap needs. */
  undoPoint(style: StrokeStyle): void {
    if (this.points.length === 0) return;
    this.points.pop();
    if (this.points.length === 0) {
      this.surface.clearLive();
      this.surface.endErase();
    } else this.repaint(style);
    this.onChange();
  }

  /**
   * Draw the shape as it currently stands.
   *
   * Called after every change and again whenever the camera moves, because
   * the live canvas is cleared by a re-anchor and a half-built shape has to
   * survive a pan the way the ink under it does.
   */
  repaint(style: StrokeStyle): void {
    if (this.points.length === 0) return;
    const pad = this.slop(HANDLE_PX + 4);
    // Opened **once**. `Surface.beginLive` clears the rectangle it last
    // painted before handing the context back, so drawing the shape and then
    // its handles through two calls erased the shape and left the handles
    // floating over nothing.
    const ctx = this.surface.beginLive();

    if (this.canFill) {
      fillPreview(ctx, this.points, style, this.slop(1.5), this.surface);
    } else {
      // Two points are a line and one is a dot: there is nothing to fill yet,
      // so what is drawn is the edge so far rather than a shape it is not.
      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
      ctx.lineWidth = this.slop(1.5);
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
    }

    this.handles(ctx);
    this.surface.endLive(boundsOf(this.points, pad));
  }

  /**
   * The corners themselves, on top of the shape.
   *
   * The first one is drawn filled while closing is available, because that is
   * the corner a tap means something on — the affordance and the gesture are
   * then the same mark.
   */
  private handles(ctx: CanvasRenderingContext2D): void {
    const r = this.slop(HANDLE_PX);
    ctx.lineWidth = this.slop(1.5);
    this.points.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
      const closer = index === 0 && this.canFill;
      ctx.fillStyle = closer ? ACCENT : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = closer ? "#ffffff" : ACCENT;
      ctx.stroke();
    });
  }

  /** Which corner a press at this point takes hold of, or −1 for none. */
  private nearest(x: number, y: number): number {
    const reach = this.slop(HANDLE_HIT_PX);
    let best = -1;
    let bestDistance = reach;
    this.points.forEach((point, index) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  /** Screen pixels as world units, so a handle is one size at every zoom. */
  private slop(screenPx: number): number {
    return this.surface.worldPerScreenPixel * screenPx;
  }
}
