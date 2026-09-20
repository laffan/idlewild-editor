/**
 * A platformer plays the same on every grid.
 *
 * The scaffold's side-on physics is written in world pixels — 260 px/s of
 * run, 2200 px/s² of gravity — and a world pixel means nothing on its own. On
 * the 64px default those numbers are a brisk walk and a jump a little over
 * two spaces high; on the 8px grid the New Project sheet offers for pixel art
 * they are the same character crossing thirty-two spaces a second, which is
 * not fast, it is unplayable.
 *
 * So the constants are quoted against 64 and everything is multiplied by how
 * big this project's spaces actually are. What that is worth is measured
 * here in **spaces**: the same run and the same jump, on grids five steps
 * apart, have to come out the same size against the ground they are drawn on.
 *
 * Run against the template itself, the way `walk-depth.test.ts` is: this is
 * the project's own file, Play runs it rather than a second implementation in
 * the editor, and a copy of it in the test suite would be the thing that
 * stayed right while the scaffold drifted.
 */

import { describe, expect, it } from "vitest";
import physicsSource from "../../../src-tauri/templates/platformer/js/shared/physics.js?raw";

interface Body {
  x: number;
  y: number;
  vy: number;
  onGround: boolean;
}

interface Input {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
}

interface Solid {
  x: number;
  y: number;
  width: number;
  height: number;
}

const { createBody, gridScale, stepBody, TUNED_GRID } = moduleOf<{
  createBody: (
    x: number,
    y: number,
    width: number,
    height: number,
    scale?: number,
  ) => Body;
  gridScale: (gridSize: unknown) => number;
  stepBody: (
    body: Body,
    solids: readonly Solid[],
    input: Input,
    dt: number,
  ) => void;
  TUNED_GRID: number;
}>(physicsSource);

/** One sixtieth of a second, which is the frame the template clamps towards. */
const FRAME = 1 / 60;

/**
 * A character on a grid of `size`, standing on a floor one space below it.
 *
 * Everything about it is expressed in spaces — the body is 0.4 by 0.8 of one,
 * as the prefab draws it, and the floor is twenty spaces wide — so the only
 * thing that differs between two of these is the scale.
 */
function world(size: number): { body: Body; solids: Solid[] } {
  const body = createBody(0, 0, size * 0.4, size * 0.8, gridScale(size));
  const solids = [
    { x: -10 * size, y: size * 0.4, width: 20 * size, height: size },
  ];
  return { body, solids };
}

/** Run `frames` of held input, and answer where the body got to, in spaces. */
function run(size: number, input: Input, frames: number) {
  const { body, solids } = world(size);
  let highest = 0;
  for (let n = 0; n < frames; n++) {
    stepBody(body, solids, input, FRAME);
    highest = Math.min(highest, body.y);
  }
  return { across: body.x / size, up: -highest / size };
}

describe("a character on a small grid", () => {
  /**
   * The run is the symptom that started this: an 8px platformer whose
   * character was "unplayably fast". It was not moving faster in pixels — it
   * was moving the same pixels across spaces an eighth of the size.
   */
  it("covers the same ground in spaces as one on the default grid", () => {
    const small = run(8, { right: true }, 60);
    const default_ = run(TUNED_GRID, { right: true }, 60);
    expect(small.across).toBeCloseTo(default_.across, 6);
    // And it is a walk rather than a bolt: a little over four spaces a
    // second, which is the number the template was tuned to on 64px.
    expect(default_.across).toBeGreaterThan(3);
    expect(default_.across).toBeLessThan(5);
  });

  it("jumps the same height in spaces", () => {
    // Long enough to leave the ground, reach the top and come back down.
    const small = run(8, { jump: true }, 90);
    const large = run(256, { jump: true }, 90);
    // Three places rather than more, and the gap is `SKIN`: the hair of
    // clearance a landing leaves is a floating-point defence rather than a
    // distance, so it is deliberately *not* scaled — which makes it a
    // ten-thousandth of a space on an 8px grid and nothing at all on a 256px
    // one. That is the right way round, and it is the whole of the
    // difference between these two jumps.
    expect(small.up).toBeCloseTo(large.up, 3);
    expect(small.up).toBeGreaterThan(1);
  });

  it("still lands on the floor rather than falling through it", () => {
    const { body, solids } = world(8);
    for (let n = 0; n < 120; n++) stepBody(body, solids, {}, FRAME);
    expect(body.onGround).toBe(true);
  });
});

describe("the scale itself", () => {
  it("is one on the grid the numbers were written for", () => {
    expect(gridScale(TUNED_GRID)).toBe(1);
  });

  /**
   * A body made without a scale moves at the 64px numbers, which is what
   * every project scaffolded before this did — so an existing `prefabs/`
   * directory, which is the user's own copy and is never rewritten, goes on
   * playing exactly as it did.
   */
  it("falls back to the old behaviour for a body that carries none", () => {
    const plain = createBody(0, 0, 4, 8);
    const scaled = createBody(0, 0, 4, 8, 1);
    stepBody(plain, [], { right: true }, FRAME);
    stepBody(scaled, [], { right: true }, FRAME);
    expect(plain.x).toBe(scaled.x);
  });

  it("refuses a grid size that is not one", () => {
    expect(gridScale(0)).toBe(1);
    expect(gridScale(-8)).toBe(1);
    expect(gridScale(undefined)).toBe(1);
  });
});

/**
 * The template, run.
 *
 * `export` is stripped and the names are handed back, which is the same trick
 * `walk-depth.test.ts` plays on a marked block — here it is the whole file,
 * because `physics.js` imports nothing and every line of it is the subject.
 */
function moduleOf<T>(source: string): T {
  const body = source.replace(/^export /gm, "");
  const names = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map(
    (match) => match[1],
  );
  return new Function(`${body}\nreturn { ${names.join(", ")} };`)() as T;
}
