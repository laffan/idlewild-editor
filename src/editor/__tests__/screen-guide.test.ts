/**
 * The guide's arithmetic: where the origin lands, and how big the game's
 * screen is on a canvas looking at it through a different zoom.
 *
 * Two properties are the whole point of the mark and neither shows up in a
 * typecheck. At the project's default zoom the boundary has to be the game's
 * window *life size* — that is what makes it a thing you can lay artwork
 * against rather than a decoration. And it has to stay centred on the origin
 * at every zoom, because the crosshair beside it is the claim that those two
 * marks are about the same point.
 */

import { describe, expect, it } from "vitest";
import { guideBox } from "../screen-guide";
import type { Viewport } from "../../drawing";

/** A camera looking at the world origin from the middle of an 800×600 canvas. */
function view(patch: Partial<Viewport> = {}): Viewport {
  const zoom = patch.zoom ?? 1;
  return {
    originX: -400 / zoom,
    originY: -300 / zoom,
    zoom,
    width: 800,
    height: 600,
    ...patch,
  };
}

const SCREEN = { width: 1200, height: 800 };

describe("the origin", () => {
  it("is where the camera says world 0,0 is", () => {
    const box = guideBox(view(), SCREEN, 1);
    expect(box.x).toBe(400);
    expect(box.y).toBe(300);
  });

  it("moves with the camera, scaled by the zoom", () => {
    // The camera has panned 100 world pixels right, at 2×.
    const box = guideBox(
      { originX: 100, originY: 50, zoom: 2, width: 800, height: 600 },
      SCREEN,
      1,
    );
    expect(box.x).toBe(-200);
    expect(box.y).toBe(-100);
  });
});

describe("the boundary", () => {
  it("is the game's window life size at the project's default zoom", () => {
    for (const zoom of [0.25, 1, 2.5, 4, 8]) {
      const { frame } = guideBox(view({ zoom }), SCREEN, zoom);
      expect(frame.width).toBe(SCREEN.width);
      expect(frame.height).toBe(SCREEN.height);
    }
  });

  /**
   * A camera further in than the game opens at shows *less* world, so the
   * game's screen covers more of the canvas — the ratio of the two zooms and
   * nothing else.
   */
  it("grows as the canvas zooms past the game's own zoom", () => {
    expect(guideBox(view({ zoom: 4 }), SCREEN, 2).frame.width).toBe(2400);
    expect(guideBox(view({ zoom: 1 }), SCREEN, 4).frame.width).toBe(300);
  });

  it("stays centred on the crosshair at every zoom", () => {
    for (const zoom of [0.5, 1, 3, 8]) {
      const { x, y, frame } = guideBox(view({ zoom }), SCREEN, 2);
      // The two marks are a claim about the same point, so the middle of the
      // frame is where the crosshair is, whatever the camera is doing.
      expect(frame.x + frame.width / 2).toBeCloseTo(x, 9);
      expect(frame.y + frame.height / 2).toBeCloseTo(y, 9);
    }
  });

  /**
   * A zoom of zero is a corrupt option rather than a camera, and an infinite
   * width would be an element the browser cannot lay out. The template falls
   * back to 1× — `config.zoom ?? 1` — so this does too.
   */
  it("falls back to 1× rather than dividing by a broken default zoom", () => {
    expect(guideBox(view(), SCREEN, 0).frame.width).toBe(SCREEN.width);
    expect(guideBox(view(), SCREEN, -2).frame.height).toBe(SCREEN.height);
  });
});
