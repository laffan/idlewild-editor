/**
 * The rows that say how big a print project's page is — the same rows on the
 * New Project sheet and in Page Setup, so the two cannot drift apart.
 *
 * **Dimensions** is the paper: the standard sheets, and **Custom**. A standard
 * sheet takes an orientation. A custom one takes a width and a height in
 * inches or centimetres, typed the way round they are meant — so orientation
 * goes away under Custom rather than turning a size somebody has just typed.
 * The unit is only how the size reads: it is stored in points, and switching
 * unit converts what is in the boxes rather than reinterpreting it.
 *
 * The rows report every change as a patch to `Output`; what happens to it —
 * held until Create on the sheet, written at once in Page Setup — is the
 * caller's.
 */

import { optionRow } from "./options-list";
import { optionNumber, optionSegmented } from "./options-controls";
import {
  CUSTOM,
  inUnit,
  isCustom,
  PAGE_RANGE,
  PAPERS,
  pointsPer,
  type Output,
  type PageUnit,
} from "./print";

export interface DimensionRows {
  /** In order: Dimensions, Orientation, Width, Height, Unit. */
  rows: HTMLElement[];
  /** Show or hide the lot — the New Project sheet does under Web. */
  setShown: (shown: boolean) => void;
}

export function dimensionRows(
  initial: Output,
  onChange: (patch: Partial<Output>) => void,
): DimensionRows {
  const output: Output = { ...initial };
  let shown = true;

  const paper = optionSegmented(
    [
      ...PAPERS.map((row) => ({ value: row.id, label: row.label })),
      { value: CUSTOM, label: "Custom" },
    ],
    output.paper,
    (value) => {
      output.paper = value;
      onChange({ paper: value });
      sync();
    },
  );
  const orientation = optionSegmented(
    [
      { value: "portrait", label: "Portrait" },
      { value: "landscape", label: "Landscape" },
    ],
    output.landscape ? "landscape" : "portrait",
    (value) => {
      output.landscape = value === "landscape";
      onChange({ landscape: output.landscape });
    },
  );

  // The boxes hold the size in the unit; the record holds points.
  const range = (unit: PageUnit) => ({
    min: inUnit(PAGE_RANGE.min, unit),
    max: inUnit(PAGE_RANGE.max, unit),
  });
  const box = (key: "customWidth" | "customHeight", label: string) =>
    optionNumber({
      value: inUnit(output[key], output.unit),
      ...range(output.unit),
      step: 0.01,
      unit: output.unit,
      label,
      onChange: (value) => {
        output[key] = value * pointsPer(output.unit);
        onChange({ [key]: output[key] });
      },
    });
  let width = box("customWidth", "Page width");
  let height = box("customHeight", "Page height");
  const widthRow = optionRow({ title: "Width", control: width.root });
  const heightRow = optionRow({ title: "Height", control: height.root });

  const unit = optionSegmented(
    [
      { value: "in", label: "Inches" },
      { value: "cm", label: "Centimetres" },
    ],
    output.unit,
    (value) => {
      output.unit = value as PageUnit;
      onChange({ unit: output.unit });
      // New boxes rather than relabelled ones: the range and the unit beside
      // the number both change, and the size is re-read in the new unit.
      const freshWidth = box("customWidth", "Page width");
      const freshHeight = box("customHeight", "Page height");
      width.root.replaceWith(freshWidth.root);
      height.root.replaceWith(freshHeight.root);
      width = freshWidth;
      height = freshHeight;
    },
  );

  const dimensionsRow = optionRow({
    title: "Dimensions",
    hint:
      "The sheet the page is laid out on — a standard size, or Custom for a " +
      "width and height of your own. One point is one world pixel, and the " +
      "frame on the canvas in Draw is this sheet, edge for edge.",
    control: paper.root,
  });
  const orientationRow = optionRow({ title: "Orientation", control: orientation.root });
  const unitRow = optionRow({ title: "Units", control: unit.root });

  function sync(): void {
    const custom = isCustom(output);
    dimensionsRow.hidden = !shown;
    orientationRow.hidden = !shown || custom;
    widthRow.hidden = !shown || !custom;
    heightRow.hidden = !shown || !custom;
    unitRow.hidden = !shown || !custom;
  }
  sync();

  return {
    rows: [dimensionsRow, orientationRow, unitRow, widthRow, heightRow],
    setShown: (on) => {
      shown = on;
      sync();
    },
  };
}
