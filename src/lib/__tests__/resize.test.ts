import { describe, expect, it } from "vitest";
import {
  cornerPoint,
  handleAt,
  oppositeCorner,
  resizeBox,
  type Box,
} from "../../game/resize";

const box: Box = { x: 100, y: 100, width: 200, height: 100 };

describe("corner geometry", () => {
  it("locates each corner", () => {
    expect(cornerPoint(box, "nw")).toEqual({ x: 100, y: 100 });
    expect(cornerPoint(box, "ne")).toEqual({ x: 300, y: 100 });
    expect(cornerPoint(box, "sw")).toEqual({ x: 100, y: 200 });
    expect(cornerPoint(box, "se")).toEqual({ x: 300, y: 200 });
  });

  it("pairs opposites", () => {
    expect(oppositeCorner("nw")).toBe("se");
    expect(oppositeCorner("se")).toBe("nw");
    expect(oppositeCorner("ne")).toBe("sw");
    expect(oppositeCorner("sw")).toBe("ne");
  });
});

describe("handleAt", () => {
  it("hits a corner within tolerance", () => {
    expect(handleAt(box, { x: 302, y: 198 }, 16)).toBe("se");
    expect(handleAt(box, { x: 100, y: 100 }, 16)).toBe("nw");
  });

  it("misses the middle of an edge and the centre", () => {
    expect(handleAt(box, { x: 200, y: 100 }, 16)).toBeUndefined();
    expect(handleAt(box, { x: 200, y: 150 }, 16)).toBeUndefined();
  });

  it("widens with the tolerance, as a zoomed-out view needs", () => {
    expect(handleAt(box, { x: 320, y: 220 }, 16)).toBeUndefined();
    expect(handleAt(box, { x: 320, y: 220 }, 100)).toBe("se");
  });
});

describe("resizeBox", () => {
  it("keeps the opposite corner fixed", () => {
    const next = resizeBox(box, "se", { x: 500, y: 400 });
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
  });

  it("keeps the opposite corner fixed when dragging the top-left", () => {
    const next = resizeBox(box, "nw", { x: 0, y: 0 });
    // The south-east corner must not move.
    expect(next.x + next.width).toBeCloseTo(300);
    expect(next.y + next.height).toBeCloseTo(200);
  });

  it("locks the aspect ratio", () => {
    const next = resizeBox(box, "se", { x: 500, y: 110 });
    expect(next.width / next.height).toBeCloseTo(2);
  });

  it("follows whichever axis the pointer pushed further", () => {
    // Dragged far down but barely right: height leads, width follows.
    const next = resizeBox(box, "se", { x: 310, y: 500 });
    expect(next.height).toBeCloseTo(400);
    expect(next.width).toBeCloseTo(800);
  });

  it("flips the box when the corner is dragged past its anchor", () => {
    const next = resizeBox(box, "se", { x: 0, y: 0 });
    // Growing up and left from the north-west anchor.
    expect(next.x).toBeLessThan(100);
    expect(next.y).toBeLessThan(100);
    expect(next.width).toBeGreaterThan(0);
    expect(next.height).toBeGreaterThan(0);
  });

  it("refuses to collapse below the minimum", () => {
    const next = resizeBox(box, "se", { x: 100, y: 100 });
    expect(next.width).toBeGreaterThanOrEqual(8);
    expect(next.height).toBeGreaterThanOrEqual(8);
    expect(next.width / next.height).toBeCloseTo(2);
  });

  it("holds the minimum for a tall image too", () => {
    const tall: Box = { x: 0, y: 0, width: 50, height: 200 };
    const next = resizeBox(tall, "se", { x: 0, y: 0 });
    expect(next.width).toBeGreaterThanOrEqual(8);
    expect(next.height).toBeGreaterThanOrEqual(8);
    expect(next.width / next.height).toBeCloseTo(0.25);
  });

  it("survives a zero-height original without dividing by zero", () => {
    const flat: Box = { x: 0, y: 0, width: 100, height: 0 };
    const next = resizeBox(flat, "se", { x: 200, y: 200 });
    expect(Number.isFinite(next.width)).toBe(true);
    expect(Number.isFinite(next.height)).toBe(true);
  });
});
