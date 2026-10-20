/**
 * Every artboard is read where it is, not where the first one is.
 *
 * `ExportForPrint()` reads each artboard by moving the game's cameras onto
 * it, reading the page, and moving them back, all inside one frame. Phaser 4
 * bakes a camera's scroll into `camera.matrix` in `preRender`, and the page is
 * read through that matrix, so moving the scroll alone left every artboard
 * after the first as a copy of the first. `aim` in `print.js` rebuilds the
 * matrix with the scroll; this pulls it out of the template and runs it
 * against Phaser's own camera and `GetCalcMatrix`, the call `print.js` reads
 * an image's place with.
 */

import { describe, expect, it } from "vitest";
import printSource from "../../../src-tauri/templates/print/js/shared/print.js?raw";
// Phaser's own sources, by path: its package exports nothing but the bundle,
// and the bundle (like its Camera) wants a DOM to load. These two do not.
// @ts-expect-error CommonJS with no types of its own.
import TransformMatrix from "../../../node_modules/phaser/src/gameobjects/components/TransformMatrix.js";
// @ts-expect-error As above.
import GetCalcMatrix from "../../../node_modules/phaser/src/gameobjects/GetCalcMatrix.js";

interface Matrix {
  e: number;
  f: number;
}

type Aim = (
  camera: unknown,
  x: number,
  y: number,
  page?: { width: number; height: number },
) => void;

function loadAim(): Aim {
  const match = printSource.match(/function aim\(camera, x, y, page\) \{[\s\S]*?\n\}/);
  if (!match) throw new Error("print.js has no aim()");
  return new Function(`${match[0]}; return aim;`)() as Aim;
}

/** Where an object standing at `x, y` in the world lands on the page. */
function onPage(camera: unknown, x: number, y: number): [number, number] {
  const object = { x, y, rotation: 0, scaleX: 1, scaleY: 1, scrollFactorX: 1, scrollFactorY: 1 };
  const calc = (GetCalcMatrix(object, camera, undefined, true) as { calc: Matrix }).calc;
  return [calc.e, calc.f];
}

/**
 * The parts of a Phaser camera `aim` and `GetCalcMatrix` read, standing where
 * `preRender` left it on the first artboard: the origin, unscrolled.
 */
function camera(zoom = 1) {
  const cam = {
    width: 612,
    height: 792,
    originX: 0.5,
    originY: 0.5,
    rotation: 0,
    zoomX: zoom,
    zoomY: zoom,
    scrollX: 0,
    scrollY: 0,
    matrix: new TransformMatrix(),
    matrixExternal: new TransformMatrix(),
    matrixCombined: new TransformMatrix(),
    worldView: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      setTo(x: number, y: number, width: number, height: number) {
        Object.assign(cam.worldView, { x, y, width, height });
      },
    },
    setScroll(x: number, y: number) {
      cam.scrollX = x;
      cam.scrollY = y;
      return cam;
    },
  };
  loadAim()(cam, 0, 0);
  return cam;
}

describe("aim", () => {
  it("moves the read, where moving the scroll alone does not", () => {
    const cam = camera();
    cam.setScroll(684, 0);
    // The bug: the matrix still looks at the first artboard.
    expect(onPage(cam, 694, 20)).toEqual([694, 20]);
    loadAim()(cam, 684, 0);
    expect(onPage(cam, 694, 20)).toEqual([10, 20]);
  });

  it("zooms about the camera's middle, as preRender does", () => {
    const cam = camera(2);
    loadAim()(cam, 300, -150);
    // (p - scroll - origin) * zoom + origin, on each axis.
    expect(onPage(cam, 420, 75)).toEqual([(420 - 300 - 306) * 2 + 306, (75 + 150 - 396) * 2 + 396]);
  });

  it("puts the camera back where it was", () => {
    const cam = camera();
    const aim = loadAim();
    aim(cam, 900, 40);
    aim(cam, 0, 0);
    expect(onPage(cam, 15, 25)).toEqual([15, 25]);
  });

  it("moves the world view onto the artboard, at the artboard's size", () => {
    // Backdrops and patterns are drawn over the world view, so an artboard
    // read without moving it had none.
    const cam = camera();
    const aim = loadAim();
    aim(cam, 684, 0, { width: 792, height: 612 });
    expect(cam.worldView).toMatchObject({ x: 684, y: 0, width: 792, height: 612 });
    aim(cam, 0, 0);
    expect(cam.worldView).toMatchObject({ x: 0, y: 0, width: 612, height: 792 });
  });
});
