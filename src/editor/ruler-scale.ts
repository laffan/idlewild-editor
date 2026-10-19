/**
 * What an artboard's ruler says at a zoom: where its ticks fall, which of them
 * are numbered, and how a guide's place reads.
 *
 * In the artboard's own unit — inches or centimetres, whichever its size is
 * shown in — because a ruler in points next to a label that says `8.5 × 11 in`
 * is two rulers. Guides themselves are whole points, as an artboard's corner
 * is; the unit is only how they read. See `artboard-chrome.ts`.
 */

import { inUnit, pointsPer, type PageUnit } from "../lib/print";

/** The ruler's thickness on screen, in CSS pixels. */
export const RULER_PX = 16;

/** The closest numbered ticks may come, on screen. */
const MIN_MAJOR_PX = 56;
/** The closest any two ticks may come. */
const MIN_MINOR_PX = 6;

/** The steps a numbered tick may stand at, in the unit, smallest first. */
const MAJORS: Record<PageUnit, number[]> = {
  in: [0.125, 0.25, 0.5, 1, 2, 4, 6, 12, 24, 48],
  cm: [0.5, 1, 2, 5, 10, 20, 50, 100],
};
/** How a numbered step may be cut up, finest first. */
const DIVISIONS: Record<PageUnit, number[]> = {
  in: [16, 8, 4, 2],
  cm: [10, 5, 2],
};

export interface RulerScale {
  /** Points between numbered ticks. */
  majorPt: number;
  /** Points between ticks of any kind; equal to `majorPt` when there are no others. */
  minorPt: number;
  /** The numbered step, in the unit — what the numbers count by. */
  majorUnits: number;
}

export function rulerScale(unit: PageUnit, zoom: number): RulerScale {
  const per = pointsPer(unit);
  const steps = MAJORS[unit];
  const z = zoom > 0 ? zoom : 1;
  const majorUnits = steps.find((s) => s * per * z >= MIN_MAJOR_PX) ?? steps[steps.length - 1];
  const majorPt = majorUnits * per;
  const division = DIVISIONS[unit].find((d) => (majorPt / d) * z >= MIN_MINOR_PX) ?? 1;
  return { majorPt, minorPt: majorPt / division, majorUnits };
}

/** A number on the ruler: no unit, and no more places than it needs. */
export function tickLabel(points: number, unit: PageUnit): string {
  return String(inUnit(points, unit));
}

/** A guide's place, as the tag beside it says it. */
export function guideLabel(points: number, unit: PageUnit): string {
  return `${inUnit(points, unit)} ${unit}`;
}

/** Where a pointer this far along a ruler puts a guide: a whole point. */
export function pointAt(offsetPx: number, zoom: number): number {
  return Math.round(offsetPx / (zoom > 0 ? zoom : 1));
}
