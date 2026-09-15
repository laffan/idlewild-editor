/**
 * The pattern editor's left-hand column: everything the pointer is not.
 *
 * Upstream's toolbar, rebuilt in this shell's own controls and with one
 * addition that is not cosmetic. Three of its features are reached there by
 * holding a key — ⌘ for the selection, space for the pan, X for the eraser —
 * and this editor runs on an iPad, where two of those keys do not exist. So
 * what was a modifier is a **mode** here as well: Draw, Select and Pan are a
 * segmented control, the keys still work for anyone who has them, and the
 * two readings stay in step because both write the same field.
 */

import { h, ICONS, icon } from "../../lib/dom";
import { brushIcon } from "./brushes";
import {
  MAX_SIZE,
  MIN_SIZE,
  SIZE_PRESETS,
  selectionBounds,
  type BrushKind,
  type PatternEditorState,
  type PatternMode,
} from "./state";

export interface PatternPanelActions {
  state: () => PatternEditorState;
  /** Something changed: repaint the canvases and re-sync the controls. */
  changed: () => void;
  setSize: (size: number) => void;
  setMode: (mode: PatternMode) => void;
  invert: () => void;
  nudge: (dx: number, dy: number) => void;
  importImage: () => void;
  exportPng: () => void;
  uploadBrush: () => void;
  forgetBrush: () => void;
  brushFromSelection: () => void;
  fillSelection: (value: number) => void;
  clearSelection: () => void;
}

export interface PatternPanel {
  root: HTMLElement;
  sync: () => void;
}

const BRUSHES: Array<{ id: BrushKind; label: string }> = [
  { id: "square", label: "Square" },
  { id: "round", label: "Round" },
  { id: "airbrush", label: "Airbrush" },
  { id: "custom", label: "Custom" },
];

const MODES: Array<{ id: PatternMode; label: string; hint: string }> = [
  { id: "draw", label: "Draw", hint: "Drag to paint; hold shift for a straight line" },
  {
    id: "select",
    label: "Select",
    // The line that used to sit under the row as a `lib-hint`, on the button
    // it was about: it only ever applied to this one mode.
    hint:
      "Drag a box — fill it, clear it, or make a brush of it. Drag inside " +
      "the box to move what it holds, or its corner to repeat that across " +
      "the new size.",
  },
  { id: "pan", label: "Pan", hint: "Drag the pattern under the box to change its phase" },
];

export function patternToolbar(actions: PatternPanelActions): PatternPanel {
  const root = h("div", { class: "lib-tools" });
  const syncs: Array<() => void> = [];

  // ── the grid ──────────────────────────────────────────────────────────────
  const sizeRow = h("div", { class: "lib-chips" });
  const sizeField = h("input", {
    class: "lib-number",
    type: "number",
    min: String(MIN_SIZE),
    max: String(MAX_SIZE),
    "aria-label": "Custom grid size",
    onChange: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      if (Number.isFinite(next)) actions.setSize(next);
    },
  });
  for (const size of SIZE_PRESETS) {
    const button = h("button", {
      class: "lib-chip",
      text: String(size),
      onClick: () => actions.setSize(size),
    });
    sizeRow.appendChild(button);
    syncs.push(() => {
      button.setAttribute("aria-pressed", String(actions.state().pattern.size === size));
    });
  }
  syncs.push(() => {
    sizeField.value = String(actions.state().pattern.size);
  });
  root.append(
    section(
      "Grid",
      "How many cells the tile is across. The pattern repeats every one of " +
        "them, so this is the whole of its size.",
      sizeRow,
      labelled("Custom", sizeField),
    ),
  );

  // ── the tip ───────────────────────────────────────────────────────────────
  const brushRow = h("div", { class: "lib-brushes" });
  for (const brush of BRUSHES) {
    const button = h("button", {
      class: "lib-brush",
      title: brush.label,
      "aria-label": brush.label,
      onClick: () => {
        const state = actions.state();
        if (brush.id === "custom" && !state.customBrush) return;
        state.brush = brush.id;
        actions.changed();
      },
    });
    brushRow.appendChild(button);
    syncs.push(() => {
      const state = actions.state();
      button.replaceChildren(brushIcon(brush.id, 20, state.customBrush));
      button.setAttribute("aria-pressed", String(state.brush === brush.id));
      button.disabled = brush.id === "custom" && !state.customBrush;
    });
  }

  const erase = h("button", {
    class: "lib-toggle",
    text: "Erase",
    title: "Rub cells out instead of filling them (X)",
    onClick: () => {
      const state = actions.state();
      state.erasing = !state.erasing;
      actions.changed();
    },
  });
  syncs.push(() => erase.setAttribute("aria-pressed", String(actions.state().erasing)));

  const sizeSlider = slider("Size", 1, 16, () => actions.state().brushSize, (next) => {
    actions.state().brushSize = next;
    actions.changed();
  });
  syncs.push(sizeSlider.sync);

  const density = slider("Density", 3, 100, () => actions.state().density, (next) => {
    actions.state().density = next;
    actions.changed();
  }, (v) => `${v}%`);
  syncs.push(() => {
    density.sync();
    density.root.hidden = actions.state().brush !== "airbrush";
  });

  const forget = h("button", {
    class: "lib-link",
    text: "Forget the custom tip",
    onClick: () => actions.forgetBrush(),
  });
  syncs.push(() => {
    forget.hidden = actions.state().customBrush === null;
  });

  root.append(
    section(
      "Brush",
      "The tip a drag paints with, and how wide it is.",
      // Size first, under the heading. It is the number that changes most
      // often and the one the other controls are read against — a tip four
      // cells wide is a different tool from the same tip one cell wide — so
      // it was the wrong thing to have to scroll past two rows of buttons to
      // reach.
      sizeSlider.root,
      brushRow,
      erase,
      density.root,
      h("button", {
        class: "lib-link",
        text: "Upload a tip…",
        onClick: () => actions.uploadBrush(),
      }),
      forget,
    ),
  );

  // ── what the pointer is for ───────────────────────────────────────────────
  const modeRow = h("div", { class: "seg" });
  for (const mode of MODES) {
    const button = h("button", {
      class: "seg-opt",
      text: mode.label,
      title: mode.hint,
      onClick: () => actions.setMode(mode.id),
    });
    modeRow.appendChild(button);
    syncs.push(() =>
      button.setAttribute("aria-pressed", String(actions.state().mode === mode.id)),
    );
  }

  const nudgeRow = h(
    "div",
    { class: "lib-nudge" },
    nudge("Up", ICONS.chevronUp, () => actions.nudge(0, -1)),
    nudge("Left", ICONS.chevronLeft, () => actions.nudge(-1, 0)),
    nudge("Right", ICONS.chevronRight, () => actions.nudge(1, 0)),
    nudge("Down", ICONS.chevronDown, () => actions.nudge(0, 1)),
  );

  const selectionRow = h(
    "div",
    { class: "lib-row-buttons" },
    h("button", { class: "btn btn-ghost", text: "Fill", onClick: () => actions.fillSelection(1) }),
    h("button", { class: "btn btn-ghost", text: "Clear", onClick: () => actions.fillSelection(0) }),
    h("button", {
      class: "btn btn-ghost",
      text: "Make a tip",
      title: "Turn what is inside the box into a custom brush",
      onClick: () => actions.brushFromSelection(),
    }),
    h("button", { class: "btn btn-ghost", text: "Deselect", onClick: () => actions.clearSelection() }),
  );
  syncs.push(() => {
    selectionRow.hidden = selectionBounds(actions.state()) === null;
  });

  root.append(
    section(
      "Pointer",
      "What a drag on the tile does: paint with the tip, sweep a box, or " +
        "push the pattern around to change its phase.",
      modeRow,
      nudgeRow,
      selectionRow,
    ),
  );

  // ── the whole grid at once ────────────────────────────────────────────────
  root.append(
    section(
      "Pattern",
      "What to do to the whole tile at once.",
      h(
        "div",
        { class: "lib-row-buttons" },
        h("button", { class: "btn btn-ghost", text: "Invert", onClick: () => actions.invert() }),
        h("button", { class: "btn btn-ghost", text: "Import image…", onClick: () => actions.importImage() }),
        h("button", { class: "btn btn-ghost", text: "Save PNG…", onClick: () => actions.exportPng() }),
      ),
    ),
  );

  return {
    root,
    sync: () => {
      for (const run of syncs) run();
    },
  };
}

/**
 * One block of the toolbar, with what it is for on its heading.
 *
 * The explanation is a tooltip rather than a line of prose under the title:
 * this column is 210 pixels wide and everything in it has to be reachable
 * without scrolling past a paragraph that only ever needs reading once.
 */
function section(
  title: string,
  hint: string | null,
  ...children: (Node | null)[]
): HTMLElement {
  return h(
    "div",
    { class: "lib-section" },
    h("div", { class: "lib-section-title m", text: title, title: hint }),
    ...children,
  );
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  return h(
    "label",
    { class: "lib-field" },
    h("span", { class: "m", text: label }),
    control,
  );
}

function nudge(label: string, path: string | readonly string[], onClick: () => void): HTMLElement {
  return h(
    "button",
    { class: "lib-nudge-btn", title: `Shift ${label.toLowerCase()}`, "aria-label": label, onClick },
    icon(path, 16),
  );
}

/** A labelled range with a readout that keeps itself current. */
function slider(
  label: string,
  min: number,
  max: number,
  read: () => number,
  write: (value: number) => void,
  format: (value: number) => string = String,
): { root: HTMLElement; sync: () => void } {
  const readout = h("div", { class: "lib-readout", text: format(read()) });
  const input = h("input", {
    type: "range",
    class: "lib-slider",
    min: String(min),
    max: String(max),
    step: "1",
    "aria-label": label,
    onInput: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(next)) return;
      readout.textContent = format(next);
      write(next);
    },
  });
  const root = h(
    "div",
    { class: "lib-field" },
    h("span", { class: "m", text: label }),
    input,
    readout,
  );
  return {
    root,
    sync: () => {
      input.value = String(read());
      readout.textContent = format(read());
    },
  };
}
