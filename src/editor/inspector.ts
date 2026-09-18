/**
 * The properties sidebar: three zones, always in the same order.
 *
 * It used to be one panel called **Inspector** that showed exactly one thing
 * at a time — the brush while a drawing tool held the pointer, a layer while
 * a layer was selected, a placed PSD while one was. Three unrelated subjects
 * under one heading, each hiding the last: picking a PSD took the layer's
 * facts away, and picking up the pencil took both away. The heading was the
 * problem. "Inspector" names the panel rather than what is in it, so nothing
 * on screen ever said which of the three you were looking at, and there was
 * no way to look at two.
 *
 * So the heading is gone and there are three zones instead:
 *
 * - **TOOL** — what the thing in your hand has to set. Only for tools that
 *   have something to set; see `inspect-brush.ts`.
 * - **LAYER** — the layer being worked on, which is the selection's own when
 *   there is one and the active layer otherwise. There is always one of
 *   these, because there is always a layer new work lands on.
 * - **OBJECT** — the thing selected on the canvas: a grid region, a fill, a
 *   placed PSD, a point, a boundary, a backdrop, a sketch.
 *
 * Always in that order, and a zone with nothing to say is not drawn at all —
 * an empty labelled box is the thing the old single heading was doing wrong.
 * The order is the answer to the question the old panel could not settle:
 * what is in my hand, where is it going, what is it on top of.
 *
 * All three fold, and each is marked as the thing that is *not* a section — a
 * chip, a tinted ground, a heavier rule — because the sections inside them
 * fold too and a column of identical headings says nothing about which of them
 * is the structure. See `inspect-zone.ts`.
 */

import { clear, h } from "../lib/dom";
import type { FillMode, StrokeStyle } from "../drawing";
import {
  makeSectionsCollapsible,
  revealSection,
  sectionTitle,
} from "./inspect-collapse";
import { toolPanel, TOOL_HINTS, TOOL_TITLES } from "./inspect-brush";
import {
  createZone,
  layerOf,
  layerZoneApplies,
  ZONE_HINTS,
  type Zone,
  type ZoneOptions,
} from "./inspect-zone";
import { renderBackground } from "./inspect-background";
import { renderText, type TextActions } from "./inspect-text";
import { captureFocus, restoreFocus } from "./inspect-focus";
import { renderPatternLayer, type PatternActions } from "./inspect-pattern";
import { layerKind } from "../lib/layer-kinds";
import {
  renderPlacement,
  type PlacementActions,
} from "./inspect-placement";
import {
  renderFill,
  renderLayer,
  renderPlacements,
  renderPoint,
  renderFillPaint,
  renderRegion,
  renderStrokes,
  renderZone,
  type PanelActions,
  type PanelSurface,
} from "./inspect-panels";
import type { PsdLayerEditor } from "./psd-layers";
import { DEFAULT_FILL_COLOR } from "../lib/color";
import { DEFAULT_PAINT_SPEC, type Paint } from "../lib/paint";
import { defaultPatternScale } from "./stamp-box";
import type { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import type { FillPatch, Selection, ToolId } from "../lib/types";

export interface InspectorCallbacks
  extends PatternActions,
    PanelActions,
    PlacementActions,
    TextActions {
  /**
   * The paint control settled on something — a colour, a pattern or a shape.
   *
   * One callback rather than one per kind, because what it means depends on
   * the selection rather than on the kind: a fill selected is repainted, and a
   * run of grid spaces is filled. See `fill-actions.ts`.
   */
  onFillPaint: (paint: Paint) => void;
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
  /**
   * The selected PSD's own layer stack, as an editor that loads itself. Built
   * by the shell rather than here, because it needs the project id and a way
   * back to the scene once it has rewritten the file.
   */
  createPsdLayers: (key: string) => PsdLayerEditor;
  /** The pencil's brush, size and colour changed. */
  onStrokeStyle: (patch: Partial<StrokeStyle>) => void;
  /**
   * Which layer the LAYER zone falls back to when nothing on the canvas is
   * selected — the one new work lands on.
   *
   * Asked rather than stored, because the active layer is the shell's and can
   * change without the document changing: picking a row in the left sidebar
   * moves it, and nothing is written.
   */
  activeLayerId: () => string;
  /** Which half of the sweep fill is aimed, and the way to change it. */
  fillMode: () => FillMode;
  onFillMode: (mode: FillMode) => void;
  /**
   * How many corners the point-to-point fill has down.
   *
   * A readout: what to *do* about them is on the bar floating beside the
   * shape — see `fill-bar.ts`.
   */
  fillPoints: () => number;
  /**
   * Whether a tool is turned round to erase, and the way to turn it.
   *
   * By tool rather than by style, because that is where the flag is kept —
   * see `editor/tool-routing.ts`. Setting it re-renders this panel, so the
   * row and the toolbar button agree about which way round the tool is.
   */
  erasing: (tool: ToolId) => boolean;
  onErasing: (tool: ToolId, on: boolean) => void;
}

/**
 * The heading the file's own layer list carries — `psd-layers.ts` writes it.
 *
 * Named here as well because `revealPsdLayers` folds the panel down to it, and
 * a section found by a string that has drifted is a fold that quietly closes
 * everything.
 */
const PSD_SECTION = "PSD";

export class Inspector {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  /** The zone the panels are currently writing into — see `inspect-zone.ts`. */
  private zone: Zone;
  /** Where `row()` writes: the zone's body, or the section last opened. */
  private current: HTMLElement;
  private readonly store: DocStore;
  private readonly grid: Grid;
  private readonly callbacks: InspectorCallbacks;
  private selection: Selection = { kind: "none" };
  /**
   * What the pointer is holding, so the TOOL zone can offer its settings.
   *
   * The `ToolId` rather than the drawing engine's own name for it: more than
   * one tool can be the *pencil* as far as the engine is concerned — a brush
   * and a stroke mode — and the panel has to tell them apart to know which of
   * their controls mean anything.
   */
  private toolId: ToolId = "select";
  private strokeStyle: StrokeStyle | null = null;
  /**
   * Carried between selections so the picker reopens where it was left.
   *
   * The whole paint rather than only the colour: picking a dither, filling
   * three separate patches with it and having the fourth come back as flat
   * grey is the shape of bug this used to have with colours alone.
   */
  private lastPaint: Paint = { ...DEFAULT_PAINT_SPEC, color: DEFAULT_FILL_COLOR };

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
  /** Set by `revealPsdLayers`, and cleared by the render that acts on it. */
  private revealPsd = false;

  constructor(store: DocStore, grid: Grid, callbacks: InspectorCallbacks) {
    this.lastPaint.patternScale = defaultPatternScale(grid);
    this.store = store;
    this.grid = grid;
    this.callbacks = callbacks;

    this.body = h("div", { class: "panel-body scroll" });
    // Replaced on every render; made here so the field is never null and the
    // panels never have to ask whether there is a zone to write into.
    this.zone = createZone("OBJECT");
    this.current = this.zone.body;
    // No `panel-head`. The three zones carry their own headings, and a fourth
    // heading over them saying "Inspector" would be a name for the furniture
    // rather than for anything in it.
    this.root = h("div", { class: "side-panel right" }, this.body);

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

  /** What a new fill should be made of — whatever the picker last settled on. */
  get fillPaint(): Paint {
    return { ...this.lastPaint };
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
    this.render();
  }

  /**
   * A PSD has just been created — show the part of the panel that is about
   * painting it.
   *
   * Generate PSD, both Convert to PSDs, an extrude Apply and a new image
   * backdrop all end the same way: an empty file selected on the canvas, whose
   * one useful next move is four sections down a panel that opens on Info. So
   * the layer list is opened, the rest of the OBJECT zone folded, and the
   * panel scrolled to it.
   *
   * Refused unless a placement is really selected, which is what makes it safe
   * to call without checking whether the conversion worked: one that was
   * refused leaves the old selection, or none, and this does nothing.
   */
  revealPsdLayers(): void {
    if (this.selection.kind !== "placement") return;
    this.revealPsd = true;
    this.render();
  }

  /** Which placed PSD the canvas has opened up, so the panel can say so. */
  setAdjusting(instance: string | null): void {
    if (this.adjusting === instance) return;
    this.adjusting = instance;
    this.render();
  }

  /**
   * Which tool is up, and the style it will draw with.
   *
   * The `ToolId` rather than the drawing layer's own name for the tool, and
   * that is the load-bearing half: several tools are the *pencil* as far as
   * the engine is concerned — a brush and a stroke mode — so a panel told
   * only what the engine was doing could not tell which of them was in hand,
   * or which of their controls meant anything.
   */
  setTool(tool: ToolId, style: StrokeStyle | null): void {
    this.toolId = tool;
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
    // The caret, if somebody is typing in here — see `inspect-focus.ts`.
    const editing = captureFocus(this.body);
    clear(this.body);
    this.renderTool();
    this.renderLayerZone();
    const object = this.renderObject();
    // The one thing the old empty state said that nothing else does: how to
    // put something in the OBJECT zone. Kept as a quiet line under the two
    // zones that are there rather than as a zone of its own, because an
    // instruction is not an object.
    if (!object) {
      this.body.appendChild(
        h("div", {
          class: "inspect-empty",
          text:
            "Nothing selected. Hold on the canvas to select a run of grid " +
            "spaces, or tap a placed image.",
        }),
      );
    }
    // Applied to the finished panel rather than threaded through the seven
    // files that make sections — see `inspect-collapse.ts`. It reads which are
    // folded from the heading each one already carries.
    makeSectionsCollapsible(this.body);
    restoreFocus(this.body, editing);
    if (this.revealPsd) {
      this.revealPsd = false;
      this.showPsdSection();
    }
  }

  /**
   * Fold the OBJECT zone down to the file's own layer list and scroll to it.
   *
   * That zone rather than the whole panel: the TOOL zone is about what is in
   * your hand, which the file just written has nothing to do with.
   */
  private showPsdSection(): void {
    const zone = this.body.querySelector<HTMLElement>(".inspect-zone.zone-object");
    if (zone) revealSection(zone, PSD_SECTION, this.body);
  }

  /**
   * TOOL — what is in your hand, when it has anything to set.
   *
   * Nothing at all for Select, Pan, Point, Boundary, Slice and the Lasso:
   * each does one thing with one gesture, and a heading over a
   * sentence describing it would be the labelled-empty-box this panel was
   * rearranged to stop. See `inspect-brush.ts`.
   */
  private renderTool(): void {
    if (!this.strokeStyle) return;
    const title = TOOL_TITLES[this.toolId];
    if (!title) return;
    // What the tool does is on the heading rather than in a line of prose
    // under it — see `inspect-brush.ts` for why the panel's explanations
    // moved onto the headings they belong to.
    this.open("TOOL", {
      subject: title,
      hint: TOOL_HINTS[this.toolId] ?? ZONE_HINTS.TOOL,
    });
    const rows = toolPanel(this.toolId, this.strokeStyle, {
      onStyle: (patch) => this.callbacks.onStrokeStyle(patch),
      // A grid space, for the two library editors' previews — the one thing
      // in this zone that is about the project rather than about the tool.
      cell: this.grid.tileWidth,
      fillMode: this.callbacks.fillMode(),
      onFillMode: (mode) => this.callbacks.onFillMode(mode),
      fillPoints: this.callbacks.fillPoints(),
      erasing: this.callbacks.erasing(this.toolId),
      onErasing: (on) => this.callbacks.onErasing(this.toolId, on),
    });
    if (rows) this.zone.body.append(...rows);
    this.zone.mount(this.body);
  }

  /**
   * LAYER — the one being worked on.
   *
   * Only when the layer is what there is to talk about: a layer selected, or
   * nothing selected, or a region — ground, which is what the next Fill would
   * land on. Something standing *on* a layer takes the panel for itself; see
   * `layerZoneApplies`.
   */
  private renderLayerZone(): void {
    if (!layerZoneApplies(this.selection)) return;
    const layerId = layerOf(this.selection) || this.callbacks.activeLayerId();
    const layer = this.store.layer(layerId);
    if (!layer) return;
    this.open("LAYER", { subject: layer.name });
    if (layerKind(layer) === "pattern") {
      renderPatternLayer(this.surface(), this.store, this.callbacks, layer);
    } else {
      renderLayer(this.surface(), this.store, this.callbacks, {
        kind: "layer",
        layerId: layer.id,
      });
    }
    this.zone.mount(this.body);
  }

  /** OBJECT — what is selected on the canvas. False when nothing is. */
  private renderObject(): boolean {
    const selection = this.selection;
    if (selection.kind === "none" || selection.kind === "layer") return false;
    this.open("OBJECT");
    switch (selection.kind) {
      case "region":
        renderRegion(this.surface(), this.grid, this.callbacks, selection);
        break;
      case "fill":
        renderFill(this.surface(), this.store, this.callbacks, selection);
        break;
      case "placement":
        this.renderPlacement(selection.layerId, selection.placementId);
        break;
      case "placements":
        renderPlacements(this.surface(), this.store, this.callbacks, selection);
        break;
      case "point":
        renderPoint(
          this.surface(),
          this.store,
          this.grid,
          this.callbacks,
          selection,
        );
        break;
      case "zone":
        renderZone(this.surface(), this.store, this.callbacks, selection);
        break;
      case "text":
        renderText(this.surface(), this.store, this.callbacks, selection);
        break;
      case "background":
        renderBackground(this.surface(), this.store, this.callbacks, selection);
        break;
      case "strokes":
        renderStrokes(this.surface(), this.store, this.callbacks, selection);
        break;
    }
    return this.zone.mount(this.body);
  }

  /** Start a zone. Everything written from here lands in it. */
  private open(name: string, options: ZoneOptions = {}): void {
    this.zone = createZone(name, options);
    this.current = this.zone.body;
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
      body: this.zone.body,
      head: (kicker, title) => this.head(kicker, title),
      editableHead: (kicker, value, suffix, onCommit) =>
        this.editableHead(kicker, value, suffix, onCommit),
      section: (title, hint) => this.section(title, hint),
      row: (key, value) => this.row(key, value),
      empty: () => this.renderEmpty(),
      fillSection: (fill) => this.fillSection(fill),
    };
  }

  /**
   * A panel's opening kicker and title, with the zone's heading carrying the
   * kicker — `OBJECT : Boundary` over *Boundary 1*.
   *
   * A title the heading has already said is not said twice: the LAYER zone
   * names itself after the layer, so `head("Layer", "Foreground")` there has
   * nothing left to draw.
   */
  private head(kicker: string, title: string): void {
    this.current = this.zone.body;
    if (this.zone.name(kicker) === title) return;
    this.zone.body.appendChild(
      h(
        "div",
        { class: "inspect-head" },
        h("div", { class: "inspect-title", text: title }),
      ),
    );
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

    this.zone.name(kicker);
    this.zone.body.appendChild(
      h(
        "div",
        { class: "inspect-head" },
        h(
          "div",
          { class: "inspect-title inspect-name-row" },
          input,
          h("span", { class: "inspect-ext", text: suffix }),
        ),
      ),
    );
    this.current = this.zone.body;
  }

  /**
   * Open a section. Everything `row()` writes lands in the last one opened,
   * so a panel reads as the sequence of sections it is made of rather than a
   * flat run of rows with buttons somewhere in it.
   */
  private section(title?: string, hint?: string): HTMLElement {
    const el = h("div", { class: "inspect-section" });
    if (title) {
      el.appendChild(sectionTitle(title, { hint }));
    }
    this.zone.body.appendChild(el);
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

  /**
   * What a panel writes when the thing it is about has gone.
   *
   * Reached through `PanelSurface.empty` — a placement deleted under the
   * panel, a layer that went with it. The zone stays, because saying the
   * thing is gone is something to say; a zone with nothing in it at all is
   * the one that never gets mounted.
   */
  private renderEmpty(): void {
    this.zone.body.appendChild(
      h("div", {
        class: "inspect-empty",
        text: "That has gone from the document.",
      }),
    );
  }

  /**
   * What a run of grid spaces is filled with — the control, in
   * `inspect-panels.ts`, and the memory of what it last said, here.
   *
   * The memory is what makes the second and third patch come out of the same
   * gesture as the first: pick a dither, fill three areas with it, and all
   * three are that dither rather than one of them and two greys.
   */
  private fillSection(fill: FillPatch | undefined): void {
    renderFillPaint(this.zone.body, {
      grid: this.grid,
      fill,
      held: this.lastPaint,
      onPaint: (paint) => {
        this.lastPaint = { ...paint };
        this.callbacks.onFillPaint(paint);
      },
      onUsePatternImage: () => this.callbacks.onUsePatternImage(),
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
