/**
 * The inspector's TOOL section: what the tool in hand has to set.
 *
 * Split from the inspector because it is the one part of that panel that
 * inspects nothing — it has no selection behind it, reads neither the
 * document nor the grid, and only ever reports a change back. That makes it a
 * function of its arguments rather than a method, and the inspector's own
 * file shorter by the length of the whole toolbar's half of the panel.
 *
 * **A tool with nothing to set gets no section at all.** Select, Pan, Point,
 * Boundary, Slice and the Lasso each do one thing with one gesture and
 * have no numbers behind them, so a heading over an explanatory sentence
 * would be a labelled box that never changes — which is exactly what the
 * three zones were introduced to stop. What those tools have to say, they say
 * in their tooltip and in the line the console prints when they are picked
 * up. So this returns null for them, and the inspector shows no TOOL zone.
 *
 * Hush puts these controls in four brush slots with an edit flyout each; here
 * there is one brush at a time, because the editor's pencil is for sketching
 * a game object rather than for finished drawing.
 */

import { h } from "../lib/dom";
import { sectionTitle } from "./inspect-collapse";
import { BRUSHES, brushStampUrl, type FillMode, type StrokeStyle } from "../drawing";
import { createPaintPicker } from "./paint-picker";
import type { Paint, PaintKind } from "../lib/paint";
import type { ToolId } from "../lib/types";
import { canErase } from "./tool-rail";

/** What the TOOL section can change, beyond the style itself. */
export interface ToolPanelActions {
  onStyle: (patch: Partial<StrokeStyle>) => void;
  /**
   * How big a grid space is, in world pixels.
   *
   * Only for the two library editors, which preview a pattern and a shape at
   * the size the project will actually draw them — a dither previewed at some
   * arbitrary zoom tells you nothing about whether it is the density you
   * wanted on *this* grid.
   */
  cell: number;
  /** Which half of the sweep fill is aimed, and the way to change it. */
  fillMode: FillMode;
  onFillMode: (mode: FillMode) => void;
  /**
   * How many corners the point-to-point fill has down.
   *
   * A readout and nothing more: laying the shape down, taking a corner back
   * off and throwing it away are all on the bar that floats beside the shape,
   * where they are in front of the thing they are about.
   */
  fillPoints: number;
  /** Whether the tool in hand is turned round, and the way to turn it. */
  erasing: boolean;
  onErasing: (on: boolean) => void;
}

/** The name the section's heading carries after `TOOL : `. */
export const TOOL_TITLES: Partial<Record<ToolId, string>> = {
  pencil: "Pencil",
  pattern: "Pattern",
  shape: "Shape",
  rub: "Rub",
  fill: "Fill",
};

/**
 * What the TOOL heading says on hover: what this tool *does*, in one line.
 *
 * The Shape brush is why this exists rather than living on a section
 * heading like the others. Its panel was a heading called *Stamp* over a
 * sentence and nothing else — there is no size, because a shape fills a grid
 * space and the space is the project's — so with the sentence on a tooltip
 * the section had nothing left in it, and a heading over an empty box is the
 * thing the three zones were introduced to stop. The line belongs to the
 * tool, so it is on the tool's own heading.
 */
export const TOOL_HINTS: Partial<Record<ToolId, string>> = {
  pencil: "Lays ink down along the path, at the tip and size set below.",
  pattern:
    "Sweep to reveal the pattern. It is pinned to the world rather than to " +
    "the stroke, so two passes line up exactly.",
  shape:
    "Drag across the grid and every space you cross takes one copy, filling " +
    "that space exactly. Crossing a space twice changes nothing.",
  rub:
    "The pencil with the paint taken out. It rubs out ink drawn in this " +
    "session, tip and pressure and all.",
  fill: "Sweeps and tapped-out shapes, filled with a colour, a pattern or a shape.",
};

/**
 * The rows the inspector should put in its TOOL zone, or null for a tool
 * with nothing to set.
 */
export function toolPanel(
  tool: ToolId,
  style: StrokeStyle,
  actions: ToolPanelActions,
): HTMLElement[] | null {
  const rows =
    tool === "fill"
      ? fillPanel(style, actions)
      : tool === "pattern"
        ? patternPanel(style, actions)
        : tool === "shape"
          ? shapePanel(style, actions)
          : tool === "pencil" || tool === "rub"
            ? inkPanel(tool, style, actions)
            : null;
  if (!rows) return null;
  // **First**, above everything the tool sets. It is the biggest thing you can
  // do to a brush without changing it — the same marks, subtracted instead of
  // added — so it belongs at the top rather than buried under the sliders that
  // shape them. The other way in is a long press on the tool's own button; see
  // `tool-rail.ts`.
  if (canErase(tool)) rows.unshift(eraserRow(actions));
  return rows;
}

/**
 * Use as Eraser: what the tool would have drawn, taken out instead.
 *
 * A switch rather than a segmented pair, because there is no second thing to
 * name — a brush either draws or it rubs out, and "Draw / Erase" would be two
 * words for one bit. The hint changes with the state so that the row says what
 * is happening now rather than only what the control does.
 */
function eraserRow(actions: ToolPanelActions): HTMLElement {
  const on = actions.erasing;
  return h(
    "div",
    { class: "inspect-section" },
    h(
      "button",
      {
        class: "panel-btn erase-toggle",
        "aria-pressed": String(on),
        // On the control rather than under it: the hint changes with the
        // state, so what it says is "here is what is happening now", which
        // is a thing to ask for rather than a thing to read every time.
        title: on
          ? "Taking out what it would have drawn. Hold the tool's button on " +
            "the toolbar to turn it back."
          : "Everything this tool would draw, it removes instead. A long " +
            "press on its button does the same.",
        onClick: () => actions.onErasing(!on),
      },
      h("span", { text: "Use as Eraser" }),
    ),
  );
}

/**
 * The paint control, wired to the style.
 *
 * The picker hands back a whole `Paint` — the kind, the row and the colour —
 * and the style keeps those in two fields, so this is where they come apart
 * again. See `lib/paint.ts` for why the colour is not inside the spec.
 */
function paintSection(
  title: string,
  style: StrokeStyle,
  actions: ToolPanelActions,
  kinds: readonly PaintKind[],
  hint?: string,
): HTMLElement {
  const picker = createPaintPicker({
    value: { ...style.paint, color: style.color } as Paint,
    kinds,
    cell: actions.cell,
    onChange: (paint) => {
      const { color, ...spec } = paint;
      actions.onStyle({ color, paint: spec });
    },
  });
  return h(
    "div",
    { class: "inspect-section" },
    sectionTitle(title, { hint }),
    picker.root,
  );
}

/**
 * The Pattern brush: a fill brush whose ink is a pixel pattern.
 *
 * It was *Pixels*, and it was the pencil with a hard checker for a tip —
 * which made it a textured pencil rather than a tool of its own: the checker
 * was stamped along the path, so its phase followed the hand and two strokes
 * that crossed disagreed about where the squares were.
 *
 * It fills now. What a stroke lays down is the pattern's own cells, on a
 * lattice pinned to the world, so drawing over your own tail changes nothing
 * and a second stroke continues the first exactly. The area looks like it was
 * already filled and is being uncovered, which is what a pattern brush does
 * in every pixel-art editor that has one.
 *
 * No brush row, because there is no tip: the size is how wide the opening is,
 * not what shape the paint is.
 */
function patternPanel(
  style: StrokeStyle,
  actions: ToolPanelActions,
): HTMLElement[] {
  return [
    h(
      "div",
      { class: "inspect-section" },
      sectionTitle("Brush", { hint: "How wide the opening onto the pattern is, and how much of the hand's wobble is taken out of it." }),
      // Its own range rather than the pencil's 1–48. This is an opening onto
      // a filled area, so the useful sizes start where a nib's end: at six
      // pixels over a four-pixel lattice what you get is a checkered thread.
      slider("Size", style.size, 4, 200, (next) => `${next} px`, (next) =>
        actions.onStyle({ size: next }),
      ),
      smoothingRow(style.smoothing, (next) => actions.onStyle({ smoothing: next })),
    ),
    paintSection("Pattern", style, actions, ["pattern"], "Which row of the pattern library the brush reveals, and how big its pixels are on this grid."),
  ];
}

/**
 * The Shape brush: every grid space you cross takes a copy of the shape.
 *
 * There is no size here on purpose. A shape fills a **space**, and the space
 * is the project's — so what would a size mean? The shapes come from a
 * tileset generator, where the whole point is that the tile is the unit: half
 * circles meet, quarter circles round a corner, angles run diagonally. A
 * shape stamped at some other size is a decoration rather than a tile.
 */
function shapePanel(style: StrokeStyle, actions: ToolPanelActions): HTMLElement[] {
  // No Stamp section any more. It held one sentence and no control, and the
  // sentence is on the TOOL heading now — see `TOOL_HINTS`.
  return [
    paintSection(
      "Shape",
      style,
      actions,
      ["shape"],
      "Which row of the shape library each space takes a copy of.",
    ),
  ];
}

/**
 * The pencil and its one remaining disguise.
 *
 * Rub is the pencil with the paint taken out, so the colour is not offered:
 * nothing it lays down has one. Pattern used to be the other disguise and is
 * a tool in its own right now — see `patternPanel`.
 */
function inkPanel(
  tool: "pencil" | "rub",
  style: StrokeStyle,
  actions: ToolPanelActions,
): HTMLElement[] {
  const rows: HTMLElement[] = [];

  if (tool === "pencil") {
    // The tip's name is the section's own subject — `BRUSH : INK` — rather
    // than a title of its own above it. It was both, which is one fact
    // written twice and a 19px heading in a column of 10px labels.
    const heading = sectionTitle("Brush", {
      subject: brushName(style.brushId),
      hint: "The tip the pencil draws with, how wide it is, and how much of the hand's wobble comes out of the line.",
    });
    const subject = heading.querySelector(".inspect-section-subject");

    // The tip itself on each button rather than its number. A brush is a
    // shape you recognise, and "3" is not that shape — see `brushStampUrl`
    // for why it is a mask rather than an image.
    const brushes = h("div", { class: "brush-row" });
    for (const brush of BRUSHES) {
      const stamp = h("span", { class: "brush-stamp" });
      const url = `url("${brushStampUrl(brush.id)}")`;
      stamp.style.setProperty("-webkit-mask-image", url);
      stamp.style.setProperty("mask-image", url);
      const button = h(
        "button",
        {
          class: "brush-btn",
          title: brush.name,
          "aria-label": brush.name,
          "aria-pressed": String(brush.id === style.brushId),
          onClick: () => {
            for (const other of brushes.children) {
              other.setAttribute("aria-pressed", String(other === button));
            }
            // Written here rather than waiting for a re-render: picking a tip
            // does not touch the document, so nothing rebuilds this panel.
            if (subject) subject.textContent = brush.name;
            actions.onStyle({ brushId: brush.id });
          },
        },
        stamp,
      );
      brushes.appendChild(button);
    }

    rows.push(
      h(
        "div",
        { class: "inspect-section" },
        heading,
        brushes,
        sizeRow(style, actions),
        smoothingRow(style.smoothing, (next) => actions.onStyle({ smoothing: next })),
      ),
    );
  } else {
    rows.push(
      h(
        "div",
        { class: "inspect-section" },
        sectionTitle("Rubber", { hint: TOOL_HINTS.rub }),
        sizeRow(style, actions),
        smoothingRow(style.smoothing, (next) => actions.onStyle({ smoothing: next })),
      ),
    );
  }

  if (tool !== "rub") {
    rows.push(
      paintSection(
        "Colour",
        style,
        actions,
        ["color"],
        "What the ink is made of. Recent swatches are under the wheel.",
      ),
    );
  }
  return rows;
}

/** The tip's own name, which is what the Brush heading says after the colon. */
function brushName(brushId: number): string {
  return BRUSHES.find((b) => b.id === brushId)?.name ?? "Ink";
}

/**
 * The sweep fill, which is two tools sharing a colour.
 *
 * **Draw** is the gesture: sweep a closed outline and the inside of it fills.
 * It takes the pencil's smoothing for the pencil's own reason — an outline is
 * a line, and a fill shows the hand's wobble more plainly than a line does
 * because there is a flat colour on one side of it.
 *
 * **Point to point** is the same shape tapped out a corner at a time, with
 * every corner still draggable until the shape is laid down. A sweep commits
 * on release and cannot be corrected; this is the half for a shape that has
 * corners in it rather than a gesture behind it.
 *
 * Both halves take a **paint** rather than a colour: the inside of the shape
 * can be a flat colour, a pixel pattern revealed on the world's own lattice,
 * or a field of a library shape laid out on the grid. It is the one tool that
 * offers all three, which is why it is the one that shows the segmented row.
 */
function fillPanel(
  style: StrokeStyle,
  actions: ToolPanelActions,
): HTMLElement[] {
  const points = actions.fillMode === "points";
  const rows: HTMLElement[] = [
    h(
      "div",
      { class: "inspect-section" },
      sectionTitle("Mode", {
        hint:
          "Draw sweeps a closed outline in one gesture. Point to point taps " +
          "the same shape out a corner at a time, and every corner stays " +
          "draggable until it is laid down.",
      }),
      h(
        "div",
        { class: "seg" },
        segment("Draw", !points, () => actions.onFillMode("draw")),
        segment("Point to point", points, () => actions.onFillMode("points")),
      ),
    ),
  ];

  if (points) {
    const down = actions.fillPoints;
    // No buttons. Fill, Undo corner and Cancel are on the bar that floats
    // beside the shape — see `fill-bar.ts` — because a shape is built by
    // looking at the canvas, and a button that finishes it three hundred
    // pixels away in this panel is a button nobody looks at. What is left
    // here is what the panel is for: saying how the tool is aimed.
    rows.push(
      h(
        "div",
        { class: "inspect-section" },
        sectionTitle("Shape", {
          hint:
            down === 0
              ? "Tap the canvas to drop a corner, and drag any corner to move " +
                "it. Fill and Cancel appear beside the shape."
              : "Tap the first corner again to fill, or drag any of them to " +
                "move it.",
        }),
        h(
          "div",
          { class: "inspect-row" },
          h("div", { class: "inspect-key m", text: "Corners" }),
          h("div", { class: "inspect-value", text: String(down) }),
        ),
      ),
    );
  } else {
    rows.push(
      h(
        "div",
        { class: "inspect-section" },
        sectionTitle("Sweep", {
          hint:
            "Sweep a closed outline and the inside of it fills. It lands as " +
            "one thing you can erase or undo, like a stroke.",
        }),
        smoothingRow(style.smoothing, (next) => actions.onStyle({ smoothing: next })),
      ),
    );
  }

  rows.push(
    paintSection(
      "Paint",
      style,
      actions,
      ["color", "pattern", "shape"],
      "What the inside of the shape is made of: a flat colour, a pixel " +
        "pattern on the world's own lattice, or a field of a library shape.",
    ),
  );
  return rows;
}

/**
 * One of a row of mutually exclusive choices, in the panel's own segmented
 * control — the same one a backdrop's direction and a pattern's arrangement
 * use, because this is the same kind of question.
 */
function segment(
  label: string,
  on: boolean,
  onPick: () => void,
): HTMLElement {
  return h("button", {
    class: "seg-opt",
    text: label,
    "aria-pressed": String(on),
    onClick: onPick,
  });
}

function sizeRow(style: StrokeStyle, actions: ToolPanelActions): HTMLElement {
  return slider("Size", style.size, 1, 48, (next) => `${next} px`, (next) =>
    actions.onStyle({ size: next }),
  );
}

/**
 * Straightening, not thickness.
 *
 * At 0 the line follows every tremor; turned up it takes the shake out
 * without moving where the line goes; at 100 it draws nothing but perfectly
 * straight lines, from where the pen went down to where it came up. The two
 * sliders are the same control and sit together, because between them they
 * are the whole shape of a line — and the sweep fill borrows this one on its
 * own, because its outline is a line and nothing about it is a tip.
 */
function smoothingRow(
  value: number,
  onChange: (next: number) => void,
): HTMLElement {
  return slider(
    "Smoothing",
    value,
    0,
    100,
    (next) => (next === 100 ? "straight" : String(next)),
    onChange,
  );
}

/**
 * One labelled range with its own readout, as each of these numbers wants to
 * be.
 *
 * `format` is what the readout says, which is not always the number: the top
 * of the smoothing range is a promise rather than a quantity, so it says
 * *straight* there instead of 100.
 */
function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  format: (value: number) => string,
  onChange: (value: number) => void,
): HTMLElement {
  const readout = h("div", { class: "inspect-value", text: format(value) });
  const input = h("input", {
    class: "brush-size",
    type: "range",
    min: String(min),
    max: String(max),
    step: "1",
    value: String(value),
    "aria-label": label,
    // `input` rather than `change`: the ink should follow the slider.
    onInput: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(next)) return;
      readout.textContent = format(next);
      onChange(next);
    },
  });
  return h(
    "div",
    { class: "inspect-row brush-row-size" },
    h("div", { class: "inspect-key m", text: label }),
    input,
    readout,
  );
}
