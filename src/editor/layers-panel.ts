/**
 * Left sidebar: scenes and layers, in the order you think about them —
 * which place am I in, then what is in it.
 *
 * The scene dropdown along the top is `scenes-bar.ts`; the rest of this file
 * is the layer list. Layers can be reordered, renamed, locked and hidden, and
 * belong to the scene that is open — switching scenes is a different list,
 * not a filter over one.  Stored top-first, shown top-first.
 *
 * Reordering is a drag on the grip at the right-hand end of each row, with
 * the collapse arrow at the other end — the two questions a row answers, put
 * at the two edges rather than side by side in one gutter. Pointer events
 * rather than HTML5 drag-and-drop, because the iPad is a first-class target
 * and `dragstart` never fires for touch. The row being dragged is moved
 * through the DOM as the finger passes each neighbour, so the list shows the
 * order it is about to commit; the document is written once, on release.
 *
 * A placed PSD listed under an expanded layer has a grip of its own, and
 * dragging that carries the image to whichever layer the finger lets go over.
 * Same gesture, different question: a layer takes a *position* in the list,
 * an image takes a *layer*, so one moves through the DOM as it goes and the
 * other lights up its destination.
 *
 * **In Code mode none of that applies**, and the panel says so by becoming a
 * different thing: a directory of scenes, layers, PSDs and the layers inside
 * each PSD, with every handle taken off. The game is over the canvas there,
 * so nothing in this column has anything to act on. See `setBrowsing` and
 * `layer-directory.ts`.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import { LAYER_KINDS, layerKind } from "../lib/layer-kinds";
import { ordersByHand } from "../lib/units";
import { LayerDrags } from "./layer-drag";
import { openMenu } from "../lib/menu";
import type { Layer, Selection } from "../lib/types";
import {
  count,
  describe,
  emptyText,
  isSelected,
  KIND_ICONS,
  layerItems,
  renderLayerItem,
} from "./layer-items";
import { pickMode, pickUnit } from "./layer-select";
import { ScenesBar } from "./scenes-bar";
import { renderDirectory } from "./layer-directory";
import type { ManifestLayer } from "../lib/manifest";

export interface LayersPanelCallbacks {
  onSelectLayer: (layerId: string) => void;
  /** Selecting a placement, fill or boundary from the list under a layer. */
  onSelectItem: (selection: Selection) => void;
  getActiveLayerId: () => string;
  getSelection: () => Selection;
  /**
   * Whether a PSD carries the anchor mark at the root of its stack.
   *
   * The rule object layers enforce, and a question about the *file* rather
   * than about the document — so it is asked rather than read, and asked of
   * the scene, which is what holds the parsed manifests. A panel built with
   * no scene behind it answers yes, which is the answer that shows nothing.
   */
  isAnchored: (psdKey: string) => boolean;
  /**
   * What is inside a placed PSD, which only the directory asks for.
   *
   * Asked of the scene, like `isAnchored`, because the scene is what holds
   * the parsed manifests — and a panel built with nothing behind it answers
   * with an empty list, which is a row saying so rather than a row lying.
   */
  psdLayers: (psdKey: string) => readonly ManifestLayer[];
  /**
   * Put something behind everything on a background layer. The anchor is the
   * button itself, which the menu hangs under.
   */
  onNewBackground: (layerId: string, anchor: HTMLElement) => void;
}

/**
 * A name being edited when the panel was rebuilt under it.
 *
 * The panel re-renders on every document change, and one of those changes is
 * the layer selection a tap on the name itself causes — so without this the
 * input is destroyed on mouse-up and typing only lands while the button is
 * still held down.
 */
interface NameFocus {
  layerId: string;
  /** The uncommitted text: names commit on Enter or blur, not per keystroke. */
  value: string;
  start: number;
  end: number;
}

export class LayersPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly scenes: ScenesBar;
  private readonly store: DocStore;
  private readonly callbacks: LayersPanelCallbacks;
  private suspended = false;
  /**
   * Whether the panel is a directory rather than a set of controls.
   *
   * Code mode's shape: the game is running over the canvas, so nothing in
   * here has anything to act on, and what a developer wants from the column
   * while writing code beside the game is the names. See `layer-directory.ts`
   * for what it draws instead.
   */
  private browsing = false;
  /** The two drags on this list, and the one gesture that is both — see
   *  `layer-drag.ts`. */
  private readonly drags: LayerDrags;
  /** The `+`, and the word over it: both say something Code mode does not. */
  private readonly add: HTMLButtonElement;
  private readonly title: HTMLElement;
  /** Layers whose contents are shown. Expansion is per-session UI state. */
  private readonly expanded = new Set<string>();
  /** Whether an object layer's placed files are listed — and reorderable —
   *  in document order or in screen-Y order. See `ordersByHand`. */
  private readonly isometric: boolean;
  /**
   * The row a ⇧-click measures its run from: a layer, and a position in that
   * layer's list of placed files.
   *
   * Panel state rather than document state, and forgotten when the scene
   * changes, because it is a fact about the last thing somebody tapped.
   */
  private anchor: { layerId: string; index: number } | null = null;

  /**
   * `footer` is what sits under the list, along the bottom of the sidebar:
   * the minimap. Handed in rather than built here because it is about the
   * canvas rather than about the layers — this panel only owns where it goes.
   */
  constructor(
    store: DocStore,
    callbacks: LayersPanelCallbacks,
    footer?: HTMLElement,
  ) {
    this.store = store;
    this.callbacks = callbacks;
    this.isometric = store.projection === "isometric";

    this.body = h("div", { class: "panel-body scroll" });
    this.drags = new LayerDrags({
      body: this.body,
      store,
      render: () => this.render(),
      expand: (layerId) => this.expanded.add(layerId),
      select: (selection) => this.callbacks.onSelectItem(selection),
    });
    this.scenes = new ScenesBar(store);
    this.title = h("div", { class: "panel-title m", text: "Layers" });
    // Three kinds of layer, so the `+` asks which. A menu rather than
    // three buttons: object is the one anybody wants nine times in ten,
    // and a row of equals would say otherwise.
    this.add = h(
      "button",
      {
        class: "panel-add",
        title: "Add layer",
        onClick: (event: Event) =>
          this.openKindMenu(event.currentTarget as HTMLElement),
      },
      icon(ICONS.plus, 15),
    );
    this.root = h(
      "div",
      { class: "side-panel left" },
      this.scenes.root,
      h("div", { class: "panel-head" }, this.title, this.add),
      this.body,
      footer,
    );

    store.addEventListener("change", () => {
      if (!this.suspended) this.render();
    });
    // A switch leaves the list showing another scene's layers, and the drag
    // or rename that was in flight is about a row that has gone.
    store.addEventListener("scene", () => {
      this.drags.forget();
      this.expanded.clear();
      // The row a ⇧-click would have counted from is in the scene just left.
      this.anchor = null;
      this.render();
    });
    this.render();
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("collapsed", collapsed);
  }

  /**
   * Turn the panel into a directory, or back into the layer list.
   *
   * The `+` goes with it, because a layer added here would land on a scene
   * behind a running game; the class is what takes the rest of the chrome
   * down. What is *not* dropped is the scene dropdown's switching — that is
   * navigation rather than an edit, and it is the reason Code keeps this
   * sidebar at all.
   */
  setBrowsing(browsing: boolean): void {
    if (browsing === this.browsing) return;
    this.browsing = browsing;
    this.root.classList.toggle("browsing", browsing);
    this.add.hidden = browsing;
    // What the column is *for* changes with it, and the heading is the one
    // place that can say so before anything is opened.
    this.title.textContent = browsing ? "Directory" : "Layers";
    this.scenes.setBrowsing(browsing);
    // A row opened in one mode stays open in the other, and the directory has
    // ids of its own in the same set — see `layer-directory.ts`. Neither is a
    // problem: an id nothing matches is simply never asked about.
    this.render();
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

  /**
   * A placed PSD's row was picked, with whatever the click meant.
   *
   * The arithmetic is `layer-select.ts`; this is the part that has the panel's
   * two pieces of state — which layer the anchor is on, and what is selected
   * now — and hands the answer on to the editor, which is where a selection
   * reaches the canvas.
   *
   * The anchor is dropped when a run is started on a different layer, because
   * a selection is one layer's worth and a range across two has nothing to be
   * measured over.
   */
  private pick(
    layerId: string,
    units: readonly { members: readonly string[] }[],
    index: number,
    mode: ReturnType<typeof pickMode>,
  ): void {
    const anchor =
      this.anchor && this.anchor.layerId === layerId ? this.anchor.index : null;
    const result = pickUnit({
      current: this.callbacks.getSelection(),
      layerId,
      units,
      index,
      anchor,
      mode,
    });
    this.anchor =
      result.anchor === null ? null : { layerId, index: result.anchor };
    this.callbacks.onSelectItem(result.selection);
  }

  render(): void {
    // A drag in flight owns the DOM until it is released; rebuilding under
    // it would drop the element the pointer is holding.
    if (this.drags.active) return;

    if (this.browsing) {
      clear(this.body);
      renderDirectory(this.body, {
        store: this.store,
        isometric: this.isometric,
        isAnchored: this.callbacks.isAnchored,
        psdLayers: this.callbacks.psdLayers,
        isOpen: (id) => this.expanded.has(id),
        toggle: (id) => {
          if (this.expanded.has(id)) this.expanded.delete(id);
          else this.expanded.add(id);
          this.render();
        },
      });
      return;
    }

    const active = this.callbacks.getActiveLayerId();
    const selection = this.callbacks.getSelection();
    const editing = this.captureName();

    clear(this.body);
    this.store.layers.forEach((layer) => {
      // One element per layer, its expanded contents included, so a reorder
      // moves a layer and everything shown under it as a unit.
      const group = h("div", { class: "layer-group", dataset: { layerId: layer.id } });
      group.appendChild(this.row(layer, layer.id === active));
      this.body.appendChild(group);

      if (!this.expanded.has(layer.id)) return;
      const items = layerItems(layer, {
        startPointId: this.store.activeScene.startPointId,
        isAnchored: this.callbacks.isAnchored,
        isometric: this.isometric,
      });
      if (items.length === 0 && layer.strokes.length === 0) {
        group.appendChild(
          h("div", { class: "layer-item empty m", text: emptyText(layer) }),
        );
      }

      // The placed files on this layer, in the order they are listed, which is
      // what a ⇧-click's run is measured over and what an index means below.
      const units = items
        .filter((item) => item.selection.kind === "placement")
        .map((item) => ({ members: item.members ?? [] }));
      let unitIndex = -1;

      for (const item of items) {
        // Only a placement is carried between layers. A fill is a run of grid
        // spaces and a boundary is a polygon; both are addressed in world
        // coordinates that no layer owns, so moving one is a change of draw
        // order alone and the reorder above already covers it.
        const draggable =
          item.selection.kind === "placement" ? item.members ?? [] : null;
        if (draggable) unitIndex += 1;
        const index = unitIndex;
        group.appendChild(
          renderLayerItem(
            item,
            isSelected(item, selection),
            draggable
              ? (_next, event) => this.pick(layer.id, units, index, pickMode(event))
              : (next) => this.callbacks.onSelectItem(next),
            draggable
              ? (event) =>
                  this.drags.beginItemDrag(
                    event,
                    layer.id,
                    draggable,
                    // No unit means carry only: a row that cannot be
                    // reordered can still be dragged to another layer. An
                    // isometric scene sorts an *object* layer on screen Y — a
                    // thing nearer the viewer draws in front of one behind it,
                    // which is what makes the projection read as a space — so
                    // the document's order is not the answer there and a row
                    // that moved would be a row the canvas ignored. A pattern
                    // or background layer holds no such things, so it reorders
                    // by hand on either projection. See `ordersByHand`.
                    ordersByHand(layer, this.isometric)
                      ? item.unit ?? null
                      : null,
                  )
              : undefined,
            // The ⊕, which is ⌘-click for a finger. Only where there is
            // something to add to a selection — see `layer-select.ts`.
            draggable
              ? () => this.pick(layer.id, units, index, "toggle")
              : undefined,
          ),
        );
      }

      // Strokes are listed as one row rather than individually — a sketch
      // is a few hundred of them and each is a stroke of a pen, not an
      // object. Selecting the row selects the lot, which is the granularity
      // the two conversions work at anyway.
      if (layer.strokes.length > 0) {
        group.appendChild(
          h(
            "button",
            {
              class:
                selection.kind === "strokes" && selection.layerId === layer.id
                  ? "layer-item active"
                  : "layer-item",
              onClick: () =>
                this.callbacks.onSelectItem({
                  kind: "strokes",
                  layerId: layer.id,
                  ids: layer.strokes.map((stroke) => stroke.id),
                }),
            },
            icon(ICONS.pencil, 14),
            h("span", {
              class: "layer-item-label",
              text: count(layer.strokes.length, "stroke"),
            }),
          ),
        );
      }

      // A background layer's own way of getting something onto it. Nothing on
      // one can be put down by aiming at the canvas — a backdrop is wherever
      // the camera is — so the button lives at the foot of the list it adds
      // to, which is the one place a backdrop is a thing you can see.
      if (layerKind(layer) === "background") {
        group.appendChild(
          h("button", {
            class: "layer-item add",
            text: "New Background",
            // Selecting the layer first would rebuild this panel and destroy
            // the button under the pointer, and a menu measures the element it
            // hangs from — a detached one reports a box of zeros, which is a
            // menu in the top-left corner of the app. So the layer is made
            // active from inside the menu instead, once something is chosen.
            onClick: (event: Event) => {
              event.stopPropagation();
              this.callbacks.onNewBackground(
                layer.id,
                event.currentTarget as HTMLElement,
              );
            },
          }),
        );
      }
    });

    this.restoreName(editing);
  }

  /** The name input being edited, if the rebuild is about to destroy it. */
  private captureName(): NameFocus | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || !this.body.contains(el)) return null;
    const group = el.closest(".layer-group");
    const layerId = group instanceof HTMLElement ? group.dataset.layerId : null;
    if (!layerId) return null;
    return {
      layerId,
      value: el.value,
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }

  private restoreName(memo: NameFocus | null): void {
    if (!memo) return;
    const input = this.body.querySelector(
      `.layer-group[data-layer-id="${memo.layerId}"] .layer-name`,
    );
    if (!(input instanceof HTMLInputElement)) return;
    input.value = memo.value;
    input.focus();
    input.setSelectionRange(memo.start, memo.end);
  }

  /**
   * Leaving mid-drag would otherwise strand this panel's window listeners,
   * and with them the store they close over.
   */
  destroy(): void {
    this.drags.destroy();
  }

  /**
   * The dropdown the `+` opens: one row per kind of layer.
   *
   * The new layer is selected on the way out, as it always was — a layer you
   * asked for and then have to find is a layer you asked for twice — and a
   * kind that has something to hold is expanded, so the row that puts the
   * first thing on it is already in front of you.
   */
  private openKindMenu(anchor: HTMLElement): void {
    openMenu(
      anchor,
      LAYER_KINDS.map(({ kind, label }) => ({
        label,
        glyph: KIND_ICONS[kind],
        onSelect: () => {
          const layer = this.store.addLayer(undefined, kind);
          if (kind !== "object") this.expanded.add(layer.id);
          this.callbacks.onSelectLayer(layer.id);
        },
      })),
    );
  }

  /** Show a layer's contents, e.g. after selecting something inside it. */
  expand(layerId: string): void {
    if (this.expanded.has(layerId)) return;
    this.expanded.add(layerId);
    this.render();
  }

  /** The grip. Drag to reorder; the arrow keys do the same without a pointer. */
  private grip(layer: Layer): HTMLElement {
    return h(
      "button",
      {
        class: "layer-grip",
        title: "Drag to reorder",
        "aria-label": `Reorder ${layer.name}`,
        onPointerDown: (event: PointerEvent) => this.drags.beginLayerDrag(event, layer.id),
        onClick: (event: Event) => event.stopPropagation(),
        onKeyDown: (event: KeyboardEvent) => {
          const delta =
            event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!delta) return;
          event.preventDefault();
          event.stopPropagation();
          this.store.moveLayer(layer.id, delta);
          // The list was rebuilt under the keyboard, so put focus back on the
          // grip of the row that just moved.
          const moved = this.body.querySelector(
            `.layer-group[data-layer-id="${layer.id}"] .layer-grip`,
          );
          if (moved instanceof HTMLElement) moved.focus();
        },
      },
      icon(ICONS.grip, 16),
    );
  }

  private row(layer: Layer, active: boolean): HTMLElement {
    const kind = layerKind(layer);
    const classes = ["layer-row", `kind-${kind}`];
    if (active) classes.push("active");
    if (layer.locked) classes.push("locked");

    const name = h("input", {
      class: "layer-name",
      value: layer.name,
      readonly: layer.locked ? "true" : null,
      onChange: (event: Event) => {
        const value = (event.target as HTMLInputElement).value.trim();
        if (value) this.store.renameLayer(layer.id, value);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      },
      // A tap on the name selects the layer; editing needs a deliberate focus.
      onClick: (event: Event) => {
        event.stopPropagation();
        this.callbacks.onSelectLayer(layer.id);
      },
    });

    return h(
      "div",
      {
        class: classes.join(" "),
        onClick: () => this.callbacks.onSelectLayer(layer.id),
      },
      // The collapse arrow is the first thing on the row and the grip the
      // last. Opening a layer is a question about the row you are reading, so
      // it sits at the edge the eye starts from, indented over the contents it
      // reveals; carrying a layer somewhere else is a question about the list,
      // so its handle sits at the edge the list ends on, clear of everything a
      // finger means to tap on the way past.
      h(
        "button",
        {
          class: this.expanded.has(layer.id)
            ? "layer-disclose open"
            : "layer-disclose",
          title: this.expanded.has(layer.id) ? "Hide contents" : "Show contents",
          "aria-expanded": String(this.expanded.has(layer.id)),
          onClick: (event: Event) => {
            event.stopPropagation();
            if (this.expanded.has(layer.id)) this.expanded.delete(layer.id);
            else this.expanded.add(layer.id);
            this.render();
          },
        },
        icon(ICONS.chevronRight, 13),
      ),
      // What kind of layer this is, before its name. A glyph rather than a
      // word: the three read apart at a glance, the column is narrow, and the
      // inspector says it in words for anyone who wants them.
      h(
        "span",
        {
          class: "layer-kind",
          title: LAYER_KINDS.find((k) => k.kind === kind)?.label ?? "Layer",
        },
        icon(KIND_ICONS[kind], 14),
      ),
      h(
        "div",
        { class: "layer-main" },
        name,
        h("div", { class: "layer-meta m", text: describe(layer) }),
      ),
      h(
        "button",
        {
          class: layer.visible ? "layer-toggle" : "layer-toggle off",
          title: layer.visible ? "Hide layer" : "Show layer",
          onClick: (event: Event) => {
            event.stopPropagation();
            this.store.setLayerVisible(layer.id, !layer.visible);
          },
        },
        icon(layer.visible ? ICONS.eye : ICONS.eyeOff, 16),
      ),
      h(
        "button",
        {
          class: layer.locked ? "layer-toggle on" : "layer-toggle",
          title: layer.locked ? "Unlock layer" : "Lock layer",
          onClick: (event: Event) => {
            event.stopPropagation();
            this.store.setLayerLocked(layer.id, !layer.locked);
          },
        },
        icon(layer.locked ? ICONS.lock : ICONS.unlock, 15),
      ),
      this.grip(layer),
    );
  }
}
