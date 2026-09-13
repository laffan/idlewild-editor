/**
 * Right sidebar: the inspector for whatever is selected — a layer, a grid
 * region, a fill, a placed image or a boundary.
 *
 * The spec's Image Edit paragraph says image info appears in the "left
 * Inspector sidebar"; the Layout section puts the inspector on the right, so
 * that is where it is.
 */

import { clear, h } from "../lib/dom";
import type { DrawingTool, StrokeStyle } from "../drawing";
import { makeSectionsCollapsible } from "./inspect-collapse";
import { brushPanel } from "./inspect-brush";
import { renderBackground } from "./inspect-background";
import { renderPatternLayer, type PatternActions } from "./inspect-pattern";
import { layerKind } from "../lib/layer-kinds";
import {
  renderPlacement,
  type PlacementActions,
} from "./inspect-placement";
import {
  renderLayer,
  renderPlacements,
  renderPoint,
  renderRegion,
  renderStrokes,
  renderZone,
  type PanelActions,
  type PanelSurface,
} from "./inspect-panels";
import { fillColliderSection } from "./inspect-collider";
import type { PsdLayerEditor } from "./psd-layers";
import { createColorPicker } from "../lib/color-picker";
import type { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import { describeFill, type FillPatch, type Selection } from "../lib/types";

export interface InspectorCallbacks
  extends PatternActions,
    PanelActions,
    PlacementActions {
  onFillColor: (color: string) => void;
  onToggleWalkable: (walkable: boolean) => void;
  /**
   * Get rid of a whole document layer, and everything drawn on it.
   *
   * Its own callback rather than a case of `onDeleteSelection`, because it is
   * the one delete in this panel that asks first — a layer is a container and
   * the Delete key must not reach it, which is also why `shortcuts.ts` counts
   * a layer selection as nothing to delete.
   */
  onDeleteLayer: (layerId: string) => void;
  /** Rename a named place. Its own callback because a point's name is the
   *  only thing about it the panel can change. */
  onRenamePoint: (layerId: string, pointId: string, name: string) => void;
  /** Say where the open scene starts play, or that it starts nowhere. */
  onSetStartPoint: (pointId: string | null) => void;
  /** Write the selected grid area out as a transparent PNG. */
  onExportSelection: () => void;
  onUsePatternImage: () => void;
  /** Hand a stroke selection on as a placed PSD, or as a boundary zone. */
  onStrokesToPsd: () => void;
  onStrokesToZone: () => void;
  /** Hand a filled run of grid spaces on as a placed PSD. */
  onFillToPsd: () => void;
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
  /** The placed PSD opened up into its layers, if any — see `game/unit.ts`. */
  private adjusting: string | null = null;

  constructor(store: DocStore, grid: Grid, callbacks: InspectorCallbacks) {
    this.store = store;
    this.grid = grid;
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
   * A PSD has been re-parsed, so its layer stack is out of date.
   *
   * The list is deliberately kept across re-renders — it holds half-typed
   * names — which means nothing about a document change reaches it. Only the
   * shell knows the file itself has moved underneath.
   */
  reloadPsdLayers(key: string): void {
    if (this.psdLayers?.key === key) this.psdLayers.reload();
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

  /** Which placed PSD the canvas has opened up, so the panel can say so. */
  setAdjusting(instance: string | null): void {
    if (this.adjusting === instance) return;
    this.adjusting = instance;
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
        this.renderLayerPanel(this.selection.layerId);
        break;
      case "region":
        renderRegion(this.surface(), this.grid, this.callbacks, this.selection);
        break;
      case "fill":
        this.renderFill(this.selection.layerId, this.selection.fillId);
        break;
      case "placement":
        this.renderPlacement(this.selection.layerId, this.selection.placementId);
        break;
      case "placements":
        renderPlacements(this.surface(), this.store, this.callbacks, this.selection);
        break;
      case "point":
        renderPoint(
          this.surface(),
          this.store,
          this.grid,
          this.callbacks,
          this.selection,
        );
        break;
      case "zone":
        renderZone(this.surface(), this.store, this.callbacks, this.selection);
        break;
      case "background":
        renderBackground(this.surface(), this.store, this.callbacks, this.selection);
        break;
      case "strokes":
        renderStrokes(this.surface(), this.store, this.callbacks, this.selection);
        break;
    }
    // Applied to the finished panel rather than threaded through the seven
    // files that make sections — see `inspect-collapse.ts`. It reads which are
    // folded from the heading each one already carries.
    makeSectionsCollapsible(this.body);
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

  /**
   * What the panels in `inspect-panels.ts` write through.
   *
   * Made per render rather than held: everything on it delegates, and the
   * state the panels actually touch — `this.current`, the section a row
   * belongs to — is read at call time either way.
   */
  private surface(): PanelSurface {
    return {
      body: this.body,
      head: (kicker, title) => this.head(kicker, title),
      editableHead: (kicker, value, suffix, onCommit) =>
        this.editableHead(kicker, value, suffix, onCommit),
      section: (title) => this.section(title),
      row: (key, value) => this.row(key, value),
      empty: () => this.renderEmpty(),
      fillSection: (fill) => this.fillSection(fill),
    };
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
    this.fillSection(fill);

    // What it stops, under the same heading a placed PSD's says it under.
    this.body.appendChild(
      fillColliderSection(fill, (walkable) =>
        this.callbacks.onToggleWalkable(walkable),
      ),
    );

    this.body.appendChild(
      h(
        "div",
        { class: "inspect-section" },
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

  /** A document layer — the pattern one is its rule rather than a tally. */
  private renderLayerPanel(layerId: string): void {
    const layer = this.store.layer(layerId);
    if (!layer) return this.renderEmpty();
    if (layerKind(layer) === "pattern") {
      renderPatternLayer(this.surface(), this.store, this.callbacks, layer);
      return;
    }
    renderLayer(this.surface(), this.store, this.callbacks, {
      kind: "layer",
      layerId,
    });
  }

  /**
   * A placed PSD — the longest of these panels, in `inspect-placement.ts`.
   *
   * What is handed over is the state this class owns: which unit is opened up,
   * and the file's own layer list, which is made once and kept until the
   * selection moves to a different file because it holds half-typed names and a
   * pending reorder.
   */
  private renderPlacement(layerId: string, placementId: string): void {
    renderPlacement(
      this.surface(),
      {
        store: this.store,
        grid: this.grid,
        actions: this.callbacks,
        adjusting: this.adjusting,
        psdLayers: (key) => this.psdLayerSection(key),
      },
      layerId,
      placementId,
    );
  }

  /**
   * The layer list for one PSD, made once and kept until the selection moves
   * to a different file.
   */
  private psdLayerSection(key: string): PsdLayerEditor {
    if (this.psdLayers?.key !== key) {
      this.psdLayers?.destroy();
      this.psdLayers = this.callbacks.createPsdLayers(key);
    }
    return this.psdLayers;
  }
}
