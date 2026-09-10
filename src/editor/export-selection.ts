/**
 * Export a grid selection as a transparent PNG.
 *
 * The scene's own renderer paints on an opaque canvas, so a snapshot would
 * carry the grid's blue. Instead the selection is re-rendered into an
 * offscreen canvas from the document, which is also what keeps the export
 * independent of the current zoom.
 */

import type { DocStore } from "../lib/doc-store";
import { Grid, cellsInRange } from "../lib/grid";
import type { Cell } from "../lib/types";

const SCALE = 2;

export function exportSelectionPng(
  store: DocStore,
  grid: Grid,
  from: Cell,
  to: Cell,
): string {
  const bounds = grid.rangeBounds(from, to);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.width * SCALE));
  canvas.height = Math.max(1, Math.ceil(bounds.height * SCALE));

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(SCALE, SCALE);
  ctx.translate(-bounds.x, -bounds.y);

  const selected = new Set(
    [...cellsInRange(from, to)].map((c) => `${c.cx},${c.cy}`),
  );

  // Bottom-up: layers are stored top-first, so paint the list in reverse.
  const layers = [...store.layers].reverse();
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const fill of layer.fills) {
      ctx.fillStyle = fill.color ?? "#ec3013";
      ctx.globalAlpha = fill.kind === "pattern" ? 0.35 : 1;
      for (const cell of fill.cells) {
        if (!selected.has(`${cell.cx},${cell.cy}`)) continue;
        const points = grid.cellPolygon(cell);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const zone of layer.zones) {
      if (zone.points.length < 2) continue;
      ctx.strokeStyle = zone.blocking ? "#ec3013" : "#7d7979";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(zone.points[0].x, zone.points[0].y);
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x, zone.points[i].y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  return canvas.toDataURL("image/png");
}
