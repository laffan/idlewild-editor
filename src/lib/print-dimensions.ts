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
 *
 * **Clipboard**, under Custom, sizes the page to the image on the clipboard:
 * its pixels at the project's DPI, which is the size that same image arrives
 * at when it is pasted onto the canvas — so a page made from a screenshot is
 * the screenshot, edge for edge. Only where the caller can read a clipboard;
 * the reading is the caller's, so these rows stay free of the shell.
 */

import { h } from "./dom";
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
import type { PixelSize } from "./image-size";

export interface DimensionRows {
  /** In order: Dimensions, Orientation, Clipboard, Unit, Width, Height. */
  rows: HTMLElement[];
  /** Show or hide the lot — the New Project sheet does under Web. */
  setShown: (shown: boolean) => void;
}

/** What the Clipboard row needs from whoever shows it. */
export interface ClipboardSizing {
  /** The pixels to the inch the page is printed at, read when pressed. */
  dpi: () => number;
  /** The image on the clipboard's size, or a rejection saying why not. */
  read: () => Promise<PixelSize>;
}

/**
 * A clipboard image's pixels as a page size in points, at `dpi` — clamped to
 * what a page may be, with `clamped` saying whether it had to be.
 */
export function pageFromPixels(
  size: PixelSize,
  dpi: number,
): { width: number; height: number; clamped: boolean } {
  const fit = (px: number) =>
    Math.min(PAGE_RANGE.max, Math.max(PAGE_RANGE.min, (px * 72) / dpi));
  const width = fit(size.width);
  const height = fit(size.height);
  const clamped =
    width !== (size.width * 72) / dpi || height !== (size.height * 72) / dpi;
  return { width, height, clamped };
}

export function dimensionRows(
  initial: Output,
  onChange: (patch: Partial<Output>) => void,
  clipboard?: ClipboardSizing,
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
      refreshBoxes();
    },
  );

  // New boxes rather than relabelled ones: the range and the unit beside the
  // number both change, and the size is re-read in the new unit.
  function refreshBoxes(): void {
    const freshWidth = box("customWidth", "Page width");
    const freshHeight = box("customHeight", "Page height");
    width.root.replaceWith(freshWidth.root);
    height.root.replaceWith(freshHeight.root);
    width = freshWidth;
    height = freshHeight;
  }

  const clipboardNote = h("span", { class: "option-value" });
  const clipboardRow = clipboard
    ? optionRow({
        title: "Clipboard",
        sub: "The size of the image on the clipboard, at the page's DPI.",
        control: clipboardNote,
        actions: [
          {
            label: "Use image size",
            onSelect: () => void fromClipboard(clipboard),
          },
        ],
      })
    : null;

  async function fromClipboard(source: ClipboardSizing): Promise<void> {
    clipboardNote.textContent = "Reading…";
    let size: PixelSize;
    try {
      size = await source.read();
    } catch (err) {
      clipboardNote.textContent =
        err instanceof Error ? err.message : String(err);
      return;
    }
    const page = pageFromPixels(size, source.dpi());
    output.customWidth = page.width;
    output.customHeight = page.height;
    onChange({ customWidth: page.width, customHeight: page.height });
    refreshBoxes();
    clipboardNote.textContent =
      `${size.width} \u00d7 ${size.height} px` +
      (page.clamped ? " — fitted to the sizes a page can be" : "");
  }

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
    if (clipboardRow) clipboardRow.hidden = !shown || !custom;
  }
  sync();

  return {
    rows: [
      dimensionsRow,
      orientationRow,
      ...(clipboardRow ? [clipboardRow] : []),
      unitRow,
      widthRow,
      heightRow,
    ],
    setShown: (on) => {
      shown = on;
      sync();
    },
  };
}
