import { describe, expect, it } from "vitest";
import {
  createBody,
  FALL_LIMIT,
  GRAVITY,
  JUMP_SPEED,
  MOVE_SPEED,
  solidsFromDocument,
  stepBody,
  type PlayInput,
} from "../platformer";
import { Grid } from "../../lib/grid";
import type { Layer, Rect } from "../../lib/types";

const STILL: PlayInput = { left: false, right: false, jump: false };
const FRAME = 1 / 60;

/** Ground from x=-500 to x=500, its top surface at y=0. */
const FLOOR: Rect = { x: -500, y: 0, width: 1000, height: 40 };

function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "l1",
    name: "l1",
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    zones: [],
    strokes: [],
    ...over,
  };
}

/** Run the body until it settles, or give up — a test must not hang. */
function settle(
  body: ReturnType<typeof createBody>,
  solids: Rect[],
  input: PlayInput = STILL,
  frames = 200,
): void {
  for (let i = 0; i < frames; i++) stepBody(body, solids, input, FRAME);
}

describe("stepBody", () => {
  it("falls under gravity and lands on top of a solid", () => {
    const body = createBody(0, -200, 20, 40);
    settle(body, [FLOOR]);
    // Standing means the bottom edge is the floor's top edge.
    expect(body.y + body.height / 2).toBeCloseTo(FLOOR.y, 2);
    expect(body.onGround).toBe(true);
    expect(body.vy).toBe(0);
  });

  it("only jumps from the ground", () => {
    const body = createBody(0, -30, 20, 40);
    settle(body, [FLOOR]);

    stepBody(body, [FLOOR], { ...STILL, jump: true }, FRAME);
    expect(body.vy).toBeLessThan(0);
    const rising = body.y;

    // Held in mid-air, the jump does nothing: there is no double jump.
    stepBody(body, [FLOOR], { ...STILL, jump: true }, FRAME);
    expect(body.vy).toBeCloseTo(-JUMP_SPEED + GRAVITY * FRAME * 2, 5);
    expect(body.y).toBeLessThan(rising);
  });

  it("comes back down from a jump", () => {
    const body = createBody(0, -30, 20, 40);
    settle(body, [FLOOR]);
    stepBody(body, [FLOOR], { ...STILL, jump: true }, FRAME);
    settle(body, [FLOOR]);
    expect(body.y + body.height / 2).toBeCloseTo(FLOOR.y, 2);
    expect(body.onGround).toBe(true);
  });

  it("stays put while it is standing still", () => {
    // The bug this pins: a body at rest is touching the floor, and resolving
    // the horizontal axis against a solid it is *standing on* fired it out of
    // the end of the ground — from a standstill, with nothing pressed.
    const body = createBody(0, -200, 20, 40);
    settle(body, [FLOOR]);
    const resting = { x: body.x, y: body.y };
    settle(body, [FLOOR], STILL, 300);

    expect(body.x).toBe(resting.x);
    expect(body.y).toBeCloseTo(resting.y, 2);
    expect(body.onGround).toBe(true);
  });

  it("keeps walking along a wide floor instead of being ejected from it", () => {
    const body = createBody(0, -200, 20, 40);
    settle(body, [FLOOR]);
    settle(body, [FLOOR], { ...STILL, right: true }, 60);

    // A second of walking, not a teleport to the floor's far edge.
    expect(body.x).toBeGreaterThan(MOVE_SPEED * 0.9);
    expect(body.x).toBeLessThan(MOVE_SPEED * 1.1);
    expect(body.onGround).toBe(true);
  });

  it("stops against a wall instead of passing through it", () => {
    const wall: Rect = { x: 100, y: -200, width: 40, height: 200 };
    const body = createBody(0, -30, 20, 40);
    settle(body, [FLOOR, wall]);
    settle(body, [FLOOR, wall], { ...STILL, right: true });

    expect(body.x + body.width / 2).toBeCloseTo(wall.x, 2);
    expect(body.vx).toBe(0);
    expect(body.onGround).toBe(true);
  });

  it("does not catch on the seam between two floor tiles", () => {
    // The reason the axes are moved and resolved separately: a body sliding
    // along a run of boxes must not snag where two of them meet.
    const tiles: Rect[] = [];
    for (let i = -4; i < 8; i++) {
      tiles.push({ x: i * 64, y: 0, width: 64, height: 64 });
    }
    const body = createBody(0, -30, 20, 40);
    settle(body, tiles);
    const start = body.x;
    settle(body, tiles, { ...STILL, right: true }, 60);

    expect(body.x).toBeGreaterThan(start + MOVE_SPEED * 0.9);
    expect(body.onGround).toBe(true);
  });

  it("bumps its head on a ceiling", () => {
    const ceiling: Rect = { x: -100, y: -120, width: 200, height: 20 };
    const body = createBody(0, -30, 20, 40);
    settle(body, [FLOOR, ceiling]);
    stepBody(body, [FLOOR, ceiling], { ...STILL, jump: true }, FRAME);
    settle(body, [FLOOR, ceiling], STILL, 10);

    expect(body.y - body.height / 2).toBeGreaterThanOrEqual(
      ceiling.y + ceiling.height - 0.001,
    );
  });

  it("puts a character that falls out of the world back at its spawn", () => {
    const body = createBody(0, 0, 20, 40);
    settle(body, [], STILL, 600);
    expect(body.y - body.spawnY).toBeLessThan(FALL_LIMIT);
  });

  it("survives a frame long enough to have skipped the floor", () => {
    // A tab left in the background hands back one enormous delta; the caller
    // clamps it, and this pins what the clamp is protecting.
    const body = createBody(0, -30, 20, 40);
    settle(body, [FLOOR]);
    stepBody(body, [FLOOR], STILL, 50 / 1000);
    expect(body.y + body.height / 2).toBeCloseTo(FLOOR.y, 2);
  });
});

describe("solidsFromDocument", () => {
  const grid = new Grid("orthogonal", 32);

  it("takes non-walkable fills as ground and leaves walkable ones alone", () => {
    const solids = solidsFromDocument(grid, [
      layer({
        fills: [
          {
            id: "ground",
            cells: [{ cx: 0, cy: 2 }],
            kind: "color",
            walkable: false,
          },
          {
            id: "path",
            cells: [{ cx: 1, cy: 2 }],
            kind: "color",
            walkable: true,
          },
        ],
      }),
    ]);
    expect(solids).toEqual([{ x: 0, y: 64, width: 32, height: 32 }]);
  });

  it("takes a rectangle fill as it is", () => {
    const rect = { x: 10, y: 20, width: 300, height: 40 };
    const solids = solidsFromDocument(new Grid("blank", 64), [
      layer({
        fills: [{ id: "f", cells: [], rect, kind: "color", walkable: false }],
      }),
    ]);
    expect(solids).toEqual([rect]);
  });

  it("reduces a blocking boundary to its box, and ignores a passable one", () => {
    const solids = solidsFromDocument(grid, [
      layer({
        zones: [
          {
            id: "z1",
            name: "ledge",
            blocking: true,
            points: [
              { x: 0, y: 0 },
              { x: 80, y: 10 },
              { x: 40, y: 30 },
            ],
          },
          {
            id: "z2",
            name: "trigger",
            blocking: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      }),
    ]);
    expect(solids).toEqual([{ x: 0, y: 0, width: 80, height: 30 }]);
  });

  it("ignores a hidden layer", () => {
    const solids = solidsFromDocument(grid, [
      layer({
        visible: false,
        fills: [
          { id: "f", cells: [{ cx: 0, cy: 0 }], kind: "color", walkable: false },
        ],
      }),
    ]);
    expect(solids).toEqual([]);
  });
});
