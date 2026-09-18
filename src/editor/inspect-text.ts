/**
 * A word on the canvas, and the four things it is written in.
 *
 * **The field is here rather than on the canvas**, which is the one decision
 * in this panel worth the words. A caret over a Phaser scene would be a second
 * input model — an iPad's keyboard, an IME, a selection, a blinking cursor
 * drawn at whatever the camera's zoom happens to be — carried for a string
 * that is usually three words long. The panel beside it is already where every
 * other property of every other object is typed, so the text goes in the same
 * column as the size and the colour, and the canvas shows it as you type.
 *
 * A textarea rather than an input because a note has lines in it: *door to the
 * cave* over *(locked until the bell)* is two lines somebody meant, and the
 * renderer and the rasteriser both already draw them.
 *
 * **Restyling one sets the tool**, so the next word is written the same way.
 * That is the reading every brush keeps — set the size once and the next five
 * strokes are that size — and it is why there is no second control saying what
 * the *next* piece of text will look like. Two controls for one question is
 * how they end up disagreeing.
 */

import { h } from "../lib/dom";
import { createColorPicker } from "../lib/color-picker";
import { optionSegmented } from "../lib/options-controls";
import type { DocStore } from "../lib/doc-store";
import { TEXT_FONTS, textById, updateText } from "../lib/text-items";
import type { Selection, TextItem } from "../lib/types";
import type { PanelSurface } from "./inspect-panels";

/** What this panel needs from the shell around it. */
export interface TextActions {
  onDeleteSelection: () => void;
  /** Turn it into artwork — the only exit a note has. */
  onTextToPsd: () => void;
  /**
   * The style of the piece just restyled, so the next one is written to match.
   *
   * The scene holds it, because the scene is what a tap on bare ground reaches
   * — see `game/text-style.ts`.
   */
  onTextStyle: (style: Pick<TextItem, "size" | "color" | "font" | "align">) => void;
}

/** The sizes offered, and a number for anything between or beyond them. */
const SIZES: readonly number[] = [12, 16, 24, 32, 48, 64];

export function renderText(
  panel: PanelSurface,
  store: DocStore,
  actions: TextActions,
  selection: Extract<Selection, { kind: "text" }>,
): void {
  const { layerId, textId } = selection;
  const layer = store.layer(layerId);
  const item = textById(layer, textId);
  if (!layer || !item) return panel.empty();

  const write = (patch: Partial<Omit<TextItem, "id">>) => {
    updateText(store, layerId, textId, patch);
    const next = textById(store.layer(layerId), textId);
    if (next) {
      actions.onTextStyle({
        size: next.size,
        color: next.color,
        font: next.font,
        align: next.align,
      });
    }
  };

  panel.head("Text", firstLine(item));
  panel.section("Info");
  panel.row("Layer", layer.name);
  panel.row("Size", `${Math.round(item.width)} × ${Math.round(item.height)}`);
  panel.row("Origin", `${Math.round(item.x)}, ${Math.round(item.y)}`);

  panel.section("Words", "What it says. A new line here is a new line there.");
  const field = h("textarea", {
    class: "inspect-textarea",
    rows: "3",
    spellcheck: "false",
    "aria-label": "What this text says",
  }) as HTMLTextAreaElement;
  field.value = item.text;
  // Live, not on commit: the canvas is the preview, and a note whose shape
  // only appears when the field loses focus is a note laid out by guesswork.
  // The inspector puts the caret back afterwards — see `captureText`.
  field.addEventListener("input", () => write({ text: field.value }));
  panel.body.appendChild(h("div", { class: "inspect-section" }, field));

  panel.section("Style");
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      optionSegmented(
        TEXT_FONTS.map((font) => ({ value: font.id, label: font.name })),
        item.font,
        (font) => write({ font }),
      ).root,
      optionSegmented(
        SIZES.map((size) => ({ value: String(size), label: String(size) })),
        String(item.size),
        (size) => write({ size: Number(size) }),
      ).root,
      optionSegmented(
        [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ],
        item.align,
        (align) => write({ align: align as TextItem["align"] }),
      ).root,
    ),
  );

  const picker = createColorPicker({
    value: item.color,
    onChange: (hex) => write({ color: hex }),
  });
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "Colour" }),
      picker.root,
    ),
  );

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn primary",
        text: "Convert to PSD",
        title:
          "The words become pixels in a file of their own, placed where they " +
          "are standing. The game never sees a font.",
        onClick: () => actions.onTextToPsd(),
      }),
      h("button", {
        class: "panel-btn",
        text: "Delete text",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}

/**
 * What the heading calls it: its first line, cut short.
 *
 * Its own words rather than a name somebody has to invent — a note already
 * says what it is, and *Text 3* over the words *door to the cave* would be a
 * heading that says less than the thing under it.
 */
function firstLine(item: TextItem): string {
  const line = item.text.split("\n")[0]?.trim() ?? "";
  if (!line) return "Empty";
  return line.length > 28 ? `${line.slice(0, 27)}…` : line;
}
