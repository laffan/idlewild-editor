/**
 * Right sidebar: the inspector for whatever is selected — a layer, a grid
 * region, a fill, a placed image or a boundary.
 *
 * The spec's Image Edit paragraph says image info appears in the "left
 * Inspector sidebar"; the Layout section puts the inspector on the right, so
 * that is where it is.
 */

import { clear, h } from "../lib/dom";
import { createColorPicker } from "../lib/color-picker";
import type { DocStore } from "../lib/doc-store";
import { Grid, rangeSize } from "../lib/grid";
import type { FillPatch, Placement, Selection } from "../lib/types";

export interface InspectorCallbacks {
  onFillColor: (color: string) => void;
  onToggleWalkable: (walkable: boolean) => void;
  onReparsePsd: (key: string) => void;
  onDeleteSelection: () => void;
  onUsePatternImage: () => void;
}

export class Inspector {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly store: DocStore;
  private readonly grid: Grid;
  private readonly callbacks: InspectorCallbacks;
  private selection: Selection = { kind: "none" };
  /** Carried between selections so the picker reopens where it was left. */
  private lastColor = "#ec3013";
  private suspended = false;

  constructor(
    store: DocStore,
    grid: Grid,
    callbacks: InspectorCallbacks,
  ) {
    this.store = store;
    this.grid = grid;
    this.callbacks = callbacks;

    this.body = h("div", { class: "panel-body scroll" });
    this.root = h(
      "div",
      { class: "side-panel right" },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title m", text: "Inspector" }),
      ),
      this.body,
    );

    store.addEventListener("change", () => {
      if (!this.suspended) this.render();
    });
    this.render();
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("collapsed", collapsed);
  }

  /**
   * Hold re-rendering while the canvas is mid-drag. A drag writes to the
   * document on every pointer move, and rebuilding this panel per frame
   * would throw away the colour picker's state and any half-typed name.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!suspended) this.render();
  }

  /** The colour a new fill should take — whatever the picker last settled on. */
  get fillColor(): string {
    return this.lastColor;
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
    this.render();
  }

  render(): void {
    clear(this.body);
    switch (this.selection.kind) {
      case "none":
        this.renderEmpty();
        break;
      case "layer":
        this.renderLayer(this.selection.layerId);
        break;
      case "region":
        this.renderRegion(this.selection.from, this.selection.to);
        break;
      case "fill":
        this.renderFill(this.selection.layerId, this.selection.fillId);
        break;
      case "placement":
        this.renderPlacement(this.selection.layerId, this.selection.placementId);
        break;
      case "zone":
        this.renderZone(this.selection.layerId, this.selection.zoneId);
        break;
    }
  }

  private head(kicker: string, title: string): void {
    this.body.appendChild(
      h(
        "div",
        { class: "inspect-head" },
        h("div", { class: "inspect-kicker m", text: kicker }),
        h("div", { class: "inspect-title", text: title }),
      ),
    );
  }

  private row(key: string, value: string): void {
    this.body.appendChild(
      h(
        "div",
        { class: "inspect-row" },
        h("div", { class: "inspect-key m", text: key }),
        h("div", { class: "inspect-value", text: value }),
      ),
    );
  }

  private renderEmpty(): void {
    this.body.appendChild(
      h("div", {
        class: "inspect-empty",
        text:
          "Nothing selected. Hold on the canvas to select a run of grid " +
          "spaces, or tap a placed image.",
      }),
    );
  }

  private renderLayer(layerId: string): void {
    const layer = this.store.layer(layerId);
    if (!layer) return this.renderEmpty();
    this.head("Layer", layer.name);
    this.row("Locked", layer.locked ? "Yes" : "No");
    this.row("Visible", layer.visible ? "Yes" : "No");
    this.row("Images", String(layer.placements.length));
    this.row("Fills", String(layer.fills.length));
    this.row("Boundaries", String(layer.zones.length));
    this.row("Strokes", String(layer.strokes.length));
  }

  private renderRegion(
    from: { cx: number; cy: number },
    to: { cx: number; cy: number },
  ): void {
    const { w, h: height } = rangeSize(from, to);
    const bounds = this.grid.rangeBounds(from, to);
    this.head("Selection", `${w} × ${height} spaces`);
    this.row("Origin", `${Math.min(from.cx, to.cx)}, ${Math.min(from.cy, to.cy)}`);
    this.row("Pixels", `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`);
    this.row("Projection", this.grid.projection);
    this.row("Grid", `${this.grid.size} px`);
    this.fillSection(undefined);
  }

  private renderFill(layerId: string, fillId: string): void {
    const fill = this.store.layer(layerId)?.fills.find((f) => f.id === fillId);
    if (!fill) return this.renderEmpty();

    this.head("Filled space", `${fill.cells.length} spaces`);
    this.row("Kind", fill.kind === "pattern" ? "Pattern" : "Colour");
    this.row("Colour", fill.color ?? "—");
    this.row("Pattern", fill.patternKey ?? "—");
    this.row("Walkable", fill.walkable ? "Yes" : "No");
    this.fillSection(fill);

    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
        h("button", {
          class: "panel-btn",
          text: fill.walkable ? "Make blocking" : "Make walkable",
          onClick: () => this.callbacks.onToggleWalkable(!fill.walkable),
        }),
        h("button", {
          class: "panel-btn",
          text: "Delete fill",
          onClick: () => this.callbacks.onDeleteSelection(),
        }),
      ),
    );
  }

  private fillSection(fill: FillPatch | undefined): void {
    // A full picker rather than a fixed palette: the theme's four accents are
    // the app's colours, not the game's.
    const picker = createColorPicker({
      value: fill?.color ?? this.lastColor,
      onChange: (hex) => {
        this.lastColor = hex;
        this.callbacks.onFillColor(hex);
      },
      onCommit: (hex) => {
        this.lastColor = hex;
      },
    });

    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
        h("div", { class: "inspect-section-title m", text: "Fill" }),
        picker.root,
        h("button", {
          class: "panel-btn",
          text: "Use pattern image…",
          onClick: () => this.callbacks.onUsePatternImage(),
        }),
      ),
    );
  }

  private renderPlacement(layerId: string, placementId: string): void {
    const placement = this.store
      .layer(layerId)
      ?.placements.find((p) => p.id === placementId);
    if (!placement) return this.renderEmpty();

    this.head("Image", `${placement.psdKey}.psd`);
    this.row("Layer path", placement.layerPath);
    this.row("Position", `${Math.round(placement.x)}, ${Math.round(placement.y)}`);
    this.row("Size", `${Math.round(placement.width)} × ${Math.round(placement.height)}`);
    this.row("Anchor cell", `${placement.anchor.cx}, ${placement.anchor.cy}`);

    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
        h("button", {
          class: "panel-btn",
          text: "Re-parse PSD",
          onClick: () => this.callbacks.onReparsePsd(placement.psdKey),
        }),
        sizeControls(placement, (patch) => {
          this.store.updatePlacement(layerId, placementId, patch);
        }),
        h("button", {
          class: "panel-btn",
          text: "Remove from layer",
          onClick: () => this.callbacks.onDeleteSelection(),
        }),
      ),
    );
  }

  private renderZone(layerId: string, zoneId: string): void {
    const zone = this.store.layer(layerId)?.zones.find((z) => z.id === zoneId);
    if (!zone) return this.renderEmpty();
    this.head("Boundary", zone.name);
    this.row("Points", String(zone.points.length));
    this.row("Blocking", zone.blocking ? "Yes" : "No");
    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
        h("button", {
          class: "panel-btn",
          text: "Delete boundary",
          onClick: () => this.callbacks.onDeleteSelection(),
        }),
      ),
    );
  }
}

/** Numeric width/height for image edit mode. */
function sizeControls(
  placement: Placement,
  onChange: (patch: Partial<Placement>) => void,
): HTMLElement {
  const make = (label: string, value: number, key: "width" | "height") =>
    h(
      "div",
      { class: "inspect-row" },
      h("div", { class: "inspect-key m", text: label }),
      h("input", {
        class: "input",
        type: "number",
        value: String(Math.round(value)),
        style: { minHeight: "36px", maxWidth: "120px" },
        onChange: (event: Event) => {
          const next = Number((event.target as HTMLInputElement).value);
          if (Number.isFinite(next) && next > 0) onChange({ [key]: next });
        },
      }),
    );

  return h(
    "div",
    {},
    make("Width", placement.width, "width"),
    make("Height", placement.height, "height"),
  );
}
