/**
 * The inspector's simpler panels.
 *
 * A document layer, a selected region, a lasso of strokes, a boundary, a
 * point and several images caught by a marquee. None of them holds state — they read the document,
 * write some rows, and offer whatever buttons make sense for the thing — so
 * they are functions over a small surface rather than methods on the panel
 * that happens to host them. `placement` and `fill` stay in `inspector.ts`,
 * where the colour picker, the PSD layer list and the name field they own
 * also live.
 */

import { h } from "../lib/dom";
import { strokesBox } from "../drawing";
import { count } from "./layers-panel";
import { unionRect } from "../game/instance";
import type { DocStore } from "../lib/doc-store";
import { describeRange, type Grid } from "../lib/grid";
import type { FillPatch, Selection } from "../lib/types";

/**
 * What a panel writes into: the inspector's own body and its row helpers.
 *
 * Narrow on purpose — the panels below need nowhere near the whole class,
 * and saying so is what lets them be read on their own.
 */
export interface PanelSurface {
  body: HTMLElement;
  head(kicker: string, title: string): void;
  section(title?: string): HTMLElement;
  row(key: string, value: string): void;
  /** What to show when the thing selected has gone from the document. */
  empty(): void;
  /**
   * The colour picker, and Fill / Use Image beside it.
   *
   * The inspector's own, because it remembers recent swatches across
   * selections and so cannot be rebuilt per render like everything else here.
   */
  fillSection(fill: FillPatch | undefined): void;
}

/** The buttons these panels offer. */
export interface PanelActions {
  onDeleteSelection: () => void;
  onExportSelection: () => void;
  onStrokesToPsd: () => void;
  onStrokesToZone: () => void;
  /** Get rid of a whole document layer — the shell asks before it does. */
  onDeleteLayer: (layerId: string) => void;
}

/**
 * A document layer: what is on it, and the way to get rid of it.
 *
 * The counts are the same ones the left panel puts in its grey column, said
 * in full — and Delete layer sits under them, beside the tally of everything
 * that would go with it. The left panel can add a layer, reorder, rename,
 * lock and hide one; removing one is the one thing it never offered, and it
 * belongs where the consequences are listed.
 *
 * Refused rather than hidden for the last layer of a scene: a button that
 * vanishes tells nobody why.
 */
export function renderLayer(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "layer" }>,
): void {
  const layer = store.layer(selection.layerId);
  if (!layer) return panel.empty();

  panel.head("Layer", layer.name);
  panel.section("Info");
  panel.row("Locked", layer.locked ? "Yes" : "No");
  panel.row("Visible", layer.visible ? "Yes" : "No");
  panel.row("Images", String(layer.placements.length));
  panel.row("Fills", String(layer.fills.length));
  panel.row("Boundaries", String(layer.zones.length));
  panel.row("Strokes", String(layer.strokes.length));

  const last = store.layers.length <= 1;
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      last
        ? h("div", {
            class: "field-hint",
            text: "A scene keeps at least one layer.",
          })
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

export function renderRegion(
  panel: PanelSurface,
  grid: Grid,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "region" }>,
): void {
  const { from, to } = selection;
  const bounds = grid.rangeBounds(from, to);
  panel.head("Selection", describeRange(grid, from, to));
  panel.section("Info");
  panel.row("Origin", `${Math.min(from.cx, to.cx)}, ${Math.min(from.cy, to.cy)}`);
  panel.row("Pixels", `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`);
  panel.row("Template", grid.projection);
  // A blank project has a nominal unit but does not round to it, and a row
  // that said "Grid: 64 px" over a selection that ignored it would lie.
  panel.row("Grid", grid.snaps ? `${grid.size} px` : "no snapping");
  // The colour picker, which belongs to the inspector rather than to this
  // panel: it holds recent swatches across selections, so it outlives every
  // render and is reached through the surface.
  panel.fillSection(undefined);

  // Exporting a selection as a PNG used to be a button on the floating
  // action bar, beside Fill and Add Image. It was the odd one out there —
  // those two turn space into content and this sends content out — so it
  // sits here with the rest of what is true about a selection.
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn",
        text: "Export as PNG",
        onClick: actions.onExportSelection,
      }),
    ),
  );
}
/**
 * Several images, caught by a marquee.
 *
 * Deliberately thin. There is nothing to say about a group of images that is
 * true of all of them — they have different files, sizes and anchors — so
 * this says what was caught, lists it, and offers the one thing that makes
 * sense on the lot: getting rid of them. Everything else is reached by
 * picking one.
 */
export function renderPlacements(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "placements" }>,
): void {
  const layer = store.layer(selection.layerId);
  if (!layer) return panel.empty();
  const chosen = new Set(selection.ids);
  const placements = layer.placements.filter((p) => chosen.has(p.id));
  if (placements.length === 0) return panel.empty();

  panel.head("Selection", count(placements.length, "image"));
  panel.section("Info");
  panel.row("Layer", layer.name);
  const box = unionRect(placements);
  if (box) {
    panel.row("Size", `${Math.round(box.width)} \u00d7 ${Math.round(box.height)}`);
    panel.row("Origin", `${Math.round(box.x)}, ${Math.round(box.y)}`);
  }

  panel.section("Images");
  for (const placement of placements) {
    panel.row(`${placement.psdKey}.psd`, placement.layerPath);
  }

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("div", {
        class: "field-hint",
        text: "Drag to move them together. Tap one to work on it.",
      }),
      h("button", {
        class: "panel-btn",
        text: "Delete images",
        onClick: actions.onDeleteSelection,
      }),
    ),
  );
}

/**
 * A lasso selection. The two buttons are the drawing layer's only exits:
 * the sketch becomes a game object, or it becomes a region play mode can
 * walk around. Both consume the strokes — see editor/stroke-actions.
 */
export function renderStrokes(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "strokes" }>,
): void {
  const { layerId, ids } = selection;
  const layer = store.layer(layerId);
  if (!layer) return panel.empty();
  const strokes = layer.strokes.filter((s) => ids.includes(s.id));
  if (strokes.length === 0) return panel.empty();

  panel.head("Sketch", count(strokes.length, "stroke"));
  panel.section("Info");
  panel.row("Layer", layer.name);
  const box = strokesBox(strokes);
  if (box) {
    panel.row("Size", `${Math.round(box.width)} × ${Math.round(box.height)}`);
    panel.row("Origin", `${Math.round(box.x)}, ${Math.round(box.y)}`);
  }

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn primary",
        text: "Convert to PSD",
        onClick: () => actions.onStrokesToPsd(),
      }),
      h("button", {
        class: "panel-btn",
        text: "Convert to boundary",
        onClick: () => actions.onStrokesToZone(),
      }),
      h("button", {
        class: "panel-btn",
        text: "Delete strokes",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}
export function renderZone(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "zone" }>,
): void {
  const { layerId, zoneId } = selection;
  const zone = store.layer(layerId)?.zones.find((z) => z.id === zoneId);
  if (!zone) return panel.empty();
  panel.head("Boundary", zone.name);
  panel.section("Info");
  panel.row("Points", String(zone.points.length));
  panel.row("Blocking", zone.blocking ? "Yes" : "No");
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn",
        text: "Delete boundary",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}
