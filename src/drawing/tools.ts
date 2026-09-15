/**
 * What each drawing tool does with a gesture.
 *
 * They all follow the same shape, which is Hush's: a gesture opens a
 * session, every move updates it against a working copy that only the
 * surface reads, and the release writes the document once. An erase drag
 * that slices thirty strokes is one save and one entry in the layer panel's
 * count, not thirty.
 *
 * The one departure is the sweep fill's other half, which is a *shape* being
 * assembled over several gestures rather than one gesture being recorded —
 * see `fill-points.ts`. It keeps this file's session shape at the edges and
 * holds its points between them.
 *
 * ## A move records; a frame paints
 *
 * Every `move` here marks the session dirty and asks for a repaint on the
 * next animation frame rather than painting where it stands. That is Hush's
 * delta #24 applied to the ink — see `frame.ts` for the whole of why — and it
 * is the single largest thing in this file. `getCoalescedEvents` hands a
 * 120 Hz Pencil's samples over several at a time, and a repaint of an
 * in-flight stroke is a smoothing pass over every sample so far plus one
 * `drawImage` per stamp: painting per sample did all of that four or eight
 * times inside one frame and presented exactly one of them.
 *
 * Nothing is dropped by it. The samples are recorded as they arrive; only the
 * *drawing* waits, and it waits for the moment the drawing could first be
 * seen.
 *
 * Each session also tells the surface where it painted, so the next clear
 * covers that rectangle rather than the whole four-thousand-pixel backing —
 * see `Surface.endLive`.
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
import { onFrame } from "./frame";
import { paintRegion } from "./paint-render";
import {
  renderErase,
  renderEraseRegion,
  renderLive,
  STREAMLINE,
} from "./render";
import { patternScaleOf } from "../lib/paint";
import type { AtlasCache } from "./atlas";
import { ERASER_RADIUS, type Bounds, type StrokeStyle } from "./types";

const ACCENT = "#ec3013";

/** A gesture in flight. Each tool answers move and end; none owns the DOM. */
export interface ToolSession {
  move(worldX: number, worldY: number, pressure: number): void;
  end(): void;
}

/** The box a run of points covers, grown by `pad` on every side. */
export function boundsOf(
  points: readonly { x: number; y: number }[],
  pad: number,
): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
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

  /**
   * The samples as the stroke will be *kept*, which is also what is drawn
   * while it is in flight.
   *
   * Smoothing is applied here rather than at render time so the ink under the
   * pointer is the ink that lands in the document — at 100 the preview is
   * already the straight line it will become, which is the only way a setting
   * like this can be aimed.
   *
   * Memoised on the sample count and the setting, which between them say
   * everything about the answer: samples are only ever appended, so a list of
   * the same length is the same list. Without it the frame paint and `end`
   * each ran the fourteen relaxation passes again over the whole stroke.
   */
  let shapedAt = -1;
  let shapedStraight = false;
  let shapedPoints: InkPoint[] = points;
  const shaped = (): InkPoint[] => {
    if (shapedAt === points.length && shapedStraight === straight) {
      return shapedPoints;
    }
    shapedAt = points.length;
    shapedStraight = straight;
    shapedPoints = smoothPoints(points, straight ? 100 : style.smoothing);
    return shapedPoints;
  };

  /**
   * How far past the furthest sample the ink can reach.
   *
   * The brush, because a stamp is laid centred on the path — and, for a
   * Pattern stroke, one lattice cell more: what it fills are whole cells, and
   * the cell the tip's edge lands inside runs on past it.
   */
  const reach =
    style.size +
    (style.paint.kind === "pattern" ? patternScaleOf(style.paint) : 0);

  // An erase is previewed on the **baked** canvas rather than the live one,
  // because a hole has to be cut out of the pixels it is taking away — see
  // `Surface.beginErase`. Everything else about the gesture is the same, down
  // to re-laying the whole mark every frame.
  const paint = (): void => {
    const held = shaped();
    const stream = streamlinePoints(held, STREAMLINE);
    const box = boundsOf(held, reach);
    if (style.erase) {
      renderErase(surface.beginErase(box), stream, style, atlas);
      surface.endEraseFrame();
      return;
    }
    const ctx = surface.beginLive();
    renderLive(ctx, stream, style, atlas);
    surface.endLive(box);
  };
  const frame = onFrame(paint);
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
      // Now rather than on the next frame: the whole point of the hold is
      // that nothing is moving, so nothing else would ask for one.
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
      frame.request();
    },
    end() {
      disarm();
      frame.cancel();
      surface.clearLive();
      // The preview goes back before the stroke goes in: what `apply` stamps
      // is the mark for real, and leaving the preview under it would take the
      // same pixels out twice.
      surface.endErase();
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
  /** Where the disc is, for the cursor the frame paints. */
  let at = { x, y };
  /** Whether a cut since the last frame has left the backing to rebuild. */
  let stale = false;

  const paint = (): void => {
    // The re-bake first, so the cursor is drawn over ink that is current. It
    // is the expensive half and it is why this is on a frame at all: a cut
    // re-lays every stroke on the layer, and an erase drag reports as many
    // samples as a draw does.
    if (stale) {
      stale = false;
      surface.repaint(strokes);
    }
    drawEraserCursor(surface, at.x, at.y);
  };
  const frame = onFrame(paint);

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
    stale = true;
    working(strokes);
  };

  cut(x, y);
  paint();

  return {
    move(mx, my) {
      at = { x: mx, y: my };
      cut(mx, my);
      frame.request();
    },
    end() {
      frame.cancel();
      // The last cut may still be waiting on a frame that will never come, and
      // the document is about to be handed the strokes it produced.
      if (stale) surface.repaint(strokes);
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
  surface.endLive({
    x: x - ERASER_RADIUS,
    y: y - ERASER_RADIUS,
    width: ERASER_RADIUS * 2,
    height: ERASER_RADIUS * 2,
  });
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

  /**
   * The outline as it will be *kept*, which is also what is previewed.
   *
   * The pencil's own smoothing, for the pencil's own reason: an outline swept
   * by hand carries every tremor of it, and a fill's edge shows a tremor more
   * plainly than a line does because there is a flat colour on one side of
   * it. Memoised on the sample count the way `beginDraw` memoises its own —
   * samples are only appended, so a list of the same length is the same list
   * — since both the frame paint and `end` ask for it.
   */
  let shapedAt = -1;
  let shapedPoints: InkPoint[] = points;
  const shaped = (): InkPoint[] => {
    if (shapedAt === points.length) return shapedPoints;
    shapedAt = points.length;
    shapedPoints = smoothPoints(points, style.smoothing);
    return shapedPoints;
  };

  const paint = () => {
    // The shape as it will land, not an outline of where it is being swept:
    // a fill that previewed as a line would be a fill you had to imagine.
    const held = shaped();
    const ctx = surface.beginLive();
    fillPreview(ctx, held, style, surface.worldPerScreenPixel * 1.5, surface);
    surface.endLive(boundsOf(held, surface.worldPerScreenPixel * 2));
  };
  const frame = onFrame(paint);

  return {
    move(mx, my) {
      const last = points[points.length - 1];
      if (Math.hypot(mx - last.x, my - last.y) < 1) return;
      points.push({ x: mx, y: my, pressure: 1 });
      frame.request();
    },
    end() {
      frame.cancel();
      surface.clearLive();
      surface.endErase();
      // Three points is the least that encloses anything; a tap is a miss.
      if (points.length < 3) return;
      store.add(toFlat(shaped()), { ...style, mode: "fill" });
    },
  };
}

/**
 * The swept shape, drawn as it will land.
 *
 * Shared with the point-to-point fill — see `fill-points.ts` — so the two
 * halves of the one tool preview identically: the same translucent inside,
 * the same accent outline.
 *
 * It takes a **context** rather than the surface, and that is load-bearing
 * rather than tidy: `Surface.beginLive` clears the rectangle it last painted
 * before handing the context back, so a caller that opened the live canvas
 * twice in one frame erased its own first half. The point-to-point fill draws
 * the shape and then its corner handles, which is exactly that shape of bug —
 * the shape went down and the handles wiped it, leaving three dots floating
 * over nothing. So opening the canvas is the caller's, once, and this only
 * draws.
 */
export function fillPreview(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  style: Pick<StrokeStyle, "color" | "paint" | "stamp"> & { erase?: boolean },
  lineWidth: number,
  /**
   * The surface, when there is one to cut into.
   *
   * Only an erasing fill wants it: the hole goes into the **baked** canvas
   * rather than onto the live one, because a hole drawn on a layer above only
   * reveals the layer below. The outline stays here on the live canvas either
   * way, so the shape is still marked out while it is being built.
   */
  surface?: Surface,
): void {
  if (points.length === 0) return;

  if (style.erase && surface) {
    renderEraseRegion(surface.beginErase(boundsOf(points, 2)), points, style);
    surface.endEraseFrame();
  } else {
    // The inside, in whatever the fill is made of. A pattern previews as the
    // pattern rather than as its colour: the whole question a preview answers
    // is "is this the shape I want filled with the thing I chose", and half of
    // that was missing while a dither previewed as a flat wash.
    ctx.globalAlpha = 0.7;
    const painted =
      style.paint.kind !== "color" &&
      paintRegion(
        ctx,
        points.map((p) => ({ point: [p.x, p.y] as [number, number], pressure: 1 })),
        style.color,
        style.paint,
        style.stamp,
      );
    if (!painted) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fillStyle = style.color;
      ctx.fill("nonzero");
    }
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
}

// ── zone ────────────────────────────────────────────────────────────────────

/**
 * Sweep an outline and it becomes a boundary.
 *
 * The lasso's gesture with a third ending. That one *finds* the strokes
 * inside the loop and the sweep fill *becomes* one; this one hands the
 * polygon out and lets the shell make a `Zone` of it — which is the only one
 * of the three whose result is not a stroke, so it is the only one that
 * cannot end in the stroke store.
 *
 * Nothing is simplified here. How coarse a boundary may be is a fact about
 * the grid it blocks — see `to-zone.ts` — and the drawing engine knows
 * nothing about grids.
 */
export function beginZone(
  surface: Surface,
  onSweep: (points: readonly { x: number; y: number }[]) => void,
  x: number,
  y: number,
): ToolSession {
  const poly: { x: number; y: number }[] = [{ x, y }];

  const paint = () => {
    const ctx = surface.beginLive();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    // Drawn the way a blocking boundary is drawn on the canvas: a wash inside
    // and a solid edge, so the sweep looks like the thing it is about to be.
    ctx.fillStyle = "rgba(236, 48, 19, 0.14)";
    ctx.fill();
    ctx.lineWidth = surface.worldPerScreenPixel * 2;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    surface.endLive(boundsOf(poly, surface.worldPerScreenPixel * 3));
  };
  const frame = onFrame(paint);

  return {
    move(mx, my) {
      const last = poly[poly.length - 1];
      if (Math.hypot(mx - last.x, my - last.y) < 1) return;
      poly.push({ x: mx, y: my });
      frame.request();
    },
    end() {
      frame.cancel();
      surface.clearLive();
      // Three points is the least that encloses anything; a tap is a miss,
      // and reported as one so the shell can say so rather than guess.
      onSweep(poly.length < 3 ? [] : poly);
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
    surface.endLive(
      boundsOf(
        poly.map(([px, py]) => ({ x: px, y: py })),
        surface.worldPerScreenPixel * 2,
      ),
    );
  };
  const frame = onFrame(paint);

  return {
    move(mx, my) {
      const [lx, ly] = poly[poly.length - 1];
      if (Math.hypot(mx - lx, my - ly) < 1) return;
      poly.push([mx, my]);
      frame.request();
    },
    end() {
      frame.cancel();
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
