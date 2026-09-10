/**
 * Strokes → pixels → PSD.
 *
 * This is the bridge the spec asks for: the user sketches, selects a group of
 * strokes, and hands them to another layer as a PSD (to flesh out elsewhere)
 * or as a boundary zone. The PSD half goes through the same Rust path as any
 * imported image, so a sketch and a dropped PNG arrive at psd-to-phaser
 * identically.
 *
 * The stroke rendering here is a plain quadratic-smoothed path. When Hush's
 * engine lands it brings `stroke-paint.ts`, which re-renders a stroke into a
 * foreign context through the brush atlas; swap this for that call and the
 * rest of the pipeline is unchanged.
 */

import { psd } from "../lib/ipc";
import type { ImportResult } from "../lib/ipc";
import type { Stroke } from "../lib/types";
import { strokeBounds, type Bounds } from "./types";

const PADDING = 8;

export interface Raster {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  bounds: Bounds;
}

/** Render strokes to RGBA on a transparent ground, cropped to their bounds. */
export function rasteriseStrokes(strokes: readonly Stroke[]): Raster | null {
  const bounds = strokeBounds(strokes);
  if (!bounds) return null;

  const width = Math.max(1, Math.ceil(bounds.width) + PADDING * 2);
  const height = Math.max(1, Math.ceil(bounds.height) + PADDING * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.translate(PADDING - bounds.x, PADDING - bounds.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.points.length < 4) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.globalAlpha = stroke.mode === "highlight" ? 0.4 : 1;
    ctx.globalCompositeOperation =
      stroke.mode === "highlight" ? "multiply" : "source-over";

    ctx.beginPath();
    ctx.moveTo(stroke.points[0], stroke.points[1]);
    // Midpoint quadratics: smooth enough for a sketch, and cheap.
    for (let i = 2; i + 3 < stroke.points.length; i += 2) {
      const midX = (stroke.points[i] + stroke.points[i + 2]) / 2;
      const midY = (stroke.points[i + 1] + stroke.points[i + 3]) / 2;
      ctx.quadraticCurveTo(stroke.points[i], stroke.points[i + 1], midX, midY);
    }
    ctx.lineTo(
      stroke.points[stroke.points.length - 2],
      stroke.points[stroke.points.length - 1],
    );
    ctx.stroke();
  }

  return {
    rgba: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    bounds: {
      x: bounds.x - PADDING,
      y: bounds.y - PADDING,
      width,
      height,
    },
  };
}

/**
 * Turn a selection of strokes into a processed PSD in the project, ready to
 * place. Returns null when the selection has nothing to draw.
 */
export async function strokesToPsd(
  projectId: string,
  name: string,
  strokes: readonly Stroke[],
): Promise<ImportResult | null> {
  const raster = rasteriseStrokes(strokes);
  if (!raster) return null;
  return psd.fromRgba(
    projectId,
    name,
    raster.width,
    raster.height,
    toBase64(raster.rgba),
  );
}

function toBase64(bytes: Uint8ClampedArray): string {
  let binary = "";
  const chunk = 0x8000;
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}
