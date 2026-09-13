/**
 * A backdrop's own panel: a colour, or two colours and a direction.
 *
 * There is nothing here about size or position, and that is the point. A
 * backdrop is camera-locked and has no extent — it is wherever you are
 * looking — so the whole of what there is to say about one is what colour it
 * is. See `game/background-render.ts` for why that is the reading rather than
 * a very large rectangle.
 *
 * The colour picker is the inspector's own, handed in: it remembers recent
 * swatches across selections and so cannot be rebuilt per render like
 * everything else in this file.
 */

import { h } from "../lib/dom";
import { createColorPicker } from "../lib/color-picker";
import type { DocStore } from "../lib/doc-store";
import { backgroundsOf, updateBackground } from "../lib/layer-kinds";
import type { Background, Selection } from "../lib/types";
import type { PanelSurface } from "./inspect-panels";

export interface BackgroundActions {
  onDeleteSelection: () => void;
}

/** The angles a gradient is offered at, and what each one is for. */
const ANGLES: readonly { angle: number; label: string }[] = [
  { angle: 0, label: "↓" },
  { angle: 90, label: "→" },
  { angle: 180, label: "↑" },
  { angle: 270, label: "←" },
  { angle: 45, label: "↘" },
  { angle: 315, label: "↙" },
];

export function renderBackground(
  panel: PanelSurface,
  store: DocStore,
  actions: BackgroundActions,
  selection: Extract<Selection, { kind: "background" }>,
): void {
  const { layerId, backgroundId } = selection;
  const layer = store.layer(layerId);
  const background = backgroundsOf(layer).find((b) => b.id === backgroundId);
  if (!layer || !background) return panel.empty();

  panel.editableHead(
    background.kind === "gradient" ? "Gradient" : "Colour",
    background.name,
    "",
    (next) => updateBackground(store, layerId, backgroundId, { name: next }),
  );
  panel.section("Info");
  panel.row("Layer", layer.name);
  panel.row("Covers", "the whole view, wherever the camera is");

  panel.body.append(
    ...(background.kind === "gradient"
      ? gradientControls(store, layerId, background)
      : colourControls(store, layerId, background)),
  );

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn",
        text: "Delete background",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}

function colourControls(
  store: DocStore,
  layerId: string,
  background: Background,
): HTMLElement[] {
  const picker = createColorPicker({
    value: background.color ?? "#2b3b4a",
    onChange: (hex) =>
      updateBackground(store, layerId, background.id, { color: hex }),
  });
  return [
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "Colour" }),
      picker.root,
    ),
  ];
}

/**
 * Two stops and a direction.
 *
 * Two pickers rather than a stop list: a gradient with three stops is a
 * different control and a different record, and every backdrop anybody has
 * asked for here is a sky. The directions are the four squares and the two
 * diagonals that read at a glance rather than a free angle — a sky is
 * vertical, a vignette is diagonal, and nobody types 37°.
 */
function gradientControls(
  store: DocStore,
  layerId: string,
  background: Background,
): HTMLElement[] {
  const held = background.gradient ?? { from: "#6ea8d8", to: "#dfe9f2", angle: 0 };
  const write = (patch: Partial<typeof held>) =>
    updateBackground(store, layerId, background.id, {
      gradient: { ...held, ...patch },
    });

  const from = createColorPicker({
    value: held.from,
    onChange: (hex) => write({ from: hex }),
  });
  const to = createColorPicker({
    value: held.to,
    onChange: (hex) => write({ to: hex }),
  });

  // Three sections rather than three headings inside one: a section is the
  // unit the panel folds away, and a heading that is not a section's own is a
  // heading that closes its neighbours with it.
  return [
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "From" }),
      from.root,
    ),
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "To" }),
      to.root,
    ),
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "Direction" }),
      h(
        "div",
        { class: "seg" },
        ...ANGLES.map(({ angle, label }) =>
          h("button", {
            class: "seg-opt",
            "aria-pressed": String(angle === held.angle),
            text: label,
            title: `${angle}°`,
            onClick: () => write({ angle }),
          }),
        ),
      ),
    ),
  ];
}
