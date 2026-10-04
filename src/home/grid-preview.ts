/**
 * The New Project sheet's grid preview, at the foot of the Template group.
 *
 * Template and Grid scale are two words and a number until you have seen the
 * canvas they make: "Isometric, 16" says nothing about how dense a 16 px
 * diamond lattice is, or how few 256 px spaces fit across a window. So the
 * group ends with a strip of that canvas — the editor's ground colour and its
 * lattice in its own line colour, drawn through the same `Grid` the editor
 * draws with, at the zoom the project will open at — and it redraws as either
 * choice changes. Blank shows the bare ground, which is what it is.
 *
 * A canvas rather than a scene: the home screen has no Phaser, and the
 * picture is a few hundred lines.
 */

import { Grid } from "../lib/grid";
import { h } from "../lib/dom";
import type { Projection } from "../lib/types";

/** The editor's ground, `--canvas-bg`, and its lattice's line colour,
 *  `GRID_LINE_COLOR` in `game/grid-renderer.ts` — pinned by a test. */
export const PREVIEW_GROUND = "#d9e6ef";
export const PREVIEW_LINE = "#a9c2d3";

const HEIGHT = 132;

export interface GridPreview {
  root: HTMLElement;
  /** Draw the lattice this template, scale and zoom make. */
  update: (projection: Projection, size: number, zoom: number) => void;
}

/** The spaces a box of world covers, a ring wider so the edges are filled. */
export function cellsCovering(
  grid: Grid,
  box: { x: number; y: number; width: number; height: number },
) {
  const corners = [
    grid.worldToCell({ x: box.x, y: box.y }),
    grid.worldToCell({ x: box.x + box.width, y: box.y }),
    grid.worldToCell({ x: box.x, y: box.y + box.height }),
    grid.worldToCell({ x: box.x + box.width, y: box.y + box.height }),
  ];
  const x0 = Math.min(...corners.map((c) => c.cx)) - 1;
  const x1 = Math.max(...corners.map((c) => c.cx)) + 1;
  const y0 = Math.min(...corners.map((c) => c.cy)) - 1;
  const y1 = Math.max(...corners.map((c) => c.cy)) + 1;
  const out: Array<{ cx: number; cy: number }> = [];
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) out.push({ cx, cy });
  return out;
}

export function gridPreview(): GridPreview {
  const canvas = h("canvas", {
    class: "grid-preview-canvas",
    "aria-hidden": "true",
  }) as HTMLCanvasElement;
  const caption = h("div", { class: "grid-preview-caption" });
  const root = h("div", { class: "grid-preview" }, canvas, caption);
  let last: [Projection, number, number] = ["isometric", 64, 1];

  const draw = () => {
    const [projection, size, zoom] = last;
    const width = Math.max(1, Math.round(root.clientWidth || 560));
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    const grid = new Grid(projection, size);
    caption.textContent =
      projection === "blank"
        ? "Blank · no lattice — nothing snaps"
        : `${projection === "isometric" ? "Isometric" : "Orthogonal"} · ${size} px spaces` +
          (zoom !== 1 ? ` · at ${zoom}×` : "");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = PREVIEW_GROUND;
    ctx.fillRect(0, 0, width, HEIGHT);
    if (!grid.snaps) return;
    // World is drawn at the project's opening zoom, centred like the editor's
    // camera on the origin.
    ctx.translate(width / 2, HEIGHT / 2);
    ctx.scale(zoom, zoom);
    ctx.strokeStyle = PREVIEW_LINE;
    ctx.lineWidth = 1 / zoom;
    const half = { w: width / 2 / zoom, h: HEIGHT / 2 / zoom };
    const cells = cellsCovering(grid, { x: -half.w, y: -half.h, width: half.w * 2, height: half.h * 2 });
    ctx.beginPath();
    for (const cell of cells) {
      const poly = grid.cellPolygon(cell);
      ctx.moveTo(poly[0].x, poly[0].y);
      for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
    }
    ctx.stroke();
  };

  // Laid out only once the sheet is on screen, and again if it is resized.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => draw()).observe(root);
  return {
    root,
    update: (projection, size, zoom) => {
      last = [projection, size, zoom];
      draw();
    },
  };
}
