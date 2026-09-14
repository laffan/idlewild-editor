/**
 * The shapes the library starts with, carried over from
 * [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator).
 *
 * They are tile shapes rather than drawing shapes, and the difference is the
 * whole reason this set is worth having: every one of them fills its 0–1 box
 * in a way that lines up with the one beside it. Half circles meet, quarter
 * circles round a corner, angles make a diagonal run, waves continue. Drop
 * them onto a grid in sequence and what you get is a tileset, which is what
 * the generator they come from is for.
 *
 * `BEZIER_CIRCLE` is the usual four-arc approximation constant. It is spelled
 * out here rather than imported from a maths module because every curve in
 * this file is one of those arcs.
 *
 * One shape is listed that upstream defines and its default palette leaves
 * out: `wavesLow`. It is a real definition sitting in the repo with nothing
 * reaching it, so it is on the end of the list here rather than nowhere.
 */

import type { ShapeDef, SubPath } from "./types";

/** Four of these make a circle out of cubic segments. */
export const BEZIER_CIRCLE = 0.552284749831;

/** One circular subpath, centred and in the 0–1 box. */
function circlePath(cx: number, cy: number, r: number): SubPath {
  const bc = BEZIER_CIRCLE * r;
  return {
    vertices: [
      { x: cx, y: cy - r, ctrlLeft: { x: -bc, y: 0 }, ctrlRight: { x: bc, y: 0 } },
      { x: cx + r, y: cy, ctrlLeft: { x: 0, y: -bc }, ctrlRight: { x: 0, y: bc } },
      { x: cx, y: cy + r, ctrlLeft: { x: bc, y: 0 }, ctrlRight: { x: -bc, y: 0 } },
      { x: cx - r, y: cy, ctrlLeft: { x: 0, y: bc }, ctrlRight: { x: 0, y: -bc } },
    ],
    closed: true,
  };
}

/** A 3×3 field of dots, as upstream generates it. */
function smallDotsPaths(): SubPath[] {
  const paths: SubPath[] = [];
  const r = (1 / 6) * 0.8;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      paths.push(circlePath(col / 3 + 1 / 6, row / 3 + 1 / 6, r));
    }
  }
  return paths;
}

export const DEFAULT_SHAPES: readonly ShapeDef[] = [
  {
    id: "square",
    name: "Square",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  { id: "circle", name: "Circle", paths: [circlePath(0.5, 0.5, 0.5)] },
  {
    id: "triangle",
    name: "Triangle",
    vertices: [
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "diamond",
    name: "Diamond",
    vertices: [
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 },
    ],
    closed: true,
  },
  {
    id: "topTriangle",
    name: "Top triangle",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 0.5 },
    ],
    closed: true,
  },
  {
    id: "bottomTriangle",
    name: "Bottom triangle",
    vertices: [
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "leftTriangle",
    name: "Left triangle",
    vertices: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "rightTriangle",
    name: "Right triangle",
    vertices: [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
    ],
    closed: true,
  },
  {
    id: "angleTopLeft",
    name: "Angle top left",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "angleTopRight",
    name: "Angle top right",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
    closed: true,
  },
  {
    id: "angleBottomLeft",
    name: "Angle bottom left",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "angleBottomRight",
    name: "Angle bottom right",
    vertices: [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "halfCircleBottom",
    name: "Half circle bottom",
    vertices: [
      { x: 0, y: 0, ctrlRight: { x: 0, y: BEZIER_CIRCLE * 0.5 } },
      {
        x: 0.5,
        y: 0.5,
        ctrlLeft: { x: -BEZIER_CIRCLE * 0.5, y: 0 },
        ctrlRight: { x: BEZIER_CIRCLE * 0.5, y: 0 },
      },
      { x: 1, y: 0, ctrlLeft: { x: 0, y: BEZIER_CIRCLE * 0.5 } },
    ],
    closed: true,
  },
  {
    id: "halfCircleTop",
    name: "Half circle top",
    vertices: [
      { x: 0, y: 1, ctrlRight: { x: 0, y: -BEZIER_CIRCLE * 0.5 } },
      {
        x: 0.5,
        y: 0.5,
        ctrlLeft: { x: -BEZIER_CIRCLE * 0.5, y: 0 },
        ctrlRight: { x: BEZIER_CIRCLE * 0.5, y: 0 },
      },
      { x: 1, y: 1, ctrlLeft: { x: 0, y: -BEZIER_CIRCLE * 0.5 } },
    ],
    closed: true,
  },
  {
    id: "halfCircleLeft",
    name: "Half circle left",
    vertices: [
      { x: 0, y: 0, ctrlRight: { x: BEZIER_CIRCLE * 0.5, y: 0 } },
      {
        x: 0.5,
        y: 0.5,
        ctrlLeft: { x: 0, y: -BEZIER_CIRCLE * 0.5 },
        ctrlRight: { x: 0, y: BEZIER_CIRCLE * 0.5 },
      },
      { x: 0, y: 1, ctrlLeft: { x: BEZIER_CIRCLE * 0.5, y: 0 } },
    ],
    closed: true,
  },
  {
    id: "halfCircleRight",
    name: "Half circle right",
    vertices: [
      { x: 1, y: 0, ctrlRight: { x: -BEZIER_CIRCLE * 0.5, y: 0 } },
      {
        x: 0.5,
        y: 0.5,
        ctrlLeft: { x: 0, y: -BEZIER_CIRCLE * 0.5 },
        ctrlRight: { x: 0, y: BEZIER_CIRCLE * 0.5 },
      },
      { x: 1, y: 1, ctrlLeft: { x: -BEZIER_CIRCLE * 0.5, y: 0 } },
    ],
    closed: true,
  },
  {
    id: "quarterCircleTopLeft",
    name: "Quarter circle top left",
    vertices: [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0, ctrlRight: { x: -BEZIER_CIRCLE, y: 0 } },
      { x: 0, y: 1, ctrlLeft: { x: 0, y: -BEZIER_CIRCLE } },
    ],
    closed: false,
  },
  {
    id: "quarterCircleTopRight",
    name: "Quarter circle top right",
    vertices: [
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0, ctrlRight: { x: BEZIER_CIRCLE, y: 0 } },
      { x: 1, y: 1, ctrlLeft: { x: 0, y: -BEZIER_CIRCLE } },
    ],
    closed: false,
  },
  {
    id: "quarterCircleBottomLeft",
    name: "Quarter circle bottom left",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1, ctrlRight: { x: -BEZIER_CIRCLE, y: 0 } },
      { x: 0, y: 0, ctrlLeft: { x: 0, y: BEZIER_CIRCLE } },
    ],
    closed: false,
  },
  {
    id: "quarterCircleBottomRight",
    name: "Quarter circle bottom right",
    vertices: [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1, ctrlRight: { x: BEZIER_CIRCLE, y: 0 } },
      { x: 1, y: 0, ctrlLeft: { x: 0, y: BEZIER_CIRCLE } },
    ],
    closed: false,
  },
  { id: "smallCircle", name: "Small circle", paths: [circlePath(0.5, 0.5, 0.25)] },
  {
    id: "donut",
    name: "Donut",
    holePathIndices: [1],
    paths: [circlePath(0.5, 0.5, 0.4), circlePath(0.5, 0.5, 0.2)],
  },
  {
    id: "bigDots",
    name: "Big dots",
    paths: [
      circlePath(0.25, 0.25, 0.25),
      circlePath(0.75, 0.25, 0.25),
      circlePath(0.25, 0.75, 0.25),
      circlePath(0.75, 0.75, 0.25),
    ],
  },
  { id: "smallDots", name: "Small dots", paths: smallDotsPaths() },
  {
    id: "lineUp",
    name: "Line up",
    vertices: [
      { x: 0.4, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0.6, y: 1 },
      { x: 0.4, y: 1 },
    ],
    closed: true,
  },
  {
    id: "lineAcross",
    name: "Line across",
    vertices: [
      { x: 0, y: 0.4 },
      { x: 1, y: 0.4 },
      { x: 1, y: 0.6 },
      { x: 0, y: 0.6 },
    ],
    closed: true,
  },
  {
    id: "waves",
    name: "Waves",
    vertices: [
      { x: 0, y: 0.5, ctrlRight: { x: 0.08, y: -0.15 } },
      { x: 0.25, y: 0.25, ctrlLeft: { x: -0.08, y: 0 }, ctrlRight: { x: 0.08, y: 0 } },
      { x: 0.5, y: 0.5, ctrlLeft: { x: -0.08, y: -0.15 }, ctrlRight: { x: 0.08, y: 0.15 } },
      { x: 0.75, y: 0.75, ctrlLeft: { x: -0.08, y: 0 }, ctrlRight: { x: 0.08, y: 0 } },
      { x: 1, y: 0.5, ctrlLeft: { x: -0.08, y: 0.15 } },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
  {
    id: "spikes",
    name: "Spikes",
    vertices: [
      { x: 0, y: 1 },
      { x: 0, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0.5 },
      { x: 1, y: 1 },
    ],
    closed: true,
  },
  {
    id: "wavesLow",
    name: "Waves low",
    vertices: [
      { x: 0, y: 0.65, ctrlRight: { x: 0.08, y: -0.1 } },
      { x: 0.25, y: 0.5, ctrlLeft: { x: -0.08, y: 0 }, ctrlRight: { x: 0.08, y: 0 } },
      { x: 0.5, y: 0.65, ctrlLeft: { x: -0.08, y: -0.1 }, ctrlRight: { x: 0.08, y: 0.1 } },
      { x: 0.75, y: 0.8, ctrlLeft: { x: -0.08, y: 0 }, ctrlRight: { x: 0.08, y: 0 } },
      { x: 1, y: 0.65, ctrlLeft: { x: -0.08, y: 0.1 } },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  },
];
