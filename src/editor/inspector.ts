/**
 * Right sidebar: the inspector for whatever is selected — a layer, a grid
 * region, a fill, a placed image or a boundary.
 *
 * The spec's Image Edit paragraph says image info appears in the "left
 * Inspector sidebar"; the Layout section puts the inspector on the right, so
 * that is where it is.
 */

import { clear, h } from "../lib/dom";
import { BRUSHES, strokesBox, type DrawingTool, type StrokeStyle } from "../drawing";
import { count } from "./layers-panel";
import { refreshPsdLabel } from "./psd-actions";
import { createColorPicker } from "../lib/color-picker";
import type { DocStore } from "../lib/doc-store";
import { Grid, rangeSize } from "../lib/grid";
import type { FillPatch, Placement, Selection } from "../lib/types";

export interface InspectorCallbacks {
  onFillColor: (color: string) => void;
  onToggleWalkable: (walkable: boolean) => void;
  /** Hand the PSD to the OS: a desktop editor, or an iPadOS share sheet. */
  onOpenPsd: (key: string) => void;
  /** Bring its edits back — a re-parse on desktop, a re-import on iPadOS. */
  onRefreshPsd: (key: string) => void;
  onDeleteSelection: () => void;
  onUsePatternImage: () => void;
  /** Hand a stroke selection on as a placed PSD, or as a boundary zone. */
  onStrokesToPsd: () => void;
  onStrokesToZone: () => void;
  /** The pencil's brush, size and colour changed. */
  onStrokeStyle: (patch: Partial<StrokeStyle>) => void;
}

export class Inspector {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly store: DocStore;
  private readonly grid: Grid;
  private readonly callbacks: InspectorCallbacks;
  /** `std::env::consts::OS`; only the PSD buttons read it. */
  private readonly platform: string;
  private selection: Selection = { kind: "none" };
  /** Set while a drawing tool holds the pointer, so the panel can offer the
   *  brush instead of an empty state nobody can act on. */
  private drawingTool: DrawingTool | null = null;
  private strokeStyle: StrokeStyle | null = null;
  /** Carried between selections so the picker reopens where it was left. */
  private lastColor = "#ec3013";
  private suspended = false;

  constructor(
    store: DocStore,
    grid: Grid,
    platform: string,
    callbacks: InspectorCallbacks,
  ) {
    this.store = store;
    this.grid = grid;
    this.platform = platform;
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

  /** Which drawing tool is up, and the style it will draw with. */
  setDrawingTool(tool: DrawingTool | null, style: StrokeStyle | null): void {
    this.drawingTool = tool;
    this.strokeStyle = style;
    this.render();
  }

  /**
   * Take a style the panel itself just changed.
   *
   * Deliberately does not re-render. The colour picker fires continuously
   * while it is being dragged, and rebuilding the panel under it would throw
   * away the drag — and, when the change came from the hex field's blur,
   * remove the field from inside its own handler. The controls that show the
   * style keep themselves current instead.
   */
  updateStrokeStyle(style: StrokeStyle): void {
    this.strokeStyle = style;
  }

  render(): void {
    clear(this.body);
    switch (this.selection.kind) {
      case "none":
        if (this.drawingTool) this.renderBrush();
        else this.renderEmpty();
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
      case "strokes":
        this.renderStrokes(this.selection.layerId, this.selection.ids);
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

  /**
   * The pencil's own controls. Hush puts these in four brush slots with an
   * edit flyout each; here there is one brush at a time, because the editor's
   * pencil is for sketching a game object rather than for finished drawing.
   */
  private renderBrush(): void {
    const style = this.strokeStyle;
    if (!style) return this.renderEmpty();

    if (this.drawingTool === "eraser") {
      this.head("Eraser", "Slice");
      this.body.appendChild(
        h("div", {
          class: "inspect-empty",
          text:
            "Drag across a stroke to cut it where the disc passes. A stroke " +
            "cut through the middle becomes two.",
        }),
      );
      return;
    }

    if (this.drawingTool === "lasso") {
      this.head("Lasso", "Select strokes");
      this.body.appendChild(
        h("div", {
          class: "inspect-empty",
          text:
            "Sweep a loop around a sketch to select it, then hand it to this " +
            "layer as a PSD or as a boundary.",
        }),
      );
      return;
    }

    const name = h("div", {
      class: "inspect-title",
      text: BRUSHES.find((b) => b.id === style.brushId)?.name ?? "Ink",
    });
    this.body.appendChild(
      h(
        "div",
        { class: "inspect-head" },
        h("div", { class: "inspect-kicker m", text: "Pencil" }),
        name,
      ),
    );

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
          this.callbacks.onStrokeStyle({ brushId: brush.id });
        },
      });
      brushes.appendChild(button);
    }

    const readout = h("div", { class: "inspect-value", text: `${style.size} px` });
    const size = h("input", {
      class: "brush-size",
      type: "range",
      min: "1",
      max: "48",
      step: "1",
      value: String(style.size),
      // `input` rather than `change`: the ink should follow the slider.
      onInput: (event: Event) => {
        const next = Number((event.target as HTMLInputElement).value);
        if (!Number.isFinite(next)) return;
        readout.textContent = `${next} px`;
        this.callbacks.onStrokeStyle({ size: next });
      },
    });

    const picker = createColorPicker({
      value: style.color,
      onChange: (hex) => this.callbacks.onStrokeStyle({ color: hex }),
      onCommit: (hex) => this.callbacks.onStrokeStyle({ color: hex }),
    });

    this.body.append(
      h(
        "div",
        { class: "inspect-section" },
        h("div", { class: "inspect-section-title m", text: "Brush" }),
        brushes,
        h(
          "div",
          { class: "inspect-row brush-row-size" },
          h("div", { class: "inspect-key m", text: "Size" }),
          size,
          readout,
        ),
      ),
      h(
        "div",
        { class: "inspect-section" },
        h("div", { class: "inspect-section-title m", text: "Colour" }),
        picker.root,
      ),
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

    // Editing a PSD is a round trip out of the app and back, so the two
    // halves sit together on one row: open it where it can be edited, then
    // bring the edits in. What the second one does depends on where the file
    // went — see psd-actions.
    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
        h(
          "div",
          { class: "panel-btn-row" },
          h("button", {
            class: "panel-btn",
            text: "Open PSD",
            onClick: () => this.callbacks.onOpenPsd(placement.psdKey),
          }),
          h("button", {
            class: "panel-btn",
            text: refreshPsdLabel(this.platform),
            onClick: () => this.callbacks.onRefreshPsd(placement.psdKey),
          }),
        ),
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

  /**
   * A lasso selection. The two buttons are the drawing layer's only exits:
   * the sketch becomes a game object, or it becomes a region play mode can
   * walk around. Both consume the strokes — see editor/stroke-actions.
   */
  private renderStrokes(layerId: string, ids: readonly string[]): void {
    const layer = this.store.layer(layerId);
    if (!layer) return this.renderEmpty();
    const strokes = layer.strokes.filter((s) => ids.includes(s.id));
    if (strokes.length === 0) return this.renderEmpty();

    this.head("Sketch", count(strokes.length, "stroke"));
    this.row("Layer", layer.name);
    const box = strokesBox(strokes);
    if (box) {
      this.row("Size", `${Math.round(box.width)} × ${Math.round(box.height)}`);
      this.row("Origin", `${Math.round(box.x)}, ${Math.round(box.y)}`);
    }

    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
        h("button", {
          class: "panel-btn primary",
          text: "Convert to PSD",
          onClick: () => this.callbacks.onStrokesToPsd(),
        }),
        h("button", {
          class: "panel-btn",
          text: "Convert to boundary",
          onClick: () => this.callbacks.onStrokesToZone(),
        }),
        h("button", {
          class: "panel-btn",
          text: "Delete strokes",
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
        style: { minHeight: "26px", maxWidth: "96px" },
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
