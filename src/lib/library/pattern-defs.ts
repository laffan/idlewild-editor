/**
 * The patterns the library starts with, carried over from
 * [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator)
 * pixel for pixel.
 *
 * They are the same fourteen, in the same order, with the same grids: eight
 * patterns on an 8×8 and six dithers on a 4×4. The dithers are a ramp — 25 %
 * through 87.5 % — which is what makes them useful as a *fill*: pick the one
 * that reads as the density you want and the brush reveals it.
 *
 * Nothing here is generated. A checkerboard could be a rule rather than
 * sixty-four numbers, but the whole point of the library is that a built-in
 * pattern and one somebody drew are the same record — a rule would be a
 * second kind, and the first edit to it would have to become one of these
 * anyway.
 */

import type { PatternDef } from "./types";

export const DEFAULT_PATTERNS: readonly PatternDef[] = [
  {
    id: "checkerboard",
    name: "Checkerboard",
    size: 8,
    pixels: [
      [1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
    ],
  },
  {
    id: "diagonalStripes",
    name: "Diagonal stripes",
    size: 8,
    pixels: [
      [1, 0, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 1],
    ],
  },
  {
    id: "dots",
    name: "Dots",
    size: 8,
    pixels: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  {
    id: "horizontalStripes",
    name: "Horizontal stripes",
    size: 8,
    pixels: [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  {
    id: "verticalStripes",
    name: "Vertical stripes",
    size: 8,
    pixels: [
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
    ],
  },
  {
    id: "crosshatch",
    name: "Crosshatch",
    size: 8,
    pixels: [
      [1, 0, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
    ],
  },
  {
    id: "bricks",
    name: "Bricks",
    size: 8,
    pixels: [
      [1, 1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  {
    id: "zigzag",
    name: "Zigzag",
    size: 8,
    pixels: [
      [1, 0, 0, 0, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0, 1, 0],
      [0, 0, 1, 0, 0, 1, 0, 0],
      [0, 0, 0, 1, 1, 0, 0, 0],
      [0, 0, 0, 1, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 1, 0, 0],
      [0, 1, 0, 0, 0, 0, 1, 0],
      [1, 0, 0, 0, 0, 0, 0, 1],
    ],
  },
  {
    id: "ditherLight",
    name: "Dither — light",
    size: 4,
    pixels: [
      [1, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 0],
    ],
  },
  {
    id: "ditherMediumLight",
    name: "Dither — medium light",
    size: 4,
    pixels: [
      [1, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
    ],
  },
  {
    id: "ditherMedium",
    name: "Dither — medium",
    size: 4,
    pixels: [
      [1, 0, 1, 0],
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [0, 0, 0, 0],
    ],
  },
  {
    id: "ditherMediumDense",
    name: "Dither — medium dense",
    size: 4,
    pixels: [
      [1, 0, 1, 0],
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [0, 0, 0, 0],
    ],
  },
  {
    id: "ditherDense",
    name: "Dither — dense",
    size: 4,
    pixels: [
      [1, 0, 1, 0],
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [0, 1, 0, 1],
    ],
  },
  {
    id: "ditherHeavy",
    name: "Dither — heavy",
    size: 4,
    pixels: [
      [1, 1, 1, 0],
      [0, 1, 1, 1],
      [1, 1, 1, 0],
      [1, 0, 1, 1],
    ],
  },
];
