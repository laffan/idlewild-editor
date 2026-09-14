/**
 * Polygon difference — the one boolean the shape editor needs.
 *
 * *Boolean Cut* in simple-tileset-generator takes one path away from another,
 * and upstream does it with Weiler–Atherton. This is Greiner–Hormann, which
 * is the same idea with less bookkeeping: walk both rings, splice the
 * crossings in as shared vertices, label each one as an entry or an exit, and
 * then trace the result by hopping between the rings at every crossing.
 *
 * **The clip ring is walked backwards**, which is the whole of how a
 * difference is made out of an intersection routine: A − B is A ∩ ¬B, and
 * reversing B's winding is what negates it.
 *
 * What it handles: two simple rings, in either winding, crossing any number
 * of times, with a result that may come back as several rings. What it does
 * not: self-intersecting input, and rings that merely touch — a vertex
 * landing exactly on an edge is nudged off it rather than solved, which is
 * the usual bargain and is invisible at a tile's scale. If nothing crosses,
 * the answer is the subject unchanged, or nothing at all when the subject is
 * wholly inside the clip.
 */

import type { Point } from "./types";

interface Node {
  x: number;
  y: number;
  next: Node | null;
  prev: Node | null;
  /** The same crossing, on the other ring. */
  twin: Node | null;
  crossing: boolean;
  entry: boolean;
  used: boolean;
  /** Where along its own segment a crossing sits, for ordering. */
  t: number;
}

function ring(points: readonly Point[]): Node | null {
  if (points.length < 3) return null;
  let first: Node | null = null;
  let last: Node | null = null;
  for (const p of points) {
    const node: Node = {
      x: p.x,
      y: p.y,
      next: null,
      prev: null,
      twin: null,
      crossing: false,
      entry: false,
      used: false,
      t: 0,
    };
    if (!first) first = node;
    if (last) {
      last.next = node;
      node.prev = last;
    }
    last = node;
  }
  if (!first || !last) return null;
  last.next = first;
  first.prev = last;
  return first;
}

function* walk(start: Node): Generator<Node> {
  let node = start;
  do {
    yield node;
    node = node.next as Node;
  } while (node !== start);
}

/** Where two segments cross, as the parameter along each. Null if they do not. */
function crossAt(
  a1: Node,
  a2: Node,
  b1: Node,
  b2: Node,
): { t: number; u: number } | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denom;
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denom;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { t, u };
}

/** Even-odd point-in-polygon, on the ring's own coordinates. */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

/** Splice every crossing into both rings, as shared nodes. */
function insertCrossings(subject: Node, clip: Node): number {
  let count = 0;
  const subjectStarts = [...walk(subject)];
  const clipStarts = [...walk(clip)];

  for (const a1 of subjectStarts) {
    const a2 = segmentEnd(a1);
    for (const b1 of clipStarts) {
      const b2 = segmentEnd(b1);
      const hit = crossAt(a1, a2, b1, b2);
      if (!hit) continue;
      const x = a1.x + (a2.x - a1.x) * hit.t;
      const y = a1.y + (a2.y - a1.y) * hit.t;
      const onA = insert(a1, a2, x, y, hit.t);
      const onB = insert(b1, b2, x, y, hit.u);
      onA.twin = onB;
      onB.twin = onA;
      count++;
    }
  }
  return count;
}

/** The far end of the segment starting at a node, skipping crossings. */
function segmentEnd(node: Node): Node {
  let end = node.next as Node;
  while (end.crossing) end = end.next as Node;
  return end;
}

/** A crossing spliced into a segment, kept in order along it. */
function insert(from: Node, to: Node, x: number, y: number, t: number): Node {
  const node: Node = {
    x,
    y,
    next: null,
    prev: null,
    twin: null,
    crossing: true,
    entry: false,
    used: false,
    t,
  };
  let at = from.next as Node;
  while (at !== to && at.crossing && at.t < t) at = at.next as Node;
  const before = at.prev as Node;
  before.next = node;
  node.prev = before;
  node.next = at;
  at.prev = node;
  return node;
}

/**
 * Label each crossing as an entry into the other ring, or an exit from it.
 *
 * By alternation from a known start, rather than by testing each one: two
 * simple rings cross in and out strictly in turn, and a test per crossing
 * would disagree with itself on the ones that sit exactly on an edge.
 */
function labelEntries(start: Node, startInside: boolean): void {
  let inside = startInside;
  for (const node of walk(start)) {
    if (!node.crossing) continue;
    node.entry = !inside;
    inside = !inside;
  }
}

function toPoints(node: Node): Point[] {
  return [...walk(node)].map((n) => ({ x: n.x, y: n.y }));
}

/**
 * `subject` with `clip` taken out of it.
 *
 * Comes back as zero or more rings. One ring is the ordinary case; two when
 * the cut splits the subject in half; none when the clip swallows it.
 */
export function polygonDifference(
  subject: readonly Point[],
  clip: readonly Point[],
): Point[][] {
  if (subject.length < 3) return [];
  if (clip.length < 3) return [subject.map((p) => ({ ...p }))];

  const a = ring(subject);
  // Reversed: a difference is an intersection with the clip turned inside out.
  const b = ring([...clip].reverse());
  if (!a || !b) return [subject.map((p) => ({ ...p }))];

  const crossings = insertCrossings(a, b);
  if (crossings === 0) {
    // Nothing crosses, so one is wholly inside the other or they are apart.
    if (pointInPolygon(subject[0], clip)) return [];
    return [subject.map((p) => ({ ...p }))];
  }

  // Only the subject's labels are needed. A crossing where the subject
  // *leaves* the clip is where a piece of the answer begins, and the rest of
  // the trace needs no labels at all — see below.
  labelEntries(a, pointInPolygon({ x: a.x, y: a.y }, toPoints(b)));

  const out: Point[][] = [];
  for (const from of walk(a)) {
    if (!from.crossing || from.used || from.entry) continue;

    const piece: Point[] = [];
    let node: Node = from;
    // A step cap rather than a bare loop: a degenerate input that refuses to
    // close would otherwise hang the editor on a stray click, and a shape
    // that comes out wrong is a shape somebody can undo.
    for (let guard = 0; guard < 20_000; guard++) {
      node.used = true;
      if (node.twin) node.twin.used = true;
      piece.push({ x: node.x, y: node.y });

      // **Always forward**, on both rings, and that is the whole trick: the
      // clip was reversed on the way in, so its own forward direction is the
      // one that carves rather than the one that encloses. The answer is made
      // of the subject's arcs outside the clip and the clip's arcs inside the
      // subject, and after the reversal both of those run forwards.
      let step: Node = node;
      do {
        step = step.next as Node;
        if (!step.crossing) piece.push({ x: step.x, y: step.y });
      } while (!step.crossing && step !== node);

      if (!step.twin) break;
      step.used = true;
      step.twin.used = true;
      node = step.twin;
      if (node === from) break;
    }

    const ring = dedupe(piece);
    if (ring.length >= 3) out.push(ring);
  }

  return out;
}

/** Drop points that repeat, which the hop between rings produces at seams. */
function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
    out.pop();
  }
  return out;
}

/** The signed area of a ring — positive one way round, negative the other. */
export function signedArea(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    total += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return total / 2;
}
