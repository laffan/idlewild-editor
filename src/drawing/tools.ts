/**
 * What each drawing tool does with a gesture.
 *
 * All three follow the same shape, which is Hush's: a gesture opens a
 * session, every move updates it against a working copy that only the
 * surface reads, and the release writes the document once. An erase drag
 * that slices thirty strokes is one save and one entry in the layer panel's
 * count, not thirty.
 */

import type { Stroke } from "../lib/types";
import { makeId } from "../lib/doc-store";
import type { StrokeStore } from "./stroke-store";
import type { Surface } from "./surface";
import {
  sliceStroke,
  smoothPoints,
  strokeBox,
  strokeInPolygon,
  streamlinePoints,
  toFlat,
  toPoints,
  type InkPoint,
} from "./geometry";
import { renderLive, STREAMLINE } from "./render";
import type { AtlasCache } from "./atlas";
import { ERASER_RADIUS, type StrokeStyle } from "./types";

const ACCENT = "#ec3013";

/** A gesture in flight. Each tool answers move and end; none owns the DOM. */
export interface ToolSession {
  move(worldX: number, worldY: number, pressure: number): void;
  end(): void;
}

// ── pencil ──────────────────────────────────────────────────────────────────

/** How far the pen may stray and still count as held still, in screen px. */
const HOLD_SLOP_PX = 6;

export interface DrawOptions {
  /**
   * Hold the pen still this long inside a stroke and the rest of it comes out
   * straight. Zero is off.
   *
   * The gesture is the one this editor uses everywhere else — press and wait —
   * and it is latched rather than momentary: once it fires, the stroke is
   * straight until the pen comes up, and the next stroke starts again at
   * whatever the slider says. Pause at the end of a wobbly line and it snaps;
   * pause before drawing and everything after it is a ruled line. Both are the
   * same rule read from different ends.
   *
   * "Still" rather than merely "down", because a stroke that took longer than
   * a second to draw is an ordinary stroke and straightening it would be the
   * editor overruling the hand.
   */
  straightenAfterMs?: number;
}

export function beginDraw(
  store: StrokeStore,
  surface: Surface,
  atlas: AtlasCache,
  style: StrokeStyle,
  x: number,
  y: number,
  pressure: number,
  options: DrawOptions = {},
): ToolSession {
  const points: InkPoint[] = [{ x, y, pressure }];

  // Latched by the hold below, and read by `shaped` rather than written into
  // the style: it is true of this stroke and nothing else.
  let straight = false;

  // The samples as the stroke will be *kept*, which is also what is drawn
  // while it is in flight. Smoothing is applied here rather than at render
  // time so the ink under the pointer is the ink that lands in the document —
  // at 100 the preview is already the straight line it will become, which is
  // the only way a setting like this can be aimed.
  const shaped = () => smoothPoints(points, straight ? 100 : style.smoothing);

  const paint = () => {
    const ctx = surface.beginLive();
    renderLive(ctx, streamlinePoints(shaped(), STREAMLINE), style, atlas);
    surface.endLive();
  };
  paint();

  const holdMs = options.straightenAfterMs ?? 0;
  let timer: number | null = null;
  // Where the hold is being measured from. The pen is never perfectly still,
  // so it is a slop radius rather than an equality — and in world units,
  // because the tolerance that matters is what the hand can see.
  let held = { x, y };

  const arm = (): void => {
    if (!holdMs || straight) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      straight = true;
      // Snap now rather than at the next sample: the whole point of the hold
      // is that nothing is moving, so nothing else would repaint.
      paint();
    }, holdMs);
  };
  const disarm = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  arm();

  return {
    move(mx, my, mp) {
      const last = points[points.length - 1];
      // Sub-pixel samples cost a stamp each and change nothing visible.
      if (Math.hypot(mx - last.x, my - last.y) < 0.5) return;
      points.push({ x: mx, y: my, pressure: mp });
      if (Math.hypot(mx - held.x, my - held.y) > surface.worldPerScreenPixel * HOLD_SLOP_PX) {
        held = { x: mx, y: my };
        arm();
      }
      paint();
    },
    end() {
      disarm();
      surface.clearLive();
      if (points.length < 2) {
        // A tap is not a stroke. Two points is the minimum the streamline
        // needs before it draws anything but a single stamp.
        points.push({ x: points[0].x + 0.01, y: points[0].y, pressure });
      }
      store.add(toFlat(shaped()), style);
    },
  };
}

// ── eraser ──────────────────────────────────────────────────────────────────

/**
 * Hush's slice eraser: the disc cuts a stroke where it passes rather than
 * consuming the whole thing. A stroke that gets cut in two becomes two
 * strokes, which is what makes an eraser useful on a sketch — you can take
 * the middle out of a line and keep both ends.
 */
export function beginErase(
  store: StrokeStore,
  surface: Surface,
  working: (next: Stroke[] | null) => void,
  x: number,
  y: number,
): ToolSession {
  let strokes: Stroke[] = [...store.strokes];
  let changed = false;

  const cut = (cx: number, cy: number) => {
    const next: Stroke[] = [];
    let hit = false;

    for (const stroke of strokes) {
      const box = strokeBox(stroke);
      const reach = ERASER_RADIUS + stroke.size / 2;
      if (
        !box ||
        cx < box.x - reach ||
        cx > box.x + box.width + reach ||
        cy < box.y - reach ||
        cy > box.y + box.height + reach
      ) {
        next.push(stroke);
        continue;
      }

      const pieces = sliceStroke(
        toPoints(stroke.points),
        stroke.size,
        cx,
        cy,
        ERASER_RADIUS,
      );
      if (pieces === null) {
        next.push(stroke);
        continue;
      }

      hit = true;
      // A surviving piece keeps everything but its identity: it is a new
      // stroke, and the immutability the document relies on says so.
      for (const piece of pieces) {
        if (piece.length < 2) continue;
        next.push({ ...stroke, id: makeId("stroke"), points: toFlat(piece) });
      }
    }

    if (!hit) return;
    changed = true;
    strokes = next;
    working(strokes);
    surface.repaint(strokes);
  };

  cut(x, y);
  drawEraserCursor(surface, x, y);

  return {
    move(mx, my) {
      cut(mx, my);
      drawEraserCursor(surface, mx, my);
    },
    end() {
      surface.clearLive();
      working(null);
      if (changed) store.replace(strokes);
    },
  };
}

export function drawEraserCursor(surface: Surface, x: number, y: number): void {
  const ctx = surface.beginLive();
  ctx.beginPath();
  ctx.arc(x, y, ERASER_RADIUS, 0, Math.PI * 2);
  ctx.lineWidth = surface.worldPerScreenPixel * 1.5;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
  surface.endLive();
}

// ── fill ────────────────────────────────────────────────────────────────────

/**
 * Sweep a closed outline and it fills.
 *
 * The lasso's gesture with the opposite ending: that one *finds* the strokes
 * inside the loop, this one *becomes* one. Which makes it the smallest fill
 * worth having — everything else in the engine already knows what to do with
 * a stroke, so it previews, undoes, erases, exports and applies without a
 * line of new plumbing anywhere. A bucket that floods the area under a tap is
 * the next version of this, and it needs a raster of the session to flood.
 */
export function beginFill(
  store: StrokeStore,
  surface: Surface,
  style: StrokeStyle,
  x: number,
  y: number,
): ToolSession {
  const points: InkPoint[] = [{ x, y, pressure: 1 }];

  const paint = () => {
    const ctx = surface.beginLive();
    // The shape as it will land, not an outline of where it is being swept:
    // a fill that previewed as a line would be a fill you had to imagine.
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = style.color;
    ctx.globalAlpha = 0.7;
    ctx.fill("nonzero");
    ctx.globalAlpha = 1;
    ctx.lineWidth = surface.worldPerScreenPixel * 1.5;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    surface.endLive();
  };

  return {
    move(mx, my) {
      const last = points[points.length - 1];
      if (Math.hypot(mx - last.x, my - last.y) < 1) return;
      points.push({ x: mx, y: my, pressure: 1 });
      paint();
    },
    end() {
      surface.clearLive();
      // Three points is the least that encloses anything; a tap is a miss.
      if (points.length < 3) return;
      store.add(toFlat(points), { ...style, mode: "fill" });
    },
  };
}

// ── lasso ───────────────────────────────────────────────────────────────────

/**
 * A freehand region over the strokes. The polygon is drawn on the live
 * canvas as it is swept; on release every stroke with a point inside it is
 * selected, which is Hush's own test — cheap, and forgiving of a loop drawn
 * slightly inside the ink.
 */
export function beginLasso(
  store: StrokeStore,
  surface: Surface,
  onSelect: (ids: string[]) => void,
  x: number,
  y: number,
): ToolSession {
  const poly: [number, number][] = [[x, y]];

  const paint = () => {
    const ctx = surface.beginLive();
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(236, 48, 19, 0.08)";
    ctx.fill();
    ctx.lineWidth = surface.worldPerScreenPixel * 1.5;
    ctx.strokeStyle = ACCENT;
    ctx.setLineDash([
      surface.worldPerScreenPixel * 5,
      surface.worldPerScreenPixel * 4,
    ]);
    ctx.stroke();
    ctx.setLineDash([]);
    surface.endLive();
  };

  return {
    move(mx, my) {
      const [lx, ly] = poly[poly.length - 1];
      if (Math.hypot(mx - lx, my - ly) < 1) return;
      poly.push([mx, my]);
      paint();
    },
    end() {
      surface.clearLive();
      if (poly.length < 3) {
        // A tap clears rather than selecting nothing loudly.
        onSelect([]);
        return;
      }
      onSelect(
        store.strokes.filter((s) => strokeInPolygon(s, poly)).map((s) => s.id),
      );
    },
  };
}
