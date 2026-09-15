/**
 * The pattern controls: what a pattern layer does with what is on it.
 *
 * Shown for the layer itself and for the PSD placed on it, because on a
 * pattern layer those are the same subject — the file *is* the pattern's
 * palette, and the only thing there is to say about a palette is what the
 * rule does with it. A pattern layer has no canvas selection of its own
 * (`picking.ts` makes it inert), so this panel is reached from the left
 * sidebar, which is where the rule actually lives.
 *
 * Four things, in the order somebody reaches for them: which arrangement,
 * how much of it, how big the repeat is, and where it is allowed to be.
 */

import { h, ICONS, icon } from "../lib/dom";
import { count } from "./layer-items";
import { sectionTitle } from "./inspect-collapse";
import type { DocStore } from "../lib/doc-store";
import {
  patternSpec,
  PATTERN_DEFAULTS,
  removePatternShape,
  setPatternDensity,
  setPatternRepeat,
  setPatternType,
  shufflePattern,
} from "../lib/layer-kinds";
import type { Layer, PatternShape, PatternType } from "../lib/types";
import type { PanelActions, PanelSurface } from "./inspect-panels";

/** What the panel needs from the shell to make a shape. */
export interface PatternActions {
  /**
   * Open the mask editor on a shape, or on a new one when `shapeId` is null.
   *
   * One entry point where there were two, because making a shape is now a
   * *mode* rather than a request the editor holds while you go and do
   * something else — see `game/mask-mode.ts`. The shell's, because entering a
   * canvas mode means putting the rail's tool down and dimming what is not
   * the subject, and a panel knows nothing about either.
   */
  onEditShape: (layerId: string, shapeId: string | null) => void;
}

const TYPES: readonly { type: PatternType; label: string }[] = [
  { type: "random", label: "Random" },
  { type: "grid", label: "Grid" },
];

/**
 * The whole pattern section.
 *
 * Returns the elements rather than writing into the panel, like
 * `inspect-brush.ts`, because two selections show it — the layer and the file
 * on it — and neither should have to know how the other lays out.
 */
export function patternSection(
  store: DocStore,
  layer: Layer,
  actions: PatternActions,
): HTMLElement[] {
  const spec = patternSpec(layer);
  const out: HTMLElement[] = [];

  out.push(
    h(
      "div",
      { class: "inspect-section" },
      sectionTitle("Pattern", {
        hint:
          spec.type === "grid"
            ? "Evenly spaced, and which element stands where still varies."
            : "Scattered. The same space always answers the same way, so the " +
              "pattern is the same one every time you come back to it.",
      }),
      h(
        "div",
        { class: "seg" },
        ...TYPES.map(({ type, label }) =>
          h("button", {
            class: "seg-opt",
            "aria-pressed": String(type === spec.type),
            text: label,
            onClick: () => setPatternType(store, layer.id, type),
          }),
        ),
      ),
    ),
  );

  // Density and the repeat boundary are two sections rather than two headings
  // inside one: a section is the unit the panel folds away, and a heading that
  // is not a section's own is a heading that closes its neighbours with it.
  const density = h(
    "div",
    { class: "inspect-section" },
    sectionTitle("Density", {
      hint: "How many elements stand in each repeat of the boundary below.",
    }),
    numberRow("Per tile", spec.density, 1, 200, (n) =>
      setPatternDensity(store, layer.id, n),
    ),
  );
  // Only for a scatter: a grid pattern has no randomness to re-roll, so the
  // button would do nothing and say it did something.
  if (spec.type === "random") {
    density.appendChild(
      h("button", {
        class: "panel-btn",
        text: "Shuffle",
        onClick: () => shufflePattern(store, layer.id),
      }),
    );
  }
  out.push(density);

  out.push(
    h(
      "div",
      { class: "inspect-section" },
      sectionTitle("Repeat boundary", {
        hint:
          `Spaces. ${PATTERN_DEFAULTS[spec.type].repeat.cols} × ` +
          `${PATTERN_DEFAULTS[spec.type].repeat.rows} is the default for a ` +
          `${spec.type} pattern — the arrangement repeats every one of ` +
          "these, which is what makes it infinite.",
      }),
      h(
        "div",
        { class: "field-row" },
        numberField(spec.repeat.cols, 1, 500, (n) =>
          setPatternRepeat(store, layer.id, n, spec.repeat.rows),
        ),
        h("span", { class: "field-x", text: "×" }),
        numberField(spec.repeat.rows, 1, 500, (n) =>
          setPatternRepeat(store, layer.id, spec.repeat.cols, n),
        ),
      ),
    ),
  );

  out.push(shapesSection(store, layer, actions));
  return out;
}

/**
 * Where the pattern is allowed to be.
 *
 * An empty list is the default and it means everywhere — which is the whole
 * of what makes a fresh pattern layer infinite, and worth saying in words
 * rather than leaving as an empty box somebody has to guess about.
 */
function shapesSection(
  store: DocStore,
  layer: Layer,
  actions: PatternActions,
): HTMLElement {
  const spec = patternSpec(layer);
  const section = h(
    "div",
    { class: "inspect-section" },
    // Counted in the heading, because the list is the subject of this
    // section rather than a footnote under the buttons.
    sectionTitle(spec.shapes.length ? `Shapes · ${spec.shapes.length}` : "Shapes", {
      hint: "Where the pattern is allowed to be. No shapes means everywhere.",
    }),
  );

  if (spec.shapes.length === 0) {
    section.appendChild(
      h("div", {
        class: "field-hint",
        text: "No shapes — the pattern goes on for ever. Add one to confine it.",
      }),
    );
  } else {
    for (const shape of spec.shapes) {
      section.appendChild(shapeRow(store, layer.id, shape, actions));
    }
  }

  section.append(
    h("button", {
      class: "panel-btn",
      text: "Add shape",
      title:
        "Opens the shape editor: sweep the ground the pattern may use, and " +
        "Remove to take spaces back out. A patch of grid you have already " +
        "selected has Pattern Shape on the bar over it, which starts one from " +
        "those spaces.",
      onClick: () => actions.onEditShape(layer.id, null),
    }),
  );
  return section;
}

function shapeRow(
  store: DocStore,
  layerId: string,
  shape: PatternShape,
  actions: PatternActions,
): HTMLElement {
  const spaces = shape.cells?.length ?? 0;
  return h(
    "div",
    { class: "inspect-row shape-row" },
    // How it was made as well as how big it is: a drawn shape keeps its
    // outline and a swept one does not, which is the difference between
    // the two rows anybody would want to tell apart.
    icon(shape.points ? ICONS.pencil : ICONS.select, 12),
    h("span", { class: "inspect-key m", text: shape.name }),
    h("span", {
      class: "inspect-value m",
      text: count(spaces, "space"),
    }),
    // Edit before Remove, and both on the row rather than behind a selected
    // state: a shape has no canvas selection of its own — `picking.ts` makes
    // the whole layer inert — so the row *is* how it is reached.
    h("button", {
      class: "row-btn",
      "aria-label": `Edit ${shape.name}`,
      text: "Edit",
      onClick: () => actions.onEditShape(layerId, shape.id),
    }),
    h("button", {
      class: "row-btn",
      "aria-label": `Remove ${shape.name}`,
      text: "Remove",
      onClick: () => removePatternShape(store, layerId, shape.id),
    }),
  );
}

function numberRow(
  label: string,
  value: number,
  low: number,
  high: number,
  onCommit: (n: number) => void,
): HTMLElement {
  return h(
    "div",
    { class: "field-row" },
    h("span", { class: "inspect-key m", text: label }),
    numberField(value, low, high, onCommit),
  );
}

/**
 * One number, committed on change rather than per keystroke.
 *
 * The panel is rebuilt on every document change — including the one this
 * causes — so committing as each digit is typed would replace the field under
 * the caret after the first one.
 */
function numberField(
  value: number,
  low: number,
  high: number,
  onCommit: (n: number) => void,
): HTMLInputElement {
  const input = h("input", {
    class: "input field-num",
    type: "number",
    min: String(low),
    max: String(high),
    step: "1",
  }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener("change", () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n)) {
      input.value = String(value);
      return;
    }
    onCommit(Math.max(low, Math.min(high, n)));
  });
  return input;
}

/**
 * A pattern layer's whole panel.
 *
 * `renderLayer` counts what is standing on a layer, which on this one would
 * be counting the wrong thing: the placements are the palette the pattern is
 * made of, and the numbers anybody wants are the pattern's own.
 */
export function renderPatternLayer(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions & PatternActions,
  layer: Layer,
): void {
  const spec = patternSpec(layer);
  panel.head("Pattern layer", layer.name);
  panel.section("Info");
  panel.row("Elements", String(layer.placements.length));
  panel.row("Arrangement", spec.type === "grid" ? "Grid" : "Random");
  panel.row("Repeat", `${spec.repeat.cols} × ${spec.repeat.rows} spaces`);
  panel.row(
    "Confined to",
    spec.shapes.length === 0 ? "everywhere" : `${spec.shapes.length} shapes`,
  );

  panel.body.append(...patternSection(store, layer, actions));

  const last = store.layers.length <= 1;
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      last
        ? h("div", { class: "field-hint", text: "A scene keeps at least one layer." })
        : null,
      h("button", {
        class: "panel-btn",
        text: "Delete layer",
        disabled: last ? "true" : null,
        onClick: () => actions.onDeleteLayer(layer.id),
      }),
    ),
  );
}
