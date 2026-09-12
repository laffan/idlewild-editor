/**
 * The drawing layer's pure half.
 *
 * Everything here came across from Hush's engine, and everything here is
 * what the tools are built out of — a slice that cuts in the wrong place or
 * a lasso that misses is a tool that does not work, and neither shows up in
 * a typecheck.
 */

import { describe, expect, it } from "vitest";
import type { Stroke } from "../../lib/types";
import {
  pointInPolygon,
  simplify,
  sliceStroke,
  smoothPoints,
  strokeBox,
  strokeInPolygon,
  streamlinePoints,
  strokesBox,
  toFlat,
  toPoints,
  type InkPoint,
} from "../geometry";
import { strokesToZonePoints } from "../to-zone";

function line(from: number, to: number, y = 0): InkPoint[] {
  const out: InkPoint[] = [];
  for (let x = from; x <= to; x++) out.push({ x, y, pressure: 0.5 });
  return out;
}

function stroke(points: InkPoint[], over: Partial<Stroke> = {}): Stroke {
  return {
    id: "s1",
    points: toFlat(points),
    brushId: 1,
    size: 4,
    color: "#000000",
    mode: "ink",
    createdAt: 0,
    ...over,
  };
}

describe("points", () => {
  it("round-trips through the document's flat triples", () => {
    const points: InkPoint[] = [
      { x: 1, y: 2, pressure: 0.25 },
      { x: 3, y: 4, pressure: 1 },
    ];
    expect(toFlat(points)).toEqual([1, 2, 0.25, 3, 4, 1]);
    expect(toPoints(toFlat(points))).toEqual(points);
  });

  it("ignores a trailing partial triple rather than inventing a point", () => {
    expect(toPoints([1, 2, 0.5, 9, 9])).toHaveLength(1);
  });
});

describe("streamline", () => {
  it("ends under the pointer, however much it smooths", () => {
    const raw = line(0, 20);
    const last = raw[raw.length - 1];
    for (const amount of [0, 0.5, 1]) {
      const out = streamlinePoints(raw, amount);
      expect(out[out.length - 1].point).toEqual([last.x, last.y]);
    }
  });

  it("lags behind a corner more the higher it is turned up", () => {
    // An L: ten points right, then ten points down.
    const raw: InkPoint[] = [];
    for (let x = 0; x <= 10; x++) raw.push({ x, y: 0, pressure: 0.5 });
    for (let y = 1; y <= 10; y++) raw.push({ x: 10, y, pressure: 0.5 });

    const loose = streamlinePoints(raw, 0);
    const tight = streamlinePoints(raw, 0.9);
    // At the corner index the smoothed path has not caught up with the turn.
    const cornerLoose = loose[11].point[0];
    const cornerTight = tight[11].point[0];
    expect(cornerTight).toBeLessThan(cornerLoose);
  });

  it("holds its ground on an empty trail", () => {
    expect(streamlinePoints([], 0.5)).toEqual([]);
  });
});

describe("smoothing", () => {
  /** How far a point sits off the straight line between the two ends. */
  function offChord(points: readonly InkPoint[]): number {
    const a = points[0];
    const b = points[points.length - 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = 0;
    for (const p of points) {
      const cross =
        (b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y);
      worst = Math.max(worst, Math.abs(cross) / length);
    }
    return worst;
  }

  /** A shaky run along x: every other sample a pixel off the line. */
  function shaky(): InkPoint[] {
    const out: InkPoint[] = [];
    for (let x = 0; x <= 20; x++) {
      out.push({ x, y: x % 2 === 0 ? 1 : -1, pressure: 0.5 });
    }
    return out;
  }

  it("changes nothing at zero", () => {
    const raw = shaky();
    expect(smoothPoints(raw, 0)).toEqual(raw);
  });

  it("draws a perfectly straight line at 100", () => {
    // The promise the top of the slider makes, and the reason the second
    // stage exists at all: relaxation alone only ever approaches this.
    const out = smoothPoints(shaky(), 100);
    expect(offChord(out)).toBeCloseTo(0, 9);
  });

  it("takes the wobble out in between without going straight", () => {
    const raw = shaky();
    const half = smoothPoints(raw, 50);
    expect(offChord(half)).toBeLessThan(offChord(raw));
    expect(offChord(half)).toBeGreaterThan(0);
  });

  it("never moves the two ends", () => {
    const raw = shaky();
    for (const amount of [25, 50, 75, 100]) {
      const out = smoothPoints(raw, amount);
      expect(out[0]).toEqual(raw[0]);
      expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    }
  });

  it("keeps the pressure that was recorded", () => {
    const raw = shaky().map((p, i) => ({ ...p, pressure: i / 20 }));
    const out = smoothPoints(raw, 80);
    expect(out.map((p) => p.pressure)).toEqual(raw.map((p) => p.pressure));
  });

  it("leaves a stroke too short to have a middle alone", () => {
    const two: InkPoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 5, y: 5, pressure: 0.5 },
    ];
    expect(smoothPoints(two, 100)).toEqual(two);
  });

  it("survives a stroke that never left the spot it started on", () => {
    const still: InkPoint[] = [
      { x: 3, y: 3, pressure: 0.5 },
      { x: 3, y: 3, pressure: 0.5 },
      { x: 3, y: 3, pressure: 0.5 },
    ];
    expect(smoothPoints(still, 100)).toEqual(still);
  });
});

describe("bounds", () => {
  it("pads by the brush, because a stamp is wider than its centre", () => {
    const box = strokeBox(stroke(line(0, 10), { size: 4 }));
    expect(box).not.toBeNull();
    // pad = size + 1 on each side.
    expect(box?.x).toBe(-5);
    expect(box?.width).toBe(20);
  });

  it("unions a group", () => {
    const box = strokesBox([
      stroke(line(0, 10), { id: "a", size: 0 }),
      stroke(line(20, 30, 5), { id: "b", size: 0 }),
    ]);
    expect(box?.x).toBeCloseTo(-1);
    expect(box?.x ?? 0 + (box?.width ?? 0)).toBeLessThan(32);
    expect(box?.height).toBeCloseTo(7);
  });

  it("has nothing to say about nothing", () => {
    expect(strokesBox([])).toBeNull();
  });
});

describe("the slice eraser", () => {
  const points = line(0, 100);

  it("leaves a stroke it never touches alone", () => {
    expect(sliceStroke(points, 4, 50, 500, 10)).toBeNull();
  });

  it("cuts a line into the two ends that survive", () => {
    const pieces = sliceStroke(points, 4, 50, 0, 10);
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces as InkPoint[][];
    expect(left[0].x).toBe(0);
    // The cut lands on the disc's edge — radius plus half the brush — not
    // at the nearest recorded sample.
    expect(left[left.length - 1].x).toBeCloseTo(38, 5);
    expect(right[0].x).toBeCloseTo(62, 5);
    expect(right[right.length - 1].x).toBe(100);
  });

  it("takes the whole stroke when the disc covers it", () => {
    expect(sliceStroke(line(0, 4), 4, 2, 0, 40)).toEqual([]);
  });

  it("drops only the end it passes over", () => {
    const pieces = sliceStroke(points, 4, 0, 0, 20);
    expect(pieces).toHaveLength(1);
    expect((pieces as InkPoint[][])[0][0].x).toBeGreaterThan(20);
  });

  it("keeps pressure interpolated across a cut", () => {
    const ramp: InkPoint[] = [
      { x: 0, y: 0, pressure: 0 },
      { x: 100, y: 0, pressure: 1 },
    ];
    const pieces = sliceStroke(ramp, 0, 50, 0, 10) as InkPoint[][];
    const left = pieces[0];
    expect(left[left.length - 1].pressure).toBeCloseTo(0.4, 2);
  });
});

describe("the lasso", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it("knows inside from outside", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });

  it("catches a stroke that only clips the region", () => {
    // Runs from well outside to inside: one point in is enough, which is
    // what makes a loop drawn slightly inside the ink still work.
    expect(strokeInPolygon(stroke(line(-50, 5, 5)), square)).toBe(true);
    expect(strokeInPolygon(stroke(line(-50, -20, 5)), square)).toBe(false);
  });
});

describe("simplify", () => {
  it("reduces a straight run to its ends", () => {
    expect(simplify(line(0, 50), 1)).toHaveLength(2);
  });

  it("keeps the corner of an L", () => {
    const path: InkPoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 5, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 10, y: 5, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.5 },
    ];
    const kept = simplify(path, 0.5);
    expect(kept).toHaveLength(3);
    expect(kept[1]).toEqual({ x: 10, y: 0, pressure: 0.5 });
  });

  it("passes a two-point path straight through", () => {
    expect(simplify(line(0, 1), 1)).toHaveLength(2);
  });
});

describe("strokes → boundary", () => {
  it("closes the outline in the order it was drawn, not the order caught", () => {
    const second = stroke(line(10, 20, 10), { id: "b", createdAt: 200 });
    const first = stroke(line(0, 10), { id: "a", createdAt: 100 });
    const points = strokesToZonePoints([second, first], 64);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 20, y: 10 });
  });

  it("simplifies against the grid rather than keeping every sample", () => {
    const points = strokesToZonePoints([stroke(line(0, 200))], 64);
    expect(points.length).toBeLessThan(6);
  });

  it("refuses a selection with no region in it", () => {
    expect(strokesToZonePoints([], 64)).toEqual([]);
    expect(strokesToZonePoints([stroke(line(0, 1))], 64)).toEqual([]);
  });
});
