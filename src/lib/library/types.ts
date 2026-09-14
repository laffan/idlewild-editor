/**
 * What a pattern and a shape *are*, independently of where they are kept.
 *
 * Both come across from
 * [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator)
 * unchanged, because the point of carrying them over is that a pattern drawn
 * there and a pattern drawn here are the same record. A pattern is a square
 * of ones and zeroes; a shape is one or more paths in a 0–1 box. Neither
 * knows anything about a grid, a colour or a project — they are the *ink*,
 * and where it lands is somebody else's question.
 *
 * The one addition is `id` and `name`. Upstream a pattern is a key in a
 * global object and its name is that key; here they are rows in a library
 * somebody reorders, renames and duplicates, so identity has to outlive the
 * label.
 */

/** A point on a path, in the shape's own 0–1 box. */
export interface Vertex {
  x: number;
  y: number;
  /**
   * The bezier handles, **relative to the vertex** and in the same 0–1 scale.
   *
   * Absent or zero on both sides means a corner: the segment either side of
   * it is a straight line. That is upstream's encoding and it is worth
   * keeping — it makes a polygon a list of plain `{x, y}` and a curve a list
   * of the same points with handles hung off them, so the two are one format
   * rather than two.
   */
  ctrlLeft?: { x: number; y: number };
  ctrlRight?: { x: number; y: number };
}

/** One subpath. `closed` defaults to true — a tile shape is an area. */
export interface SubPath {
  vertices: Vertex[];
  closed?: boolean;
}

/**
 * A shape: one path, or several with some of them punched out.
 *
 * The two forms are upstream's and they are kept apart rather than merged,
 * because almost every shape is the simple one and a `paths: [{ vertices }]`
 * wrapper around a square would be noise in twenty-odd files. `pathsOf`
 * reads either.
 *
 * `holePathIndices` says which of the subpaths are holes. They are cut with
 * `destination-out` rather than with an even-odd fill, which is what lets a
 * hole work over artwork already on the canvas — see `shape-path.ts`.
 */
export interface ShapeData {
  vertices?: Vertex[];
  closed?: boolean;
  paths?: SubPath[];
  holePathIndices?: number[];
  /** Legacy even-odd shapes, before holes were cut explicitly. */
  fillRule?: "evenodd";
}

/** A shape in the library: the geometry, plus who it is. */
export interface ShapeDef extends ShapeData {
  id: string;
  name: string;
}

/**
 * A pattern: a square of ones and zeroes, and how wide that square is.
 *
 * `pixels` is row-major and `size` is its side. Both are stored rather than
 * one derived from the other because a pattern arrives from an uploaded
 * image, a resize and a hand-drawn grid, and a mismatch between them is a
 * thing to repair — see `normalisePattern` — rather than a thing to crash on.
 */
export interface PatternData {
  size: number;
  pixels: number[][];
}

export interface PatternDef extends PatternData {
  id: string;
  name: string;
}

/** Every subpath of a shape, however it was written down. */
export function pathsOf(shape: ShapeData): SubPath[] {
  if (shape.paths && shape.paths.length > 0) return shape.paths;
  if (shape.vertices) return [{ vertices: shape.vertices, closed: shape.closed }];
  return [];
}

/** Whether a subpath index is one of the shape's holes. */
export function isHole(shape: ShapeData, index: number): boolean {
  return (shape.holePathIndices ?? []).includes(index);
}

/** A deep copy. Both records are plain data, so this is the whole of it. */
export function copyShape<T extends ShapeData>(shape: T): T {
  return JSON.parse(JSON.stringify(shape)) as T;
}

export function copyPattern<T extends PatternData>(pattern: T): T {
  return {
    ...pattern,
    pixels: pattern.pixels.map((row) => [...row]),
  };
}

/** An empty pattern grid of the given side. */
export function emptyPattern(size: number): PatternData {
  const pixels: number[][] = [];
  for (let row = 0; row < size; row++) pixels.push(new Array(size).fill(0));
  return { size, pixels };
}

/**
 * A pattern with its rows and columns made to agree with its own `size`.
 *
 * Anything that reads a pattern indexes it by `row % size`, so a short row is
 * an `undefined` where a 0 or a 1 was expected. Rather than guard at every
 * read — there are a dozen, in three files, some of them in a loop that runs
 * per frame — a pattern is repaired once on the way in.
 */
export function normalisePattern(pattern: PatternData): PatternData {
  const size = Math.max(1, Math.round(pattern.size || pattern.pixels.length || 1));
  const pixels: number[][] = [];
  for (let row = 0; row < size; row++) {
    const source = pattern.pixels[row] ?? [];
    const out: number[] = [];
    for (let col = 0; col < size; col++) out.push(source[col] === 1 ? 1 : 0);
    pixels.push(out);
  }
  return { size, pixels };
}

/** The ones and the zeroes swapped over. */
export function invertPattern(pattern: PatternData): PatternData {
  return {
    size: pattern.size,
    pixels: pattern.pixels.map((row) => row.map((v) => (v === 1 ? 0 : 1))),
  };
}

/** Whether the pattern has anything in it at all. */
export function patternIsEmpty(pattern: PatternData): boolean {
  return !pattern.pixels.some((row) => row.some((v) => v === 1));
}

/**
 * Resize a pattern's grid, keeping what is drawn.
 *
 * Growing **tiles** rather than pads, which is upstream's choice and the
 * right one: a pattern is a thing that repeats, so the honest way to see it
 * at twice the resolution is to see two of it. Shrinking keeps the top-left
 * corner, because there is no reading of "half a pattern" that is not a crop.
 */
export function resizePattern(pattern: PatternData, size: number): PatternData {
  const old = pattern.size;
  const pixels: number[][] = [];
  for (let row = 0; row < size; row++) {
    const out: number[] = [];
    for (let col = 0; col < size; col++) {
      if (size > old && old > 0) {
        out.push(pattern.pixels[row % old]?.[col % old] === 1 ? 1 : 0);
      } else {
        out.push(pattern.pixels[row]?.[col] === 1 ? 1 : 0);
      }
    }
    pixels.push(out);
  }
  return { size, pixels };
}

/** The pattern shifted, wrapping — what the editor's space-drag applies. */
export function offsetPattern(
  pattern: PatternData,
  dx: number,
  dy: number,
): PatternData {
  const size = pattern.size;
  const pixels: number[][] = [];
  for (let row = 0; row < size; row++) {
    const out: number[] = [];
    for (let col = 0; col < size; col++) {
      const srcRow = ((row - dy) % size + size) % size;
      const srcCol = ((col - dx) % size + size) % size;
      out.push(pattern.pixels[srcRow]?.[srcCol] === 1 ? 1 : 0);
    }
    pixels.push(out);
  }
  return { size, pixels };
}
