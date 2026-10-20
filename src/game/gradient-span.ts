/**
 * A gradient laid over a fixed stretch of the world rather than over the view.
 *
 * A backdrop follows the camera, which is right for a flat colour and for a
 * game, whose screen *is* the view. A print project's sheets are not the view:
 * they are fixed rectangles of world, side by side, and a sky running from one
 * edge of a spread to the other has to be the same sky however the canvas is
 * panned, and come out of each artboard as that artboard's part of it. So on
 * a print project a gradient spans the box round every artboard (`spanOf`),
 * the editor draws it there, and `ExportForPrint()` reads each artboard's
 * slice of it — see `print.js`'s `readBoards`.
 *
 * Phaser fills a rectangle from four corner colours, which is exact for a
 * linear gradient across that rectangle and nothing else; past the span the
 * gradient holds its end colours, which bends it. So the view is cut along the
 * span's edges into up to nine cells (`gradientCells`), each filled from its
 * own corners: the span itself exactly, and outside it — where a print
 * project's canvas is shaded anyway — near enough.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box round every artboard, or null for a project with none. */
export function spanOf(boards: readonly Box[]): Box | null {
  if (boards.length === 0) return null;
  const left = Math.min(...boards.map((b) => b.x));
  const top = Math.min(...boards.map((b) => b.y));
  const right = Math.max(...boards.map((b) => b.x + b.width));
  const bottom = Math.max(...boards.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Where a world point falls along a gradient laid over `box` at `angle`, from
 * 0 at `from` to 1 at `to`, held at the ends past the box. The same reading
 * of the angle as the four-corner fill: zero runs top to bottom, ninety left
 * to right, measured across the box as a unit square.
 */
export function gradientAt(angle: number, box: Box): (x: number, y: number) => number {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = Math.cos(radians);
  const corners = [-0.5, 0.5].flatMap((u) => [-0.5, 0.5].map((v) => u * dx + v * dy));
  const low = Math.min(...corners);
  const span = Math.max(...corners) - low || 1;
  return (x, y) => {
    const u = box.width ? (x - box.x) / box.width - 0.5 : 0;
    const v = box.height ? (y - box.y) / box.height - 0.5 : 0;
    return Math.max(0, Math.min(1, (u * dx + v * dy - low) / span));
  };
}

/** The view cut along the span's edges: the cells worth filling, span first. */
export function gradientCells(view: Box, span: Box): Box[] {
  const cut = (from: number, to: number, a: number, b: number) =>
    [from, Math.max(from, Math.min(to, a)), Math.max(from, Math.min(to, b)), to];
  const xs = cut(view.x, view.x + view.width, span.x, span.x + span.width);
  const ys = cut(view.y, view.y + view.height, span.y, span.y + span.height);
  const cells: Box[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const cell = { x: xs[i], y: ys[j], width: xs[i + 1] - xs[i], height: ys[j + 1] - ys[j] };
      if (cell.width <= 0 || cell.height <= 0) continue;
      if (i === 1 && j === 1) cells.unshift(cell);
      else cells.push(cell);
    }
  }
  return cells;
}

/** Two packed colours, channel by channel, `t` of the way from `a` to `b`. */
export function mix(a: number, b: number, t: number): number {
  const at = Math.max(0, Math.min(1, t));
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * at) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
