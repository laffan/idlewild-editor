/**
 * The inspector's drawing-tool panel: what the pencil, the eraser and the
 * lasso show while one of them holds the pointer and nothing is selected.
 *
 * Split from the inspector because it is the one panel there that inspects
 * nothing — it has no selection behind it, reads neither the document nor the
 * grid, and only ever reports a style change back. That makes it a function
 * of its arguments rather than a method, and the inspector's own file
 * shorter by the length of the tool rail's whole half of the panel.
 *
 * Hush puts these controls in four brush slots with an edit flyout each; here
 * there is one brush at a time, because the editor's pencil is for sketching
 * a game object rather than for finished drawing.
 */

import { h } from "../lib/dom";
import { BRUSHES, type DrawingTool, type StrokeStyle } from "../drawing";
import { createColorPicker } from "../lib/color-picker";

/** The rows the inspector should append. Empty when there is nothing to show. */
export function brushPanel(
  tool: DrawingTool,
  style: StrokeStyle,
  onStyle: (patch: Partial<StrokeStyle>) => void,
): HTMLElement[] {
  if (tool === "eraser") {
    return note(
      "Eraser",
      "Slice",
      "Drag across a stroke to cut it where the disc passes. A stroke cut " +
        "through the middle becomes two.",
    );
  }

  if (tool === "lasso") {
    return note(
      "Lasso",
      "Select strokes",
      "Sweep a loop around a sketch to select it, then hand it to this layer " +
        "as a PSD or as a boundary.",
    );
  }

  const name = h("div", {
    class: "inspect-title",
    text: BRUSHES.find((b) => b.id === style.brushId)?.name ?? "Ink",
  });

  const brushes = h("div", { class: "brush-row" });
  for (const brush of BRUSHES) {
    const button = h("button", {
      class: "brush-btn",
      title: brush.name,
      text: String(brush.id),
      "aria-pressed": String(brush.id === style.brushId),
      onClick: () => {
        for (const other of brushes.children) {
          other.setAttribute("aria-pressed", String(other === button));
        }
        name.textContent = brush.name;
        onStyle({ brushId: brush.id });
      },
    });
    brushes.appendChild(button);
  }

  const size = slider("Size", style.size, 1, 48, (next) => `${next} px`, (next) =>
    onStyle({ size: next }),
  );
  // Straightening, not thickness: the two sliders are the same control and
  // sit together, because between them they are the whole shape of a line.
  const smoothing = slider(
    "Smoothing",
    style.smoothing,
    0,
    100,
    (next) => (next === 100 ? "straight" : String(next)),
    (next) => onStyle({ smoothing: next }),
  );

  const picker = createColorPicker({
    value: style.color,
    onChange: (hex) => onStyle({ color: hex }),
    onCommit: (hex) => onStyle({ color: hex }),
  });

  return [
    h(
      "div",
      { class: "inspect-head" },
      h("div", { class: "inspect-kicker m", text: "Pencil" }),
      name,
    ),
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "Brush" }),
      brushes,
      size,
      smoothing,
    ),
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "Colour" }),
      picker.root,
    ),
  ];
}

/**
 * One labelled range with its own readout, as both of the brush's numbers
 * want to be.
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

/** A tool with nothing to set: a heading and a sentence saying what it does. */
function note(kicker: string, title: string, body: string): HTMLElement[] {
  return [
    h(
      "div",
      { class: "inspect-head" },
      h("div", { class: "inspect-kicker m", text: kicker }),
      h("div", { class: "inspect-title", text: title }),
    ),
    h("div", { class: "inspect-empty", text: body }),
  ];
}
