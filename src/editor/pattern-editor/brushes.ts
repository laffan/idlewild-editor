/**
 * The pattern editor's brushes: which cells a tip covers.
 *
 * Carried over from simple-tileset-generator's `BrushTypes` with its shapes
 * intact — square, round, airbrush, and a custom tip taken from a selection
 * or an image. A tip answers one question, *which cells*, and the caller
 * decides whether that means filling them or rubbing them out; that split is
 * what lets the erase toggle be a toggle rather than a second set of
 * brushes.
 *
 * Every offset comes back **unwrapped**. Wrapping to the grid is the drawing
 * half's job, because a tip that hangs off the right edge has to come back on
 * at the left — that is what makes a pattern edited here seamless without
 * anyone having to think about it.
 */

import type { BrushKind, PatternEditorState } from "./state";

export interface Cell {
  row: number;
  col: number;
}

/** A filled square, `size` across, centred as evenly as an even size allows. */
function squareCells(row: number, col: number, size: number): Cell[] {
  const cells: Cell[] = [];
  const half = Math.floor(size / 2);
  const from = size % 2 === 0 ? -half + 1 : -half;
  for (let dr = from; dr <= half; dr++) {
    for (let dc = from; dc <= half; dc++) cells.push({ row: row + dr, col: col + dc });
  }
  return cells;
}

/** A disc: every cell whose centre is within the radius. */
function roundCells(row: number, col: number, size: number): Cell[] {
  const cells: Cell[] = [];
  const radius = size / 2;
  const reach = Math.ceil(radius);
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      if (Math.hypot(dr, dc) <= radius) cells.push({ row: row + dr, col: col + dc });
    }
  }
  return cells;
}

/**
 * A spray, whose distribution opens out as the density comes down.
 *
 * Upstream's reading, kept: at 3 % the points are spread evenly over the
 * disc, at 100 % they crowd the middle. A spray that was always
 * centre-weighted could not be used to stipple an edge, and one that was
 * always uniform could not be used to build up a solid.
 */
function airbrushCells(row: number, col: number, size: number, density: number): Cell[] {
  const cells: Cell[] = [];
  const seen = new Set<string>();
  const radius = size / 2;
  const count = Math.max(1, Math.floor(size * size * (density / 100)));
  const centreWeight = Math.sqrt(density / 100);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const uniform = Math.sqrt(Math.random()) * radius;
    const centred = Math.random() * Math.random() * radius;
    const distance = uniform * (1 - centreWeight) + centred * centreWeight;
    const cell = {
      row: row + Math.round(Math.sin(angle) * distance),
      col: col + Math.round(Math.cos(angle) * distance),
    };
    const key = `${cell.row},${cell.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(cell);
  }

  if (density > 50 && !seen.has(`${row},${col}`)) cells.push({ row, col });
  return cells;
}

/** A tip somebody made: the grid it holds, scaled up to the brush size. */
function customCells(
  row: number,
  col: number,
  size: number,
  data: number[][] | null,
): Cell[] {
  if (!data || data.length === 0) return [{ row, col }];
  const height = data.length;
  const width = data[0]?.length ?? 0;
  if (width === 0) return [{ row, col }];

  const scale = Math.max(1, Math.floor(size / Math.max(width, height)));
  const halfH = Math.floor((height * scale) / 2);
  const halfW = Math.floor((width * scale) / 2);

  const cells: Cell[] = [];
  for (let br = 0; br < height; br++) {
    for (let bc = 0; bc < width; bc++) {
      if (data[br]?.[bc] !== 1) continue;
      for (let sr = 0; sr < scale; sr++) {
        for (let sc = 0; sc < scale; sc++) {
          cells.push({
            row: row + br * scale + sr - halfH,
            col: col + bc * scale + sc - halfW,
          });
        }
      }
    }
  }
  return cells;
}

/** The cells this tip would touch, laid at a cell. */
export function brushCells(state: PatternEditorState, row: number, col: number): Cell[] {
  switch (state.brush) {
    case "round":
      return roundCells(row, col, state.brushSize);
    case "airbrush":
      return airbrushCells(row, col, state.brushSize, state.density);
    case "custom":
      return customCells(row, col, state.brushSize, state.customBrush);
    default:
      return squareCells(row, col, state.brushSize);
  }
}

/**
 * The same, for the ghost under the pointer.
 *
 * The airbrush shows as a **disc** rather than as a fresh random spray: a
 * preview that re-rolled every frame would be a shimmering cloud saying
 * nothing about where the paint is going to land.
 */
export function brushPreviewCells(
  state: PatternEditorState,
  row: number,
  col: number,
): Cell[] {
  if (state.brush === "airbrush") return roundCells(row, col, state.brushSize);
  return brushCells(state, row, col);
}

/** A little canvas of a tip, for the button that picks it. */
export function brushIcon(
  kind: BrushKind,
  size: number,
  custom: number[][] | null,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "currentColor";
  ctx.fillStyle = "#f3f2f2";

  const pad = 3;
  const inner = size - pad * 2;
  if (kind === "square") {
    ctx.fillRect(pad, pad, inner, inner);
  } else if (kind === "round") {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, inner / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "airbrush") {
    // A fixed constellation, not a fresh spray: a button that changed every
    // time it was drawn would read as a bug.
    const dots = [
      [0, 0], [0.2, 0.1], [-0.15, 0.25], [0.3, -0.2], [-0.25, -0.15],
      [0.1, 0.35], [-0.35, 0.05], [0.15, -0.3], [-0.1, -0.35], [0.4, 0.2],
      [-0.2, 0.4], [0.35, -0.1], [-0.4, -0.2], [0.05, 0.5], [-0.3, -0.4],
    ];
    const dot = Math.max(1, size / 12);
    for (const [dx, dy] of dots) {
      ctx.fillRect(
        size / 2 + dx * (inner / 2) - dot / 2,
        size / 2 + dy * (inner / 2) - dot / 2,
        dot,
        dot,
      );
    }
  } else if (custom && custom.length > 0) {
    const height = custom.length;
    const width = custom[0]?.length ?? 0;
    const step = Math.max(1, Math.floor(inner / Math.max(width, height)));
    const ox = pad + (inner - width * step) / 2;
    const oy = pad + (inner - height * step) / 2;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (custom[row]?.[col] === 1) ctx.fillRect(ox + col * step, oy + row * step, step, step);
      }
    }
  }
  return canvas;
}

/**
 * Read an image as a one-bit tip or pattern.
 *
 * Dark and opaque is a 1; everything else is a 0. That is upstream's
 * threshold and it is the one that makes a scanned scribble or a downloaded
 * texture arrive as the marks somebody drew rather than as a grey field.
 */
export function imageToBits(image: HTMLImageElement, max: number): number[][] {
  const size = Math.min(Math.max(image.width, image.height, 1), max);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [[1]];
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const bits: number[][] = [];
  for (let row = 0; row < size; row++) {
    const out: number[] = [];
    for (let col = 0; col < size; col++) {
      const i = (row * size + col) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      out.push(brightness < 128 && data[i + 3] > 128 ? 1 : 0);
    }
    bits.push(out);
  }
  return bits;
}
