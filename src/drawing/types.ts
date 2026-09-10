import type { Stroke } from "../lib/types";

/** The tools the rail exposes once the engine port lands. */
export type DrawingTool = "pencil" | "eraser" | "lasso" | "boundary";

export interface StrokeStyle {
  brushId: number;
  size: number;
  color: string;
  mode: Stroke["mode"];
}

export const DEFAULT_STYLE: StrokeStyle = {
  brushId: 1,
  size: 4,
  color: "#201e1d",
  mode: "ink",
};

/** Axis-aligned bounds in world pixels. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bounding box of a set of strokes, or null when there is nothing. */
export function strokeBounds(strokes: readonly Stroke[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    // Points are stored flat — [x, y, x, y, …] — as the engine keeps them.
    for (let i = 0; i + 1 < stroke.points.length; i += 2) {
      const x = stroke.points[i];
      const y = stroke.points[i + 1];
      const pad = stroke.size / 2;
      minX = Math.min(minX, x - pad);
      minY = Math.min(minY, y - pad);
      maxX = Math.max(maxX, x + pad);
      maxY = Math.max(maxY, y + pad);
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
