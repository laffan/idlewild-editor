/**
 * SVG in and out, so a shape can come from — or go to — anything else.
 *
 * Upstream offers the same two buttons, and they matter more here than they
 * look: the library is per install, so an SVG is how a shape you drew on one
 * machine reaches another, and how a shape drawn in a real vector editor gets
 * into a tileset.
 *
 * **What is read**: `path` (M, L, H, V, C, S, Q, T, Z, relative or absolute),
 * `polygon`, `polyline`, `rect`, `circle` and `ellipse`. Arcs — `A` — are
 * not, and a file using them comes back with those segments as straight lines
 * rather than silently wrong curves. Everything is normalised by the
 * `viewBox` and then scaled to fill the 0–1 box, because a shape is a tile
 * and a tile fills its space.
 *
 * **What is written** is one `<path>` per subpath in a 0–100 viewBox, with
 * holes marked by `fill-rule="evenodd"` on a single element — which is how
 * every other tool will read a shape with a hole in it.
 */

import { BEZIER_CIRCLE, type Vertex } from "../../lib/library";
import { pathsBounds } from "./geometry";
import type { EditPath } from "./state";

const OUT_SIZE = 100;

/** The shape as an SVG document. */
export function pathsToSvg(paths: readonly EditPath[]): string {
  const body = paths
    .map((path) => `    <path d="${pathData(path)}" />`)
    .join("\n");
  const holes = paths.some((p) => p.hole);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OUT_SIZE} ${OUT_SIZE}">`,
    `  <g fill="#000000"${holes ? ' fill-rule="evenodd"' : ""}>`,
    body,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

function pathData(path: EditPath): string {
  const at = (v: Vertex) => `${round(v.x * OUT_SIZE)} ${round(v.y * OUT_SIZE)}`;
  const control = (v: Vertex, side: "left" | "right") => {
    const c = side === "left" ? v.ctrlLeft : v.ctrlRight;
    return `${round((v.x + (c?.x ?? 0)) * OUT_SIZE)} ${round((v.y + (c?.y ?? 0)) * OUT_SIZE)}`;
  };
  const live = (c?: { x: number; y: number }) => !!c && (c.x !== 0 || c.y !== 0);

  if (path.vertices.length === 0) return "";
  const out: string[] = [`M ${at(path.vertices[0])}`];
  const count = path.closed ? path.vertices.length : path.vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const from = path.vertices[i];
    const to = path.vertices[(i + 1) % path.vertices.length];
    if (live(from.ctrlRight) || live(to.ctrlLeft)) {
      out.push(`C ${control(from, "right")} ${control(to, "left")} ${at(to)}`);
    } else {
      out.push(`L ${at(to)}`);
    }
  }
  if (path.closed) out.push("Z");
  return out.join(" ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Read an SVG into paths, scaled to fill the 0–1 box.
 *
 * Returns null when there is nothing in it this understands — which is a
 * message to show rather than an empty shape to save over somebody's work.
 */
export function svgToPaths(text: string): EditPath[] | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  const view = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const box =
    view.length === 4 && view.every(Number.isFinite)
      ? { x: view[0], y: view[1], w: view[2], h: view[3] }
      : {
          x: 0,
          y: 0,
          w: Number(svg.getAttribute("width")) || 100,
          h: Number(svg.getAttribute("height")) || 100,
        };
  const unit = (x: number, y: number) => ({
    x: (x - box.x) / (box.w || 1),
    y: (y - box.y) / (box.h || 1),
  });

  const paths: EditPath[] = [];
  const evenOdd =
    svg.querySelector('[fill-rule="evenodd"]') !== null ||
    svg.getAttribute("fill-rule") === "evenodd";

  for (const node of svg.querySelectorAll("path, polygon, polyline, rect, circle, ellipse")) {
    paths.push(...readElement(node, unit));
  }
  if (paths.length === 0) return null;

  // An even-odd file marks its holes by winding rather than by saying which
  // ring is a hole, so the smaller rings inside a larger one are the holes.
  if (evenOdd && paths.length > 1) markInnerAsHoles(paths);

  // Fill the box: a tile shape that arrived as a small mark in the corner of
  // a big canvas is a shape nobody can use.
  const bounds = pathsBounds(paths);
  if (bounds.width > 0 && bounds.height > 0) {
    const sx = 1 / bounds.width;
    const sy = 1 / bounds.height;
    for (const path of paths) {
      for (const vertex of path.vertices) {
        vertex.x = (vertex.x - bounds.x) * sx;
        vertex.y = (vertex.y - bounds.y) * sy;
        if (vertex.ctrlLeft) {
          vertex.ctrlLeft.x *= sx;
          vertex.ctrlLeft.y *= sy;
        }
        if (vertex.ctrlRight) {
          vertex.ctrlRight.x *= sx;
          vertex.ctrlRight.y *= sy;
        }
      }
    }
  }
  return paths;
}

type ToUnit = (x: number, y: number) => { x: number; y: number };

function readElement(node: Element, unit: ToUnit): EditPath[] {
  const tag = node.tagName.toLowerCase();
  const num = (name: string, fallback = 0) => {
    const value = Number(node.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  };

  if (tag === "path") return parsePathData(node.getAttribute("d") ?? "", unit);

  if (tag === "polygon" || tag === "polyline") {
    const numbers = (node.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite);
    const vertices: Vertex[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) vertices.push(unit(numbers[i], numbers[i + 1]));
    return vertices.length >= 2
      ? [{ vertices, closed: tag === "polygon", hole: false }]
      : [];
  }

  if (tag === "rect") {
    const x = num("x");
    const y = num("y");
    const w = num("width");
    const h = num("height");
    if (w <= 0 || h <= 0) return [];
    return [
      {
        vertices: [unit(x, y), unit(x + w, y), unit(x + w, y + h), unit(x, y + h)],
        closed: true,
        hole: false,
      },
    ];
  }

  // A circle is an ellipse with one radius.
  const cx = num("cx");
  const cy = num("cy");
  const r = num("r");
  const rx = tag === "circle" ? r : num("rx");
  const ry = tag === "circle" ? r : num("ry");
  if (rx <= 0 || ry <= 0) return [];
  const bx = BEZIER_CIRCLE * rx;
  const by = BEZIER_CIRCLE * ry;
  const point = (x: number, y: number, lx: number, ly: number, rxo: number, ryo: number): Vertex => {
    const p = unit(x, y);
    const zero = unit(0, 0);
    const scale = (dx: number, dy: number) => {
      const moved = unit(dx, dy);
      return { x: moved.x - zero.x, y: moved.y - zero.y };
    };
    return { ...p, ctrlLeft: scale(lx, ly), ctrlRight: scale(rxo, ryo) };
  };
  return [
    {
      vertices: [
        point(cx, cy - ry, -bx, 0, bx, 0),
        point(cx + rx, cy, 0, -by, 0, by),
        point(cx, cy + ry, bx, 0, -bx, 0),
        point(cx - rx, cy, 0, by, 0, -by),
      ],
      closed: true,
      hole: false,
    },
  ];
}

/**
 * Walk an SVG path string.
 *
 * Each subpath becomes a path of its own; every curve command is normalised
 * to a cubic, because that is what the library stores and a quadratic has an
 * exact cubic form. Handles are kept **relative to their vertex**, which is
 * the only conversion this does.
 */
function parsePathData(d: string, unit: ToUnit): EditPath[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtZzAa]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const paths: EditPath[] = [];
  let vertices: Vertex[] = [];
  let closed = false;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  /** The last cubic's second control, for the smooth commands. */
  let lastControl: { x: number; y: number } | null = null;

  const flush = () => {
    if (vertices.length >= 2) paths.push({ vertices, closed, hole: false });
    vertices = [];
    closed = false;
  };
  const push = (vx: number, vy: number) => vertices.push(unit(vx, vy));
  const offset = (ax: number, ay: number, bx: number, by: number) => {
    const a = unit(ax, ay);
    const b = unit(bx, by);
    return { x: b.x - a.x, y: b.y - a.y };
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/[a-z]/i.test(token)) {
      command = token;
      i++;
      if (command === "Z" || command === "z") {
        closed = true;
        flush();
        x = startX;
        y = startY;
        continue;
      }
    }
    const next = () => Number(tokens[i++]);
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === "M") {
      const nx = next() + (relative ? x : 0);
      const ny = next() + (relative ? y : 0);
      flush();
      x = nx;
      y = ny;
      startX = x;
      startY = y;
      push(x, y);
      // A run of pairs after an M is an implicit run of Ls.
      command = relative ? "l" : "L";
      lastControl = null;
      continue;
    }
    if (upper === "L") {
      x = next() + (relative ? x : 0);
      y = next() + (relative ? y : 0);
      push(x, y);
      lastControl = null;
      continue;
    }
    if (upper === "H") {
      x = next() + (relative ? x : 0);
      push(x, y);
      lastControl = null;
      continue;
    }
    if (upper === "V") {
      y = next() + (relative ? y : 0);
      push(x, y);
      lastControl = null;
      continue;
    }
    if (upper === "C" || upper === "S") {
      const c1x: number = upper === "S" ? (lastControl ? x * 2 - lastControl.x : x) : next() + (relative ? x : 0);
      const c1y: number = upper === "S" ? (lastControl ? y * 2 - lastControl.y : y) : next() + (relative ? y : 0);
      const c2x = next() + (relative ? x : 0);
      const c2y = next() + (relative ? y : 0);
      const ex = next() + (relative ? x : 0);
      const ey = next() + (relative ? y : 0);

      const from = vertices[vertices.length - 1];
      if (from) from.ctrlRight = offset(x, y, c1x, c1y);
      push(ex, ey);
      const to = vertices[vertices.length - 1];
      if (to) to.ctrlLeft = offset(ex, ey, c2x, c2y);
      lastControl = { x: c2x, y: c2y };
      x = ex;
      y = ey;
      continue;
    }
    if (upper === "Q" || upper === "T") {
      // One control rather than two, and the endpoint has to be read before
      // either cubic control can be worked out — a quadratic's cubic form is
      // `C1 = P0 + ⅔(Q − P0)`, `C2 = P1 + ⅔(Q − P1)`, and `P1` is the end.
      // Annotated, because `lastControl` is a `let` union that these two go
      // on to be assigned into — without a type here the checker chases its
      // own tail through the narrowing.
      const qx: number = upper === "T"
        ? (lastControl ? x * 2 - lastControl.x : x)
        : next() + (relative ? x : 0);
      const qy: number = upper === "T"
        ? (lastControl ? y * 2 - lastControl.y : y)
        : next() + (relative ? y : 0);
      const ex = next() + (relative ? x : 0);
      const ey = next() + (relative ? y : 0);

      const c1x = x + (2 / 3) * (qx - x);
      const c1y = y + (2 / 3) * (qy - y);
      const c2x = ex + (2 / 3) * (qx - ex);
      const c2y = ey + (2 / 3) * (qy - ey);

      const from = vertices[vertices.length - 1];
      if (from) from.ctrlRight = offset(x, y, c1x, c1y);
      push(ex, ey);
      const to = vertices[vertices.length - 1];
      if (to) to.ctrlLeft = offset(ex, ey, c2x, c2y);
      lastControl = { x: qx, y: qy };
      x = ex;
      y = ey;
      continue;
    }
    if (upper === "A") {
      // Arcs are not converted — see the note at the top. The endpoint is
      // taken and the segment comes through as a straight line.
      next();
      next();
      next();
      next();
      next();
      x = next() + (relative ? x : 0);
      y = next() + (relative ? y : 0);
      push(x, y);
      lastControl = null;
      continue;
    }
    // Something unrecognised: step over it rather than spinning.
    i++;
  }
  flush();
  return paths;
}

/** Rings wholly inside another ring are its holes. */
function markInnerAsHoles(paths: EditPath[]): void {
  const boxes = paths.map((path) => pathsBounds([path]));
  paths.forEach((path, i) => {
    const inner = boxes[i];
    const swallowed = boxes.some(
      (outer, j) =>
        j !== i &&
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height &&
        outer.width * outer.height > inner.width * inner.height,
    );
    path.hole = swallowed;
  });
}
