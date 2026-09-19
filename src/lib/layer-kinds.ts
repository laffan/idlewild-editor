/**
 * The four kinds of layer, and what each one holds.
 *
 * `types.ts` says what the records are; this says what they mean and what
 * the editor does to them. It is a file of functions over a `Layer` and a
 * handful of edits through `DocStore.editLayer`, in the shape `doc-shape.ts`
 * already has: no state, nothing that has to be constructed, and nothing the
 * store has to grow a method for.
 *
 * The reason it is here rather than in `doc-store.ts` is the line rule at the
 * top of README-TECHNICAL, and it splits cleanly along a real seam. The store
 * is about the document; this is about what one kind of layer means, which is
 * a different question and one the store has no opinion on.
 *
 * **Absent is object.** Every layer written before there was more than one
 * kind has no `kind` field, and every one of them is an object layer — so the
 * migration is a default rather than a rewrite, and a document opened by an
 * older build still reads.
 */

import type { DocStore } from "./doc-store";
import { makeId } from "./doc-shape";
import { cellsInPolygon, type Grid } from "./grid";
import { tileLayersAllowed } from "./tile-layers";
import type {
  Background,
  Cell,
  Layer,
  LayerKind,
  PatternShape,
  PatternSpec,
  PatternType,
  Point,
  Projection,
} from "./types";

/** What a layer is for. Absent means object — see the note above. */
export function layerKind(layer: Layer | undefined): LayerKind {
  return layer?.kind ?? "object";
}

/**
 * What the dropdown under the `+` offers, in the order it offers it.
 *
 * Tile is last and it is the one that is not always there: `available` is
 * read by the panel against the project's own projection, because a tileset
 * is a picture cut into equal spaces and a blank project has none to cut on.
 * A predicate on the row rather than a second list, so a kind that is
 * withheld somewhere is still described in the one place the kinds are.
 */
export const LAYER_KINDS: readonly {
  kind: LayerKind;
  label: string;
  /** The one line under the row that says what it is for. */
  hint: string;
  /** Which projections offer this kind. Absent means all of them. */
  available?: (projection: Projection) => boolean;
}[] = [
  {
    kind: "object",
    label: "Object layer",
    hint: "Things that stand where you put them.",
  },
  {
    kind: "pattern",
    label: "Pattern layer",
    hint: "A PSD's elements scattered across the canvas, on and on.",
  },
  {
    kind: "background",
    label: "Background layer",
    hint: "Colour, a gradient, or painted scenery behind everything.",
  },
  {
    kind: "tile",
    label: "Tile layer",
    hint: "A Tiled map. A PSD on one is a tileset, not a thing on the grid.",
    available: tileLayersAllowed,
  },
];

/** The kinds this project can actually have — what the `+` menu lists. */
export function layerKindsFor(
  projection: Projection,
): typeof LAYER_KINDS {
  return LAYER_KINDS.filter((kind) => kind.available?.(projection) ?? true);
}

/** The name a new layer of each kind gets, before it is counted. */
const KIND_NAMES: Record<LayerKind, string> = {
  object: "Layer",
  pattern: "Pattern",
  background: "Background",
  tile: "Tiles",
};

/**
 * The next unclaimed name for a layer of this kind.
 *
 * Counting the layers and adding one is not enough, for the reason
 * `nextPointName` walks: delete Pattern 1 of two and the next one made would
 * be Pattern 2 again.
 */
export function nextLayerName(
  layers: readonly Layer[],
  kind: LayerKind,
): string {
  const taken = new Set(layers.map((l) => l.name));
  const stem = KIND_NAMES[kind];
  for (let n = 1; ; n++) {
    const name = `${stem} ${n}`;
    if (!taken.has(name)) return name;
  }
}

// ── patterns ────────────────────────────────────────────────────────────────

/**
 * The repeat tile each kind of pattern arrives with.
 *
 * A random scatter wants room to look unconsidered — at ten spaces a side the
 * eye finds the repeat — and a grid wants the opposite, because a regular
 * arrangement *is* its repeat and a large one is only the same thing further
 * apart.
 */
export const PATTERN_DEFAULTS: Record<
  PatternType,
  { repeat: { cols: number; rows: number }; density: number }
> = {
  random: { repeat: { cols: 20, rows: 20 }, density: 8 },
  grid: { repeat: { cols: 10, rows: 10 }, density: 4 },
};

/**
 * A pattern layer's spec, filled in.
 *
 * A layer made before its pattern was touched has none, and the defaults are
 * what a fresh random pattern is — so every reader asks for the spec rather
 * than writing `?? DEFAULT` at each call site.
 */
export function patternSpec(layer: Layer | undefined): PatternSpec {
  const held = layer?.pattern;
  if (held) return held;
  return {
    type: "random",
    ...PATTERN_DEFAULTS.random,
    seed: 1,
    shapes: [],
  };
}

/**
 * Whether a repeat is still the default for the type it was made under.
 *
 * The same distinction a collider draws between a guess and an answer:
 * switching a pattern from random to grid should bring the grid's own repeat
 * with it, because 20 × 20 is the random default and not a number anybody
 * chose — but a repeat somebody typed is theirs, and switching type is not a
 * reason to throw it away.
 */
function isDefaultRepeat(spec: PatternSpec): boolean {
  const { repeat, density } = PATTERN_DEFAULTS[spec.type];
  return (
    spec.repeat.cols === repeat.cols &&
    spec.repeat.rows === repeat.rows &&
    spec.density === density
  );
}

/** Change a pattern's type, bringing that type's defaults where they are
 *  still defaults rather than somebody's answer. */
export function setPatternType(
  store: DocStore,
  layerId: string,
  type: PatternType,
): void {
  editPattern(store, layerId, (spec) =>
    spec.type === type
      ? spec
      : {
          ...spec,
          type,
          ...(isDefaultRepeat(spec) ? PATTERN_DEFAULTS[type] : {}),
        },
  );
}

export function setPatternDensity(
  store: DocStore,
  layerId: string,
  density: number,
): void {
  // One element per tile is the fewest that is still a pattern; the ceiling
  // is what stops a typed zero too many from asking the canvas for ten
  // thousand objects before anybody can retype it.
  const held = Math.round(clamp(density, 1, 200));
  editPattern(store, layerId, (spec) => ({ ...spec, density: held }));
}

export function setPatternRepeat(
  store: DocStore,
  layerId: string,
  cols: number,
  rows: number,
): void {
  editPattern(store, layerId, (spec) => ({
    ...spec,
    repeat: {
      cols: Math.round(clamp(cols, 1, 500)),
      rows: Math.round(clamp(rows, 1, 500)),
    },
  }));
}

/** Re-roll the arrangement without changing anything about the rule. */
export function shufflePattern(store: DocStore, layerId: string): void {
  editPattern(store, layerId, (spec) => ({
    ...spec,
    seed: (spec.seed + 1) >>> 0,
  }));
}

/** Confine the pattern to a run of grid spaces, from the selection tool. */
export function addPatternShapeCells(
  store: DocStore,
  layerId: string,
  cells: readonly Cell[],
): PatternShape | null {
  if (cells.length === 0) return null;
  return addPatternShape(store, layerId, { cells: cells.map((c) => ({ ...c })) });
}

/**
 * The same, from a polygon the pencil drew.
 *
 * Baked down to the spaces it covers on the way in, and the outline kept
 * beside them — see `cellsInPolygon`. A shape that covers no whole space is
 * refused rather than stored as a line nothing can be inside of.
 */
export function addPatternShapePoints(
  store: DocStore,
  layerId: string,
  grid: Grid,
  points: readonly Point[],
): PatternShape | null {
  if (points.length < 3) return null;
  const cells = cellsInPolygon(grid, points);
  if (cells.length === 0) return null;
  return addPatternShape(store, layerId, {
    cells,
    points: points.map((p) => ({ ...p })),
  });
}

function addPatternShape(
  store: DocStore,
  layerId: string,
  body: Pick<PatternShape, "cells" | "points">,
): PatternShape {
  const spec = patternSpec(store.layer(layerId));
  const shape: PatternShape = {
    id: makeId("shape"),
    name: `Shape ${spec.shapes.length + 1}`,
    ...body,
  };
  editPattern(store, layerId, (held) => ({
    ...held,
    shapes: [...held.shapes, shape],
  }));
  return shape;
}

/**
 * Write the spaces of a shape, making it if it does not exist yet.
 *
 * What mask mode applies. A shape it was opened on keeps its id, its name and
 * its place in the list — the rest of the editor refers to it by id and the
 * panel's rows would otherwise reshuffle under the user's hand — and loses its
 * **outline**, when the spaces have moved. That is the honest answer rather
 * than a convenience: `points` is kept so the canvas can draw the line
 * somebody actually drew, and once the spaces are not the ones that line
 * enclosed, the line is a drawing of a shape that no longer exists. Spaces
 * that came back unchanged mean nothing was swept, so the line still describes
 * them and stays.
 */
export function writePatternShape(
  store: DocStore,
  layerId: string,
  shapeId: string | null,
  cells: readonly Cell[],
): PatternShape | null {
  if (cells.length === 0) return null;
  const held = cells.map((c) => ({ ...c }));
  if (shapeId === null) return addPatternShapeCells(store, layerId, held);

  const before = patternSpec(store.layer(layerId)).shapes.find(
    (shape) => shape.id === shapeId,
  );
  if (!before) return addPatternShapeCells(store, layerId, held);

  const moved = !sameCells(before.cells ?? [], held);
  const after: PatternShape = moved
    ? { id: before.id, name: before.name, cells: held }
    : before;
  if (moved) {
    editPattern(store, layerId, (spec) => ({
      ...spec,
      shapes: spec.shapes.map((shape) => (shape.id === shapeId ? after : shape)),
    }));
  }
  return after;
}

/** Order-insensitive, because a sweep rebuilds the list from a set. */
function sameCells(a: readonly Cell[], b: readonly Cell[]): boolean {
  if (a.length !== b.length) return false;
  const held = new Set(a.map((c) => `${c.cx},${c.cy}`));
  return b.every((c) => held.has(`${c.cx},${c.cy}`));
}

export function removePatternShape(
  store: DocStore,
  layerId: string,
  shapeId: string,
): void {
  editPattern(store, layerId, (spec) => ({
    ...spec,
    shapes: spec.shapes.filter((s) => s.id !== shapeId),
  }));
}

/**
 * Rewrite a layer's pattern spec.
 *
 * Reads through `patternSpec`, so the first edit to a layer that has never
 * had one writes the defaults out in full rather than a document holding one
 * field of a rule.
 */
function editPattern(
  store: DocStore,
  layerId: string,
  update: (spec: PatternSpec) => PatternSpec,
): void {
  store.editLayer(layerId, (layer) => ({
    ...layer,
    pattern: update(patternSpec(layer)),
  }));
}

// ── backgrounds ─────────────────────────────────────────────────────────────

/** What a fresh colour background is: the accent, which everything the
 *  editor puts down for the first time is. */
export const BACKGROUND_COLOR = "#2b3b4a";

/** And a fresh gradient: the same colour fading to nothing much, top to
 *  bottom — a sky, which is what a gradient backdrop is nine times in ten. */
export const BACKGROUND_GRADIENT = {
  from: "#6ea8d8",
  to: "#dfe9f2",
  angle: 0,
};

/** A background layer's backdrops, front-most first as the panel lists them. */
export function backgroundsOf(layer: Layer | undefined): readonly Background[] {
  return layer?.backgrounds ?? [];
}

export function addBackground(
  store: DocStore,
  layerId: string,
  kind: Background["kind"],
): Background {
  const held = backgroundsOf(store.layer(layerId));
  const made: Background = {
    id: makeId("bg"),
    name: `${kind === "gradient" ? "Gradient" : "Colour"} ${held.length + 1}`,
    kind,
    ...(kind === "gradient"
      ? { gradient: { ...BACKGROUND_GRADIENT } }
      : { color: BACKGROUND_COLOR }),
  };
  store.editLayer(layerId, (layer) => ({
    ...layer,
    backgrounds: [...backgroundsOf(layer), made],
  }));
  return made;
}

export function updateBackground(
  store: DocStore,
  layerId: string,
  backgroundId: string,
  patch: Partial<Background>,
): void {
  store.editLayer(layerId, (layer) => ({
    ...layer,
    backgrounds: backgroundsOf(layer).map((bg) =>
      bg.id === backgroundId ? { ...bg, ...patch } : bg,
    ),
  }));
}

export function removeBackground(
  store: DocStore,
  layerId: string,
  backgroundId: string,
): void {
  store.editLayer(layerId, (layer) => ({
    ...layer,
    backgrounds: backgroundsOf(layer).filter((bg) => bg.id !== backgroundId),
  }));
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(value, high));
}
