/**
 * Left sidebar: the layer list. Layers can be reordered, renamed, locked and
 * hidden. Stored top-first, shown top-first.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import type { Layer, Selection } from "../lib/types";
import { isSelected, layerItems, renderLayerItem } from "./layer-items";

export interface LayersPanelCallbacks {
  onSelectLayer: (layerId: string) => void;
  /** Selecting a placement, fill or boundary from the list under a layer. */
  onSelectItem: (selection: Selection) => void;
  getActiveLayerId: () => string;
  getSelection: () => Selection;
}

export class LayersPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly store: DocStore;
  private readonly callbacks: LayersPanelCallbacks;
  private suspended = false;
  /** Layers whose contents are shown. Expansion is per-session UI state. */
  private readonly expanded = new Set<string>();

  constructor(store: DocStore, callbacks: LayersPanelCallbacks) {
    this.store = store;
    this.callbacks = callbacks;

    this.body = h("div", { class: "panel-body scroll" });
    this.root = h(
      "div",
      { class: "side-panel left" },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title m", text: "Layers" }),
        h(
          "button",
          {
            class: "panel-add",
            title: "Add layer",
            onClick: () => {
              const layer = this.store.addLayer();
              this.callbacks.onSelectLayer(layer.id);
            },
          },
          icon(ICONS.plus, 15),
        ),
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

  render(): void {
    const active = this.callbacks.getActiveLayerId();
    const selection = this.callbacks.getSelection();

    clear(this.body);
    this.store.layers.forEach((layer, index) => {
      this.body.appendChild(this.row(layer, index, layer.id === active));

      if (!this.expanded.has(layer.id)) return;
      const items = layerItems(layer);
      if (items.length === 0 && layer.strokes.length === 0) {
        this.body.appendChild(
          h("div", { class: "layer-item empty m", text: "Nothing on this layer" }),
        );
        return;
      }

      for (const item of items) {
        this.body.appendChild(
          renderLayerItem(item, isSelected(item, selection), (next) => {
            this.callbacks.onSelectItem(next);
          }),
        );
      }

      // Strokes are listed as a count until the drawing layer's own
      // selection model arrives; there is nothing to point at yet.
      if (layer.strokes.length > 0) {
        this.body.appendChild(
          h("div", {
            class: "layer-item empty m",
            text: `${layer.strokes.length} strokes`,
          }),
        );
      }
    });
  }

  /** Show a layer's contents, e.g. after selecting something inside it. */
  expand(layerId: string): void {
    if (this.expanded.has(layerId)) return;
    this.expanded.add(layerId);
    this.render();
  }

  private row(layer: Layer, index: number, active: boolean): HTMLElement {
    const classes = ["layer-row"];
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
      h(
        "div",
        { class: "layer-order" },
        h(
          "button",
          {
            title: "Move up",
            disabled: index === 0 ? "true" : null,
            onClick: (event: Event) => {
              event.stopPropagation();
              this.store.moveLayer(layer.id, -1);
            },
          },
          icon(ICONS.chevronUp, 12),
        ),
        h(
          "button",
          {
            title: "Move down",
            disabled: index === this.store.layers.length - 1 ? "true" : null,
            onClick: (event: Event) => {
              event.stopPropagation();
              this.store.moveLayer(layer.id, 1);
            },
          },
          icon(ICONS.chevronDown, 12),
        ),
      ),
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
    );
  }
}

function describe(layer: Layer): string {
  const parts: string[] = [];
  if (layer.placements.length) {
    parts.push(`${layer.placements.length} psd`);
  }
  if (layer.fills.length) {
    const cells = layer.fills.reduce((n, f) => n + f.cells.length, 0);
    parts.push(`${cells} cells`);
  }
  if (layer.zones.length) parts.push(`${layer.zones.length} zones`);
  if (layer.strokes.length) parts.push(`${layer.strokes.length} strokes`);
  return parts.length ? parts.join(" · ") : "empty";
}
