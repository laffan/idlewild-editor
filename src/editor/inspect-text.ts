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
 * **Track the grid** is the one control that is not always there. On an
 * isometric project a note drawn flat reads as floating in front of the world
 * — it is the one thing on the canvas facing the viewer while everything else
 * is seen from above and to the side — and the switch lays it into the grid's
 * own plane instead, so a label reads as painted on the floor. On an
 * orthogonal or blank project that plane *is* the screen, so the row is not
 * drawn: a switch that does nothing says the feature is broken rather than
 * inapplicable.
 *
 * **Restyling one sets the tool**, so the next word is written the same way.
 * That is the reading every brush keeps — set the size once and the next five
 * strokes are that size — and it is why there is no second control saying what
 * the *next* piece of text will look like. Two controls for one question is
 * how they end up disagreeing.
 */

import { h } from "../lib/dom";
import { createColorPicker } from "../lib/color-picker";
import {
  optionNumber,
  optionSegmented,
  optionSwitch,
} from "../lib/options-controls";
import type { Grid } from "../lib/grid";
import type { DocStore } from "../lib/doc-store";
import {
  DEFAULT_LINE_HEIGHT,
  styleOf,
  textById,
  updateText,
  type TextStyleFields,
} from "../lib/text-items";
import { fontLabel, systemFonts } from "../lib/system-fonts";
import { openMenu } from "../lib/menu";
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
  onTextStyle: (style: TextStyleFields) => void;
}

/** The sizes offered, and a number for anything between or beyond them. */
const SIZES: readonly number[] = [12, 16, 24, 32, 48, 64];

export function renderText(
  panel: PanelSurface,
  store: DocStore,
  grid: Grid,
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
    if (next) actions.onTextStyle(styleOf(next));
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
      fontButton(item, (font) => write({ font })),
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

  // The chips are the sizes anybody reaches for and the field is the one they
  // do not. Both write the same number, and the chips stop looking chosen the
  // moment it is something else — a row that went on claiming 24 while the
  // note was 31 would be the one control here saying something untrue.
  panel.body.appendChild(
    numberRow("Size", "px", item.size, 4, 400, (size) => write({ size })),
  );
  // Against the size rather than in pixels, which is what a leading *is*: a
  // note retyped twice as big keeps its spacing without anybody re-deciding.
  panel.body.appendChild(
    numberRow(
      "Line height",
      "×",
      item.lineHeight ?? DEFAULT_LINE_HEIGHT,
      0.5,
      4,
      (lineHeight) => write({ lineHeight }),
      0.05,
    ),
  );

  panel.section(
    "Wrapping",
    "Off, a line ends where you put a new line. On, the words are broken " +
      "into a column you can drag the width of on the canvas.",
  );
  panel.body.appendChild(
    switchRow(
      "Wrap the words",
      item.wrapWidth !== undefined,
      // The column starts at whatever the note is already as wide as, so
      // turning it on reflows nothing and the handle appears where the words
      // already end. Turning it off drops the width rather than remembering
      // it: an invisible column that comes back on the next toggle is a
      // number nobody can see and nobody asked to keep.
      (on) => write({ wrapWidth: on ? Math.max(32, Math.round(item.width)) : undefined }),
    ),
  );
  if (item.wrapWidth !== undefined) {
    panel.body.appendChild(
      numberRow("Column", "px", Math.round(item.wrapWidth), 32, 4000, (wrapWidth) =>
        write({ wrapWidth }),
      ),
    );
  }

  // Only where it means anything. On an orthogonal or blank project the grid's
  // plane *is* the screen, so the switch would be a control that does nothing
  // — and a switch that does nothing is worse than no switch, because it says
  // the feature is broken rather than inapplicable.
  if (grid.projection === "isometric") {
    panel.section("The grid");
    panel.body.appendChild(
      switchRow(
        "Track the grid",
        item.tracksGrid === true,
        (on) => write({ tracksGrid: on || undefined }),
        "The words are laid along the grid's own two axes, so they read as " +
          "part of the world rather than floating in front of it.",
      ),
    );
    // The two halves of the orientation, and they only exist inside the
    // switch: a note drawn flat has no axis to run along and no plane to
    // stand up in, so offering either would be offering a choice with no
    // subject. **Two controls rather than four named orientations**, because
    // they are two independent decisions — which axis, and which way up — and
    // a list of four would be a list somebody has to decode.
    if (item.tracksGrid) {
      panel.body.appendChild(
        h(
          "div",
          {
            class: "inspect-section",
            title: "Which of the grid's two diagonals a line of text follows.",
          },
          optionSegmented(
            [
              { value: "cx", label: "NW→SE" },
              { value: "cy", label: "SW→NE" },
            ],
            item.runs ?? "cx",
            (runs) => write({ runs: runs === "cy" ? "cy" : undefined }),
          ).root,
        ),
      );
      panel.body.appendChild(
        switchRow(
          "Stand it up",
          item.upright === true,
          (on) => write({ upright: on || undefined }),
          "Lying down, the lines step across the floor. Standing up, they " +
            "step straight down the screen, the way a sign on the face of a " +
            "wall does.",
        ),
      );
    }
  }

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

/** A labelled row with a switch at the end of it. */
function switchRow(
  label: string,
  on: boolean,
  onChange: (on: boolean) => void,
  hint?: string,
): HTMLElement {
  return h(
    "div",
    {
      class: "inspect-section inspect-row",
      ...(hint ? { title: hint } : {}),
    },
    h("span", { class: "inspect-key m", text: label }),
    optionSwitch(on, onChange, label).root,
  );
}

/** And one with a number in it. */
function numberRow(
  label: string,
  unit: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
  step = 1,
): HTMLElement {
  return h(
    "div",
    { class: "inspect-section inspect-row" },
    h("span", { class: "inspect-key m", text: label }),
    optionNumber({ value, min, max, step, unit, label, onChange }).root,
  );
}

/**
 * The family, as a button that opens the list of them.
 *
 * A menu rather than the row of segmented buttons this used to be, because
 * there are now as many families as the device has rather than three: a row of
 * forty chips is not a row. **Each name is drawn in its own face**, here and in
 * the menu, which is the only thing that makes a list of family names choosable
 * — *Didot* set in the panel's own font says nothing about Didot.
 *
 * A family the document names and this device has not got still shows, under
 * its own name, because the note is set to it and the panel's job is to say so
 * rather than to quietly agree with whatever it fell back to. See `fontLabel`.
 */
function fontButton(item: TextItem, onPick: (font: string) => void): HTMLElement {
  const button = h(
    "button",
    {
      class: "panel-btn font-btn",
      title: "The typeface, from the ones installed on this device",
      onClick: (event: Event) => {
        const anchor = event.currentTarget as HTMLElement;
        openMenu(
          anchor,
          systemFonts().map((font) => ({
            label: font.name,
            font: font.id,
            current: font.id === item.font,
            onSelect: () => onPick(font.id),
          })),
        );
      },
    },
    h("span", {
      text: fontLabel(item.font),
      style: { fontFamily: item.font },
    }),
  );
  return button;
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
