/**
 * The numeric half of a placement's Transform section.
 *
 * Split from the inspector because it is the panel's only geometry: two
 * fields and the sum that explains them, with no selection, document or grid
 * behind it. Everything else in there describes something; this changes it.
 */

import { h } from "../lib/dom";
import type { Placement } from "../lib/types";

/**
 * Numeric width/height for image edit mode.
 *
 * The fields are set at the label's size, as the read-only values beside them
 * are: a row is a label and its value, and a 16px field among 10px rows read
 * as a heading with a box round it.
 */
export function sizeControls(
  placement: Placement,
  onChange: (patch: Partial<Placement>) => void,
): HTMLElement {
  const make = (label: string, value: number, key: "width" | "height") =>
    h(
      "div",
      { class: "inspect-row" },
      h("div", { class: "inspect-key m", text: label }),
      h("input", {
        class: "inspect-input",
        type: "number",
        value: String(Math.round(value)),
        onChange: (event: Event) => {
          const next = Number((event.target as HTMLInputElement).value);
          if (Number.isFinite(next) && next > 0) onChange({ [key]: next });
        },
      }),
    );

  return h(
    "div",
    {},
    make("Width", placement.width, "width"),
    make("Height", placement.height, "height"),
  );
}

/**
 * How big a placement is against the pixels it really has. An import lands at
 * half — see IMPORT_SCALE — and this is the only place that says so.
 */
export function scaleOf(placement: Placement): number {
  return placement.width / (placement.naturalWidth || placement.width);
}
