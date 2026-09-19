/**
 * The TOOL zone for Stamp and Sweep fill.
 *
 * Two tools, two options each, and the second option is the same distinction
 * both times: lay the run out in the shape it was picked, or draw from it at
 * random. Saying it the same way twice is deliberate — they are the same
 * choice about the same run, and a pair of controls that looked different
 * would imply they were not.
 *
 * Its own file rather than two more branches in `inspect-brush.ts`, which is
 * about a *stroke style*: a size, a tip, a colour, a library row. None of
 * those four exists here. What a tile tool sets is what happens to the run in
 * the palette, and the palette is the other half of this same sidebar — see
 * `inspect-tiles.ts`.
 */

import { h } from "../lib/dom";
import { sectionTitle } from "./inspect-collapse";
import { optionSwitchRow } from "../lib/options-controls";
import { DENSITY_RANGE } from "../lib/tile-tools";
import type { ToolId } from "../lib/types";
import { describeStamp } from "./tile-palette";
import type { TileStamp } from "../lib/tile-layers";

/** What the panel can change, all of it the shell's — see `tool-routing.ts`. */
export interface TileToolActions {
  random: boolean;
  onRandom: (on: boolean) => void;
  density: number;
  onDensity: (density: number) => void;
  erasing: boolean;
  onErasing: (on: boolean) => void;
  /** What is in hand, so the panel can say so where it is being aimed. */
  stamp: TileStamp | null;
}

/** The name the zone's heading carries after `TOOL : `. */
export const TILE_TOOL_TITLES: Partial<Record<ToolId, string>> = {
  stamp: "Stamp",
  sweep: "Sweep fill",
};

/** And what it says on hover: what the tool *does*, in one line. */
export const TILE_TOOL_HINTS: Partial<Record<ToolId, string>> = {
  stamp:
    "Puts the tiles picked in the palette down where you tap, and along a " +
    "drag. What is about to land is shown under the pointer.",
  sweep:
    "Draw a shape and every space inside it is filled. The outline closes " +
    "itself, so a loop fills the ring it drew rather than the box round it.",
};

/** Whether this tool's panel belongs to this file rather than to the brush's. */
export function isTileTool(tool: ToolId): boolean {
  return tool === "stamp" || tool === "sweep";
}

export function tileToolPanel(
  tool: ToolId,
  actions: TileToolActions,
): HTMLElement[] {
  const rows: HTMLElement[] = [eraserRow(tool, actions)];

  // The two halves of each tool, as a segmented pair rather than a switch:
  // both are things the tool *does* and both have names, which is the whole
  // of when a pair beats a toggle. "Use as Eraser" above is the other case —
  // one bit, one name, nothing to put opposite it.
  rows.push(
    h(
      "div",
      { class: "inspect-section" },
      sectionTitle(tool === "sweep" ? "Fill" : "Stamp", {
        hint:
          tool === "sweep"
            ? "Solid tiles the area with the run, repeating it from the " +
              "corner. Random gives every space one tile of the run, chosen " +
              "as it lands."
            : "Direct lays the run out in the shape it was picked. Random " +
              "gives each space one tile of it, and the ghost under the " +
              "pointer is the one that is coming next.",
      }),
      h(
        "div",
        { class: "seg" },
        ...(tool === "sweep"
          ? ([
              ["Solid", false],
              ["Random", true],
            ] as const)
          : ([
              ["Direct", false],
              ["Random", true],
            ] as const)
        ).map(([label, random]) =>
          h("button", {
            class: "seg-opt",
            "aria-pressed": String(random === actions.random),
            text: label,
            onClick: () => actions.onRandom(random),
          }),
        ),
      ),
      h("div", { class: "field-hint", text: `In hand: ${describeStamp(actions.stamp)}` }),
    ),
  );

  // Only where it means something. Density is how much of a *swept area* a
  // scatter covers, so it has nothing to say about a stamp — which lands on
  // the one space the pointer is on — and nothing to say about a solid fill,
  // which covers every space by definition.
  if (tool === "sweep" && actions.random) {
    rows.push(
      h(
        "div",
        { class: "inspect-section" },
        sectionTitle("Density", {
          hint:
            "How many of the swept spaces take a tile, as a percentage. A " +
            "hundred is all of them, which is the only value that never " +
            "leaves a gap; below it the fill thins out.",
        }),
        h(
          "div",
          { class: "field-row" },
          h("span", { class: "inspect-key m", text: "Per cent" }),
          densityField(actions),
        ),
      ),
    );
  }
  return rows;
}

/**
 * Use as Eraser, the same row every tool that makes a mark carries.
 *
 * Here rather than borrowed from `inspect-brush.ts` because that one is built
 * out of a `StrokeStyle` and a tile tool has none — but it says the same
 * thing in the same shape, because it is the same idea: what the tool would
 * have put down, it takes off instead.
 */
function eraserRow(tool: ToolId, actions: TileToolActions): HTMLElement {
  const on = actions.erasing;
  const row = optionSwitchRow({
    label: "Use as Eraser",
    value: on,
    onChange: (next) => actions.onErasing(next),
    title: on
      ? `Taking tiles off instead of putting them down. Hold ${
          tool === "sweep" ? "Sweep fill" : "Stamp"
        } on the toolbar to turn it back.`
      : "Every space this tool would fill, it clears instead. A long press " +
        "on its button does the same.",
  });
  return h("div", { class: "inspect-section" }, row.root);
}

function densityField(actions: TileToolActions): HTMLInputElement {
  const input = h("input", {
    class: "input field-num",
    type: "number",
    min: String(DENSITY_RANGE.min),
    max: String(DENSITY_RANGE.max),
    step: "5",
    "aria-label": "Density, per cent",
  }) as HTMLInputElement;
  input.value = String(actions.density);
  input.addEventListener("change", () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n)) {
      input.value = String(actions.density);
      return;
    }
    actions.onDensity(
      Math.max(DENSITY_RANGE.min, Math.min(DENSITY_RANGE.max, n)),
    );
  });
  return input;
}
