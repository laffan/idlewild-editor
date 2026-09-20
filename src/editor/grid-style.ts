/**
 * The lattice's own two settings: how strong its lines are, and what colour
 * they are drawn in.
 *
 * They live under the Grid switch in Overlays, and they are there rather than
 * in Project Options for the reason the switch is: what the canvas draws
 * *about* a document is not part of it. Two people opening the same project
 * see their own answer, and neither answer is a thing to undo.
 *
 * **Why they exist at all.** The lattice is one pale blue hairline
 * (`--canvas-line`, which is what `GRID_LINE_COLOR` is) and that is the right
 * answer over bare ground and the wrong one over artwork twice: it disappears
 * into a pale sketch, and it prints a blue cage over a dark one. Both end the
 * same way — somebody switches the grid off and then measures by eye on a
 * canvas whose whole point is the spaces. A weight and a colour are the two
 * smallest controls that fix both.
 *
 * **The weight multiplies rather than replaces.** `grid-renderer.ts` already
 * fades the lines out as the tiles approach the size below which they stop
 * reading, and that fade is not a preference: it is what stops a zoomed-out
 * canvas being a grey field. So the slider scales a lattice that is legible
 * at all, and 100% is exactly the lattice this editor has always drawn.
 *
 * A file of its own because it is one subject — a colour and a number, their
 * bounds, how a stored one is read back, and the two rows that set them — and
 * `overlays-panel.ts` is about the switches.
 */

import { createColorPicker } from "../lib/color-picker";
import { isValidHex, normaliseHex, opaqueHex } from "../lib/color";
import { h } from "../lib/dom";
import { GRID_LINE_COLOR, GRID_LINE_OPACITY } from "../game/grid-renderer";

/**
 * What the lattice is drawn in when nobody has said otherwise.
 *
 * The colour is the renderer's own default written back out as a hex, rather
 * than the string from `tokens.css` typed a second time: the two have to be
 * the same colour, and the only way to guarantee that is for one of them to
 * be derived from the other.
 */
export const GRID_STYLE_DEFAULTS = {
  gridColor: `#${GRID_LINE_COLOR.toString(16).padStart(6, "0")}`,
  gridOpacity: GRID_LINE_OPACITY,
};

/**
 * How faint the lattice is allowed to get.
 *
 * Not zero. Zero is the Grid switch, which is directly above this control and
 * says so — and a slider dragged to its end that silently does what the
 * switch above it does is a second way to reach a state with no way back from
 * it, because the switch would still read "on". Ten per cent is a lattice you
 * can see you have turned down.
 */
export const GRID_OPACITY_MIN = 0.1;

/** A stored opacity, put back in range. */
export function clampGridOpacity(value: number): number {
  if (!Number.isFinite(value)) return GRID_STYLE_DEFAULTS.gridOpacity;
  return Math.min(1, Math.max(GRID_OPACITY_MIN, value));
}

/** A stored opacity, read back off whatever was in `localStorage`. */
export function readGridOpacity(raw: unknown): number {
  if (typeof raw !== "number") return GRID_STYLE_DEFAULTS.gridOpacity;
  return clampGridOpacity(raw);
}

/**
 * A stored colour, read back the same way.
 *
 * Opaque, whatever was written: the lattice carries its weight in the
 * opacity beside it, and a colour that carried one too would be two controls
 * for one number with no way to tell which of them had dimmed the grid.
 */
export function readGridColor(raw: unknown): string {
  if (typeof raw !== "string" || !isValidHex(raw)) {
    return GRID_STYLE_DEFAULTS.gridColor;
  }
  return opaqueHex(normaliseHex(raw));
}

export interface GridStyleActions {
  color: string;
  opacity: number;
  onColor: (hex: string) => void;
  onOpacity: (opacity: number) => void;
}

/**
 * The two rows, for the panel to put under the Grid switch.
 *
 * The weight first, because it is the one people reach for: *I can barely see
 * it* and *it is shouting over my artwork* are both answered by the slider,
 * and the colour is what you change once for a project whose palette fights
 * the default blue.
 *
 * The picker is this editor's own rather than a native colour input, for the
 * reason every other colour in the app uses it: it carries the eyedropper,
 * and the obvious thing to want here is the lattice in a tone taken off the
 * artwork it is going to be drawn over. It is folded behind the swatch, so
 * the ordinary state of this section is two short rows rather than a picker
 * permanently occupying the sidebar above the minimap.
 */
export function gridStyleRows(actions: GridStyleActions): HTMLElement {
  const readout = h("div", {
    class: "overlays-readout m",
    text: percentOf(actions.opacity),
  });
  const slider = h("input", {
    class: "overlays-slider",
    type: "range",
    min: String(Math.round(GRID_OPACITY_MIN * 100)),
    max: "100",
    step: "1",
    value: String(Math.round(actions.opacity * 100)),
    "aria-label": "Grid opacity",
    // `input` rather than `change`, so the lattice follows the slider: the
    // whole question being asked is what it looks like at this weight.
    onInput: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(next)) return;
      const opacity = clampGridOpacity(next / 100);
      readout.textContent = percentOf(opacity);
      actions.onOpacity(opacity);
    },
  });

  const swatchChip = h("span", { class: "overlays-swatch-chip" });
  swatchChip.style.background = actions.color;
  const picker = createColorPicker({
    value: actions.color,
    // Opaque on the way out for the reason `readGridColor` gives: the weight
    // is the slider above, and a colour carrying its own alpha would be the
    // same number said twice.
    onChange: (hex) => {
      const solid = opaqueHex(hex);
      swatchChip.style.background = solid;
      actions.onColor(solid);
    },
  });
  const pickerBox = h("div", { class: "overlays-picker" }, picker.root);
  pickerBox.hidden = true;

  const swatch = h(
    "button",
    {
      class: "overlays-setting overlays-colour",
      title: "What the lattice's lines are drawn in",
      "aria-expanded": "false",
      onClick: () => {
        const open = pickerBox.hidden;
        pickerBox.hidden = !open;
        swatch.setAttribute("aria-expanded", String(open));
      },
    },
    h("span", { class: "overlays-name m", text: "Line colour" }),
    swatchChip,
  );

  return h(
    "div",
    { class: "overlays-grid-style" },
    h(
      "div",
      { class: "overlays-setting" },
      h("span", { class: "overlays-name m", text: "Opacity" }),
      slider,
      readout,
    ),
    swatch,
    pickerBox,
  );
}

function percentOf(opacity: number): string {
  return `${Math.round(opacity * 100)}%`;
}
