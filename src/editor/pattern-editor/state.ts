/**
 * What the pattern editor is holding while it is open.
 *
 * Ported from simple-tileset-generator's `PatternEditorState`, with two
 * changes. It is an object handed between modules rather than a global,
 * because this editor can be opened from three places in the shell and a
 * global would make two of them a bug waiting to happen. And the interaction
 * flags that upstream reaches for a modifier key to set — selection, panning —
 * are a **mode** here as well as a modifier, because there is no ⌘ and no
 * space bar on an iPad and every feature has to be reachable with a finger.
 */

import {
  copyPattern,
  emptyPattern,
  type PatternData,
} from "../../lib/library";

/** The side of the red box the pattern fills, in CSS pixels. */
export const BOUNDARY_PX = 264;
/** The editor canvas, which shows the tile and its neighbours around it. */
export const CANVAS_PX = 420;

/** Pattern grids the buttons offer. Anything else is typed in. */
export const SIZE_PRESETS = [4, 8, 16, 32, 64] as const;
export const MIN_SIZE = 2;
export const MAX_SIZE = 128;

/** How many undo steps are kept. Upstream keeps ten; this is a pixel grid. */
export const HISTORY_LIMIT = 40;

export type BrushKind = "square" | "round" | "airbrush" | "custom";

/** What the pointer is for. */
export type PatternMode = "draw" | "select" | "pan";

export interface PatternEditorState {
  /** The grid being edited. Replaced rather than written through, so undo
   *  can hold the old one without copying on every stroke. */
  pattern: PatternData;
  /** The row this began as, so Save knows whether it is an edit or a copy. */
  sourceId: string | null;
  name: string;

  mode: PatternMode;
  brush: BrushKind;
  brushSize: number;
  density: number;
  erasing: boolean;
  /** A brush made from a selection, or uploaded. A 2D grid of 0/1. */
  customBrush: number[][] | null;

  /** 0.25–1, where 1 is the pattern exactly filling the red box. */
  zoom: number;

  /** Where the pointer is, for the ghost preview. */
  hover: { row: number; col: number } | null;
  /** The grid as it will be if the gesture in flight is committed. */
  preview: PatternData | null;

  /** The rectangle a selection covers, in pattern cells, inclusive. */
  selection: { r0: number; c0: number; r1: number; c1: number } | null;
  /**
   * Whether the box is still being swept.
   *
   * A settled box grows a corner handle and answers to a drag inside it; one
   * still being swept does neither, because a handle that appeared mid-sweep
   * would be a target moving under the pointer that made it.
   */
  sweeping: boolean;

  /** How far the tile has been dragged, in whole cells, before it is applied. */
  offset: { x: number; y: number };

  past: PatternData[];
  future: PatternData[];
}

export function createPatternState(
  pattern: PatternData,
  sourceId: string | null,
  name: string,
): PatternEditorState {
  return {
    pattern: copyPattern(pattern),
    sourceId,
    name,
    mode: "draw",
    brush: "square",
    brushSize: 1,
    density: 30,
    erasing: false,
    customBrush: null,
    zoom: 1,
    hover: null,
    preview: null,
    selection: null,
    sweeping: false,
    offset: { x: 0, y: 0 },
    past: [],
    future: [],
  };
}

/** A blank grid to start a new pattern from. */
export function blankPattern(size = 16): PatternData {
  return emptyPattern(size);
}

/**
 * Remember the grid as it is, before the thing about to change it.
 *
 * Captured *before* rather than after, which is what makes one drag one undo
 * step: the gesture takes a snapshot when it opens and every move after that
 * writes into the live grid, so undoing lands on the grid as it was when the
 * pointer went down.
 */
export function capture(state: PatternEditorState): void {
  state.past.push(copyPattern(state.pattern));
  if (state.past.length > HISTORY_LIMIT) state.past.shift();
  state.future.length = 0;
}

export function undo(state: PatternEditorState): boolean {
  const previous = state.past.pop();
  if (!previous) return false;
  state.future.push(copyPattern(state.pattern));
  state.pattern = previous;
  state.selection = null;
  return true;
}

export function redo(state: PatternEditorState): boolean {
  const next = state.future.pop();
  if (!next) return false;
  state.past.push(copyPattern(state.pattern));
  state.pattern = next;
  state.selection = null;
  return true;
}

/** The selection with its corners in order, or null. */
export function selectionBounds(
  state: PatternEditorState,
): { r0: number; c0: number; r1: number; c1: number } | null {
  const s = state.selection;
  if (!s) return null;
  return {
    r0: Math.min(s.r0, s.r1),
    c0: Math.min(s.c0, s.c1),
    r1: Math.max(s.r0, s.r1),
    c1: Math.max(s.c0, s.c1),
  };
}
