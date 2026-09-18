/**
 * A word on the canvas, and everything it is written in.
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
 * **Grid Alignment** is the one section that is not always there. On an
 * isometric project a note drawn flat reads as floating in front of the world
 * — it is the one thing on the canvas facing the viewer while everything else
 * is seen from above and to the side — and the switch lays it into the grid's
 * own plane instead, so a label reads as painted on the floor. On an
 * orthogonal or blank project that plane *is* the screen, so the section is
 * not drawn: a switch that does nothing says the feature is broken rather than
 * inapplicable.
 *
 * **Every control belongs to the section that named it.** That sounds like
 * nothing, and it was the whole of what was wrong with this panel: a heading
 * opened a section and its controls were appended to the panel *beside* it, so
 * each heading had a rule and eighteen pixels of air under it, and folding one
 * away left everything it was the heading for still on screen. What the
 * sections are is a decision — the words, how the type is set, where it lies
 * on the grid, its colour — and each one is now a single element with its
 * heading at the top of it.
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
import { plainText } from "../lib/text-markdown";
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

/** The sizes the menu offers, and a field for anything between or beyond. */
const SIZES: readonly number[] = [12, 16, 24, 32, 48, 64];

/**
 * The note whose size field has been asked for, if any.
 *
 * Module state, which this panel has none of otherwise — and it is here rather
 * than on the document because it is not a fact about the note. *Custom* does
 * not change anything: the size is whatever it already was, and all that has
 * happened is that somebody wants to see the number. Writing that into the
 * document would put an undo step on opening a field, and reading it back on
 * the next launch would reopen a field nobody remembers asking for.
 *
 * Keyed by the note it was asked for on, so selecting a different one closes
 * the field again — the answer to *show me the number* is about the thing that
 * was in front of you when you asked.
 */
let sizeFieldFor: string | null = null;

/**
 * Whether the size field is showing: because it was asked for, or because the
 * note is a size the menu cannot represent.
 *
 * The second half is what keeps the menu honest. A note dragged to 31px — or
 * one made when the presets were a different six — has a size no row in the
 * menu can be marked as current, and a panel that then showed a closed menu
 * reading `31 px` with nothing selected inside it would be a control saying it
 * does not know what it is set to.
 */
export function sizeFieldOpen(textId: string, size: number): boolean {
  return sizeFieldFor === textId || !SIZES.includes(size);
}

/** *Custom…*, pressed. Nothing about the note changes; the field appears. */
export function openSizeField(textId: string | null): void {
  sizeFieldFor = textId;
}

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

  const words = panel.section(
    "Words",
    "What it says. A new line here is a new line there.",
  );
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
  words.appendChild(field);

  // **Alignment first**, because it is the one thing here that is about the
  // note as a whole rather than about its letters: everything under it — the
  // face, the size, the leading, the column — is a property of the type, and
  // where the lines sit against each other is a property of the block. It is
  // also the control somebody reaches for most and the only one in the section
  // that is a bar rather than a row, so at the top it gives the section a lid.
  const style = panel.section("Style");
  style.appendChild(
    h(
      "div",
      { class: "inspect-stack" },
      optionSegmented(
        [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ],
        item.align,
        (align) => write({ align: align as TextItem["align"] }),
      ).root,
      fontButton(item, (font) => write({ font })),
      ...sizeRows(item, textId, (size) => write({ size })),
      // Against the size rather than in pixels, which is what a leading *is*:
      // a note retyped twice as big keeps its spacing without anybody
      // re-deciding.
      numberRow(
        "Line height",
        "×",
        item.lineHeight ?? DEFAULT_LINE_HEIGHT,
        0.5,
        4,
        (lineHeight) => write({ lineHeight }),
        0.05,
      ),
      // Wrapping used to be a section of its own, which made a heading out of
      // a switch: it is one of the four or five decisions about how the words
      // are set, and it belongs beside the leading it interacts with.
      switchRow(
        "Wrap the words",
        item.wrapWidth !== undefined,
        // The column starts at whatever the note is already as wide as, so
        // turning it on reflows nothing and the handle appears where the words
        // already end. Turning it off drops the width rather than remembering
        // it: an invisible column that comes back on the next toggle is a
        // number nobody can see and nobody asked to keep.
        (on) =>
          write({ wrapWidth: on ? Math.max(32, Math.round(item.width)) : undefined }),
        "Off, a line ends where you put a new line. On, the words are broken " +
          "into a column you can drag the width of on the canvas.",
      ),
      item.wrapWidth === undefined
        ? null
        : numberRow("Column", "px", Math.round(item.wrapWidth), 32, 4000, (wrapWidth) =>
            write({ wrapWidth }),
          ),
    ),
  );

  // Only where it means anything. On an orthogonal or blank project the grid's
  // plane *is* the screen, so the switch would be a control that does nothing
  // — and a switch that does nothing is worse than no switch, because it says
  // the feature is broken rather than inapplicable.
  if (grid.projection === "isometric") {
    const aligned = panel.section("Grid Alignment");
    aligned.appendChild(
      h(
        "div",
        { class: "inspect-stack" },
        switchRow(
          "Align to the grid",
          item.tracksGrid === true,
          (on) => write({ tracksGrid: on || undefined }),
          "The words are laid along the grid's own two axes, so they read as " +
            "part of the world rather than floating in front of it.",
        ),
        // The two halves of the orientation, and they only exist inside the
        // switch: a note drawn flat has no axis to run along and no plane to
        // stand up in, so offering either would be offering a choice with no
        // subject. **Two controls rather than four named orientations**,
        // because they are two independent decisions — which axis, and which
        // way up — and a list of four would be a list somebody has to decode.
        //
        // They share a row and not an outline. Inside one border the three
        // buttons would read as one choice of three, and pressing Upright
        // would look like it turned the axis off; the gap between the two
        // outlines is what says there are two questions here. See
        // `.inspect-bar`.
        item.tracksGrid
          ? h(
              "div",
              { class: "inspect-bar" },
              axes(item.runs ?? "cx", (runs) =>
                write({ runs: runs === "cy" ? "cy" : undefined }),
              ),
              h("button", {
                class: "panel-btn",
                text: "Upright",
                "aria-pressed": String(item.upright === true),
                title:
                  "Lying down, the lines step across the floor. Upright, they " +
                  "step straight down the screen, the way a sign on the face " +
                  "of a wall does.",
                onClick: () => write({ upright: item.upright ? undefined : true }),
              }),
            )
          : null,
      ),
    );
  }

  const picker = createColorPicker({
    value: item.color,
    onChange: (hex) => write({ color: hex }),
  });
  panel.section("Colour").appendChild(picker.root);

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
 * The size: a menu of the sizes anybody reaches for, and the field they do not.
 *
 * A menu rather than the row of six chips this was, for the reason the row had
 * already outgrown itself — six chips plus a field underneath is seven controls
 * for one number, and the field was always there saying the chips were not
 * enough. Closed, the menu reads as the size; open, it is the same six sizes it
 * always offered with *Custom* at the end of them.
 *
 * **The field is built either way and hidden**, rather than drawn when it is
 * wanted. Asking for it is not a change to the document, so there is nothing to
 * rebuild the panel on — and a panel rebuilt anyway would have to hand the
 * caret back to a field that did not exist when the rebuild started.
 */
function sizeRows(
  item: TextItem,
  textId: string,
  onSize: (size: number) => void,
): HTMLElement[] {
  const open = sizeFieldOpen(textId, item.size);
  const number = optionNumber({
    value: item.size,
    min: 4,
    max: 400,
    step: 1,
    unit: "px",
    label: "Size",
    onChange: onSize,
  });
  // No second *Size* on it: the row above says what it is, and a label
  // repeated under itself reads as a different measurement. The empty key
  // keeps the indent, so the field lines up under the menu it came out of, and
  // `optionNumber` has already named the control for anything reading the
  // page.
  const field = row("", number.root);
  field.hidden = !open;

  const menu = h(
    "button",
    {
      class: "inspect-pick",
      type: "button",
      "aria-label": "Text size",
      onClick: (event: Event) => {
        openMenu(event.currentTarget as HTMLElement, [
          ...SIZES.map((size) => ({
            label: `${size} px`,
            current: !open && size === item.size,
            onSelect: () => {
              openSizeField(null);
              onSize(size);
            },
          })),
          {
            label: "Custom…",
            current: open,
            onSelect: () => {
              openSizeField(textId);
              field.hidden = false;
              number.input.focus();
              number.input.select();
            },
          },
        ]);
      },
    },
    h("span", { text: `${item.size} px` }),
  );

  return [row("Size", menu), field];
}

/**
 * Which of the grid's two diagonals a line of text follows.
 *
 * The tooltip goes on the control itself rather than on a wrapper around it,
 * so the bar it sits in is the segmented control and the button beside it and
 * nothing in between — see `.inspect-bar`, which needs them to be siblings to
 * hand the slack to one and not the other.
 */
function axes(runs: "cx" | "cy", onPick: (runs: string) => void): HTMLElement {
  const control = optionSegmented(
    [
      { value: "cx", label: "NW→SE" },
      { value: "cy", label: "SW→NE" },
    ],
    runs,
    onPick,
  );
  control.root.title = "Which of the grid's two diagonals a line of text follows.";
  return control.root;
}

/** A labelled row, and whatever control belongs at the end of it. */
function row(label: string, control: Node, hint?: string): HTMLElement {
  return h(
    "div",
    { class: "inspect-row", ...(hint ? { title: hint } : {}) },
    h("span", { class: "inspect-key m", text: label }),
    control,
  );
}

/** A labelled row with a switch at the end of it. */
function switchRow(
  label: string,
  on: boolean,
  onChange: (on: boolean) => void,
  hint?: string,
): HTMLElement {
  return row(label, optionSwitch(on, onChange, label).root, hint);
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
  return row(
    label,
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
  // The words rather than the source. A heading reading `**door**` would be
  // showing the typing rather than the note.
  const line = plainText(item.text.split("\n")[0] ?? "").trim();
  if (!line) return "Empty";
  return line.length > 28 ? `${line.slice(0, 27)}…` : line;
}
