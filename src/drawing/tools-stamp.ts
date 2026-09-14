/**
 * The Shape brush: a gesture that lays tiles rather than a line.
 *
 * Every other tool in this layer records a *path* — a run of samples with
 * pressure, which a brush is then stamped along. This one records **places**.
 * Drag across the canvas and each grid space you cross takes one copy of the
 * selected shape, filling that space exactly; cross it again and nothing
 * happens, because the space already has one.
 *
 * That is the reading the shapes themselves ask for. They come from a tileset
 * generator, where a shape is what fills one tile: half circles meet, quarter
 * circles round a corner, angles make a diagonal. Stamped along a path at the
 * brush's own spacing they would be a row of decorations; stamped into spaces
 * they are a tileset being painted onto the map, which is the thing they were
 * drawn for.
 *
 * **The grid stays outside this file.** The drawing layer knows nothing about
 * projections and must not learn one — an isometric space is a diamond and an
 * orthogonal one is a square, and which is which is the shell's business. So
 * the session is handed a function that answers "what box is at this point",
 * and it is the shell that reads the grid to answer.
 */

import { toFlat, type InkPoint } from "./geometry";
import { onFrame } from "./frame";
import { renderLive } from "./render";
import type { StrokeStore } from "./stroke-store";
import type { Surface } from "./surface";
import { boundsOf, type ToolSession } from "./tools";
import type { StrokeStyle } from "./types";

/** The box one stamp fills, and where it is. */
export interface StampBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the shell answers for a world point: the box a stamp there would fill.
 *
 * Null for a point that has no box — which nothing currently returns, but a
 * grid that one day refuses to answer outside some bound would, and a session
 * that treats null as "nothing to stamp" is a session that never has to be
 * revisited for it.
 */
export type StampBoxAt = (x: number, y: number) => StampBox | null;

export function beginShapeStamp(
  store: StrokeStore,
  surface: Surface,
  atlas: Parameters<typeof renderLive>[3],
  style: StrokeStyle,
  boxAt: StampBoxAt,
  x: number,
  y: number,
): ToolSession {
  /** The corners of the boxes stamped so far, in the order they were laid. */
  const points: InkPoint[] = [];
  /** And the same, as a set, so crossing a space twice is not two tiles. */
  const seen = new Set<string>();
  /** The box every stamp fills. Taken once: a grid does not change mid-drag. */
  let stamp = style.stamp;

  const take = (wx: number, wy: number): boolean => {
    const box = boxAt(wx, wy);
    if (!box) return false;
    const key = `${Math.round(box.x)},${Math.round(box.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    points.push({ x: box.x, y: box.y, pressure: 1 });
    stamp = { width: box.width, height: box.height };
    return true;
  };

  const paint = (): void => {
    const ctx = surface.beginLive();
    renderLive(
      ctx,
      points.map((p) => ({ point: [p.x, p.y] as [number, number], pressure: 1 })),
      { ...style, mode: "shape", stamp },
      atlas,
    );
    // A stamp hangs *down and right* from its corner, so the box it covers
    // reaches a whole cell past the furthest point rather than half of one.
    surface.endLive(growBy(boundsOf(points, 0), stamp));
  };
  const frame = onFrame(paint);

  take(x, y);
  paint();

  return {
    move(mx, my) {
      if (take(mx, my)) frame.request();
    },
    end() {
      frame.cancel();
      surface.clearLive();
      if (points.length === 0) return;
      store.add(toFlat(points), { ...style, mode: "shape", stamp });
    },
  };
}

/** A box grown on its far side by one stamp. */
function growBy(
  bounds: { x: number; y: number; width: number; height: number },
  stamp: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: bounds.x - 1,
    y: bounds.y - 1,
    width: bounds.width + stamp.width + 2,
    height: bounds.height + stamp.height + 2,
  };
}
