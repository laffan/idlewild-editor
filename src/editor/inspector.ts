/**
 * Right sidebar: the inspector for whatever is selected — a layer, a grid
 * region, a fill, a placed image or a boundary.
 *
 * The spec's Image Edit paragraph says image info appears in the "left
 * Inspector sidebar"; the Layout section puts the inspector on the right, so
 * that is where it is.
 */

import { clear, h } from "../lib/dom";
import { strokesBox, type DrawingTool, type StrokeStyle } from "../drawing";
import { brushPanel } from "./inspect-brush";
import { count } from "./layers-panel";
import { openPsdLabel, refreshPsdLabel } from "./psd-actions";
import type { PsdLayerEditor } from "./psd-layers";
import { createColorPicker } from "../lib/color-picker";
import type { DocStore } from "../lib/doc-store";
import { describeRange, Grid } from "../lib/grid";
import { describeFill, type FillPatch, type Placement, type Selection } from "../lib/types";

export interface InspectorCallbacks {
  onFillColor: (color: string) => void;
  onToggleWalkable: (walkable: boolean) => void;
  /** Hand the PSD to the OS: a desktop editor, or an iPadOS share sheet. */
  onOpenPsd: (key: string) => void;
  /** Bring its edits back — a re-parse on desktop, a re-import on iPadOS. */
  onRefreshPsd: (key: string) => void;
  /** Rename the file behind a placement. `name` is the stem, without ".psd". */
  onRenamePsd: (key: string, name: string) => void;
  onDeleteSelection: () => void;
  onUsePatternImage: () => void;
  /** Hand a stroke selection on as a placed PSD, or as a boundary zone. */
  onStrokesToPsd: () => void;
  onStrokesToZone: () => void;
  /** Hand a filled run of grid spaces on as a placed PSD. */
  onFillToPsd: () => void;
  /** Give a referencing placement its own copy of the PSD. */
  onRemoveReference: (key: string) => void;
  /**
   * The selected PSD's own layer stack, as an editor that loads itself. Built
   * by the shell rather than here, because it needs the project id and a way
   * back to the scene once it has rewritten the file.
   */
  createPsdLayers: (key: string) => PsdLayerEditor;
  /** The pencil's brush, size and colour changed. */
  onStrokeStyle: (patch: Partial<StrokeStyle>) => void;
}

export class Inspector {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  /** Where `row()` writes: the body, or the section last opened. */
  private current: HTMLElement;
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
  /**
   * The layer list for the PSD currently being inspected, kept across
   * re-renders. It holds half-typed names and a pending reorder, and the
   * panel is rebuilt on every document change — including the ones its own
   * Apply causes.
   */
  private psdLayers: PsdLayerEditor | null = null;

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
    this.current = this.body;
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

  /** Leaving mid-drag would otherwise strand the layer list's listeners. */
  destroy(): void {
    this.psdLayers?.destroy();
    this.psdLayers = null;
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
    const editing = this.captureName();
    clear(this.body);
    this.current = this.body;
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
    this.restoreName(editing);
  }

  /**
   * The filename being typed when the panel was rebuilt under it.
   *
   * The same problem the layer panel has, for the same reason: this panel
   * rebuilds on every document change, a name commits on Enter or blur rather
   * than per keystroke, and anything that touches the document while the
   * caret is in the field would otherwise throw away what has been typed.
   */
  private captureName(): { value: string; start: number; end: number } | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || !this.body.contains(el)) return null;
    if (!el.classList.contains("inspect-name")) return null;
    return {
      value: el.value,
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }

  private restoreName(
    memo: { value: string; start: number; end: number } | null,
  ): void {
    if (!memo) return;
    const input = this.body.querySelector(".inspect-name");
    if (!(input instanceof HTMLInputElement)) return;
    input.value = memo.value;
    input.focus();
    input.setSelectionRange(memo.start, memo.end);
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
    this.current = this.body;
  }

  /**
   * A head whose title is the thing itself, and can be retyped.
   *
   * Borderless until it is focused, like the layer names in the left panel:
   * the panel is a column of facts and one of them happens to be editable,
   * which a box drawn round it all the time would overstate. `suffix` is
   * shown beside the field rather than in it — the extension is not part of
   * the name and retyping it would only be a way to get it wrong.
   */
  private editableHead(
    kicker: string,
    value: string,
    suffix: string,
    onCommit: (next: string) => void,
  ): void {
    const input = h("input", {
      class: "inspect-name",
      value,
      spellcheck: "false",
      "aria-label": `${kicker} name`,
      onChange: (event: Event) => {
        const next = (event.target as HTMLInputElement).value.trim();
        if (!next || next === value) {
          // Cleared or unchanged: put the real name back rather than
          // committing a rename that says nothing.
          (event.target as HTMLInputElement).value = value;
          return;
        }
        onCommit(next);
      },
      onKeyDown: (event: KeyboardEvent) => {
        const field = event.target as HTMLInputElement;
        if (event.key === "Enter") field.blur();
        if (event.key === "Escape") {
          field.value = value;
          field.blur();
        }
      },
    });

    this.body.appendChild(
      h(
        "div",
        { class: "inspect-head" },
        h("div", { class: "inspect-kicker m", text: kicker }),
        h(
          "div",
          { class: "inspect-title inspect-name-row" },
          input,
          h("span", { class: "inspect-ext", text: suffix }),
        ),
      ),
    );
    this.current = this.body;
  }

  /**
   * Open a section. Everything `row()` writes lands in the last one opened,
   * so a panel reads as the sequence of sections it is made of rather than a
   * flat run of rows with buttons somewhere in it.
   */
  private section(title?: string): HTMLElement {
    const el = h("div", { class: "inspect-section" });
    if (title) {
      el.appendChild(h("div", { class: "inspect-section-title m", text: title }));
    }
    this.body.appendChild(el);
    this.current = el;
    return el;
  }

  private row(key: string, value: string): void {
    this.current.appendChild(
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
   * The drawing tools' own panel — see `inspect-brush.ts`. It inspects
   * nothing, so it is a function of what the tool rail last said rather than
   * a method with the document behind it.
   */
  private renderBrush(): void {
    if (!this.drawingTool || !this.strokeStyle) return this.renderEmpty();
    this.body.append(
      ...brushPanel(this.drawingTool, this.strokeStyle, (patch) =>
        this.callbacks.onStrokeStyle(patch),
      ),
    );
  }

  private renderLayer(layerId: string): void {
    const layer = this.store.layer(layerId);
    if (!layer) return this.renderEmpty();
    this.head("Layer", layer.name);
    this.section("Info");
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
    const bounds = this.grid.rangeBounds(from, to);
    this.head("Selection", describeRange(this.grid, from, to));
    this.section("Info");
    this.row("Origin", `${Math.min(from.cx, to.cx)}, ${Math.min(from.cy, to.cy)}`);
    this.row("Pixels", `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`);
    this.row("Template", this.grid.projection);
    // A blank project has a nominal unit but does not round to it, and a row
    // that said "Grid: 64 px" over a selection that ignored it would lie.
    this.row("Grid", this.grid.snaps ? `${this.grid.size} px` : "no snapping");
    this.fillSection(undefined);
  }

  private renderFill(layerId: string, fillId: string): void {
    const fill = this.store.layer(layerId)?.fills.find((f) => f.id === fillId);
    if (!fill) return this.renderEmpty();

    this.head("Filled space", describeFill(fill));
    this.section("Info");
    this.row("Kind", fill.kind === "pattern" ? "Pattern" : "Colour");
    if (fill.rect) {
      this.row("Origin", `${Math.round(fill.rect.x)}, ${Math.round(fill.rect.y)}`);
    }
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
        // A fill is a fast way to block a shape out on the grid; this is
        // what turns the block-out into something an artist can paint.
        h("button", {
          class: "panel-btn",
          text: "Convert to PSD",
          onClick: () => this.callbacks.onFillToPsd(),
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

    // The title is the file's name, and the file's name is worth changing:
    // an import arrives called `pasted-m2k9f1` and stays that way through
    // every list that mentions it until someone can rename it here.
    this.editableHead("Image", placement.psdKey, ".psd", (next) =>
      this.callbacks.onRenamePsd(placement.psdKey, next),
    );

    // A placement shares its file with any other placement of the same key,
    // which is what an option-drag makes. Say so before anything else: the
    // consequence is that editing the PSD edits all of them.
    const sharing = this.placementsOfKey(placement.psdKey);
    if (sharing > 1) {
      this.body.appendChild(
        h(
          "div",
          { class: "inspect-note" },
          h("span", { text: `Reference · ${sharing} placements share this PSD` }),
          h("button", {
            class: "panel-btn",
            text: "Remove Reference",
            onClick: () => this.callbacks.onRemoveReference(placement.psdKey),
          }),
        ),
      );
    }

    this.section("Info");
    this.row("Layer path", placement.layerPath);
    this.row("Position", `${Math.round(placement.x)}, ${Math.round(placement.y)}`);
    this.row("Anchor cell", `${placement.anchor.cx}, ${placement.anchor.cy}`);

    // Size is the one property you change rather than read, so it sits with
    // the controls that change it rather than among the facts above.
    const transform = this.section("Transform");
    transform.appendChild(
      sizeControls(placement, (patch) => {
        this.store.updatePlacement(layerId, placementId, patch);
      }),
    );
    this.current = transform;
    // Documents written before resizing existed carry no natural size, and
    // for those the displayed size is the source size.
    const source = {
      w: placement.naturalWidth || placement.width,
      h: placement.naturalHeight || placement.height,
    };
    this.row("Source", `${Math.round(source.w)} × ${Math.round(source.h)} px`);
    this.row("Scale", `${Math.round(scaleOf(placement) * 100)}%`);

    // The stack inside the file. It sits above the buttons that send the file
    // out, because most of what anyone opened Photoshop for — reordering,
    // renaming, changing a sprite to a tileset — can be done here instead.
    this.body.appendChild(this.psdLayerSection(placement.psdKey));

    // Editing a PSD elsewhere is a round trip out of the app and back, so the
    // two halves sit together on one row: send it out, then bring the edits
    // in. What each one does depends on the platform — see psd-actions.
    this.section();
    this.current.append(
      h(
        "div",
        { class: "panel-btn-row" },
        h("button", {
          class: "panel-btn",
          text: openPsdLabel(this.platform),
          onClick: () => this.callbacks.onOpenPsd(placement.psdKey),
        }),
        h("button", {
          class: "panel-btn",
          text: refreshPsdLabel(this.platform),
          onClick: () => this.callbacks.onRefreshPsd(placement.psdKey),
        }),
      ),
      h("button", {
        class: "panel-btn",
        text: "Remove from layer",
        onClick: () => this.callbacks.onDeleteSelection(),
      }),
    );
  }

  /**
   * The layer list for one PSD, made once and kept until the selection moves
   * to a different file.
   */
  private psdLayerSection(key: string): HTMLElement {
    if (this.psdLayers?.key !== key) {
      this.psdLayers?.destroy();
      this.psdLayers = this.callbacks.createPsdLayers(key);
    }
    return this.psdLayers.root;
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
    this.section("Info");
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

  /** How many placements in the whole document read one PSD. */
  private placementsOfKey(key: string): number {
    let n = 0;
    for (const layer of this.store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey === key) n++;
      }
    }
    return n;
  }

  private renderZone(layerId: string, zoneId: string): void {
    const zone = this.store.layer(layerId)?.zones.find((z) => z.id === zoneId);
    if (!zone) return this.renderEmpty();
    this.head("Boundary", zone.name);
    this.section("Info");
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

/**
 * Numeric width/height for image edit mode.
 *
 * The fields are set at the label's size, as the read-only values beside them
 * are: a row is a label and its value, and a 16px field among 10px rows read
 * as a heading with a box round it.
 */
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
        class: "inspect-input",
        type: "number",
        value: String(Math.round(value)),
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

/**
 * How big a placement is against the pixels it really has. An import lands at
 * half — see IMPORT_SCALE — and this is the only place that says so.
 */
function scaleOf(placement: Placement): number {
  return placement.width / (placement.naturalWidth || placement.width);
}
