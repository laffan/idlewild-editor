/**
 * The arrow keys, and what they refuse to move.
 *
 * Two things are worth holding to account. The **pixel** is the point: a
 * nudge that quietly rounded to the nearest grid space would be a second way
 * to do what a drag already does, and the whole reason it exists is that a
 * drag cannot put a sign half a space over a doorway. And the **refusals**
 * are not oversights: a named place is a cell and a run of filled spaces is a
 * set of them, so neither has anywhere between two spaces to go, and rounding
 * one into a move is worse than leaving the key press alone.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { NUDGE_PX, nudgeSelection } from "../nudge-actions";
import type { GameDoc, Layer, Selection } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const GRID = new Grid("orthogonal", 32);

function fixture(patch: Partial<Layer> = {}, locked = false) {
  const layer: Layer = {
    id: "layer-1",
    name: "Ground",
    locked,
    visible: true,
    fills: [],
    placements: [],
    points: [],
    zones: [],
    strokes: [],
    ...patch,
  } as Layer;
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    scenes: [{ id: "scene-main", name: "Main", layers: [layer] }],
    activeSceneId: "scene-main",
  };
  const store = new DocStore("p1", doc);
  const nudge = (selection: Selection, dx: number, dy: number) =>
    nudgeSelection(
      {
        store,
        grid: GRID,
        selection: () => selection,
        adjustingUnit: () => null,
      },
      dx,
      dy,
    );
  return { store, nudge };
}

/** One placed PSD of two layers, standing on the space at 1, 1. */
function placed() {
  return fixture({
    placements: [
      {
        id: "p1",
        psdKey: "hut",
        layerPath: "S | walls",
        x: 32,
        y: 32,
        width: 32,
        height: 32,
        anchor: { cx: 1, cy: 1 },
        instance: "unit-1",
      },
      {
        id: "p2",
        psdKey: "hut",
        layerPath: "S | roof",
        x: 32,
        y: 24,
        width: 32,
        height: 16,
        anchor: { cx: 1, cy: 1 },
        instance: "unit-1",
      },
    ],
  });
}

describe("a placed PSD", () => {
  it("moves one pixel, not one space", () => {
    const { store, nudge } = placed();
    expect(nudge({ kind: "placement", layerId: "layer-1", placementId: "p1" }, 1, 0)).toBe(
      true,
    );
    const walls = store.layer("layer-1")?.placements.find((p) => p.id === "p1");
    expect(walls?.x).toBe(33);
    expect(NUDGE_PX).toBe(1);
  });

  /**
   * Every layer of the file moves, because on the canvas they are one thing —
   * the same rule a drag keeps. A roof that stayed behind while the walls
   * moved a pixel is the bug this guards.
   */
  it("carries every layer of the unit with it", () => {
    const { store, nudge } = placed();
    nudge({ kind: "placement", layerId: "layer-1", placementId: "p1" }, 0, -1);
    const parts = store.layer("layer-1")?.placements ?? [];
    expect(parts.map((p) => p.y)).toEqual([31, 23]);
  });

  /**
   * The anchor is a cell, so it stays one: it is what a grid resize follows,
   * and there is no such thing as half a space to record. A single pixel
   * inside the same space leaves it exactly where it was.
   */
  it("leaves the anchor cell alone for a move inside one space", () => {
    const { store, nudge } = placed();
    nudge({ kind: "placement", layerId: "layer-1", placementId: "p1" }, 1, 1);
    const walls = store.layer("layer-1")?.placements.find((p) => p.id === "p1");
    expect(walls?.anchor).toEqual({ cx: 1, cy: 1 });
  });

  it("refuses a locked layer", () => {
    const { store, nudge } = fixture(
      {
        placements: [
          {
            id: "p1",
            psdKey: "hut",
            layerPath: "root",
            x: 32,
            y: 32,
            width: 32,
            height: 32,
            anchor: { cx: 1, cy: 1 },
          },
        ],
      },
      true,
    );
    expect(nudge({ kind: "placement", layerId: "layer-1", placementId: "p1" }, 1, 0)).toBe(
      false,
    );
    expect(store.layer("layer-1")?.placements[0].x).toBe(32);
  });
});

describe("the marks", () => {
  it("moves a boundary's whole outline", () => {
    const { store, nudge } = fixture({
      zones: [
        {
          id: "z1",
          name: "Wall",
          blocking: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    });
    expect(nudge({ kind: "zone", layerId: "layer-1", zoneId: "z1" }, -1, 0)).toBe(true);
    expect(store.layer("layer-1")?.zones[0].points).toEqual([
      { x: -1, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 10 },
    ]);
  });

  /**
   * A bare rectangle is the fill a drag on blank ground makes, and it owes
   * the lattice nothing — so it is the one that moves.
   */
  it("moves a fill that is a rectangle", () => {
    const { store, nudge } = fixture({
      fills: [
        {
          id: "f1",
          kind: "color",
          cells: [],
          rect: { x: 0, y: 0, width: 64, height: 64 },
          color: "#8b8787",
          walkable: true,
        },
      ],
    });
    expect(nudge({ kind: "fill", layerId: "layer-1", fillId: "f1" }, 0, 1)).toBe(true);
    expect(store.layer("layer-1")?.fills[0].rect).toEqual({
      x: 0,
      y: 1,
      width: 64,
      height: 64,
    });
  });

  it("refuses a fill that is a run of spaces", () => {
    const { store, nudge } = fixture({
      fills: [
        {
          id: "f1",
          kind: "color",
          cells: [
            { cx: 0, cy: 0 },
            { cx: 1, cy: 0 },
          ],
          color: "#8b8787",
          walkable: true,
        },
      ],
    });
    expect(nudge({ kind: "fill", layerId: "layer-1", fillId: "f1" }, 1, 0)).toBe(false);
    expect(store.layer("layer-1")?.fills[0].cells).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
  });

  it("refuses a named place, which is a space", () => {
    const { store, nudge } = fixture({
      points: [{ id: "pt1", name: "Start", cell: { cx: 2, cy: 2 } }],
    });
    expect(nudge({ kind: "point", layerId: "layer-1", pointId: "pt1" }, 1, 0)).toBe(false);
    expect(store.layer("layer-1")?.points[0].cell).toEqual({ cx: 2, cy: 2 });
  });
});

describe("nothing to move", () => {
  it("answers no for a selection of nothing", () => {
    const { nudge } = fixture();
    expect(nudge({ kind: "none" }, 1, 0)).toBe(false);
  });

  /**
   * A layer is a container rather than a position, which is the same reason
   * `shortcuts.ts` keeps the Delete key off one.
   */
  it("answers no for a whole layer", () => {
    const { nudge } = fixture();
    expect(nudge({ kind: "layer", layerId: "layer-1" }, 1, 0)).toBe(false);
  });
});
