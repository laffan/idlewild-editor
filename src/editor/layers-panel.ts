/**
 * Left sidebar: scenes and layers, in the order you think about them —
 * which place am I in, then what is in it.
 *
 * The scene dropdown along the top is `scenes-bar.ts`; the rest of this file
 * is the layer list. Layers can be reordered, renamed, locked and hidden, and
 * belong to the scene that is open — switching scenes is a different list,
 * not a filter over one.  Stored top-first, shown top-first.
 *
 * Reordering is a drag on the grip at the left of each row. Pointer events
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
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import type { Layer, Selection } from "../lib/types";
import { isSelected, layerItems, renderLayerItem } from "./layer-items";
import { ScenesBar } from "./scenes-bar";

export interface LayersPanelCallbacks {
  onSelectLayer: (layerId: string) => void;
  /** Selecting a placement, fill or boundary from the list under a layer. */
  onSelectItem: (selection: Selection) => void;
  getActiveLayerId: () => string;
  getSelection: () => Selection;
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

/** A drag in flight: the group being moved and the pointer that owns it. */
interface DragState {
  layerId: string;
  group: HTMLElement;
  pointerId: number;
  /** Undoes the window listeners this drag installed. */
  release: () => void;
}

/** A placement being carried from one layer to another. */
interface ItemDragState {
  layerId: string;
  placementIds: string[];
  pointerId: number;
  /** The layer the pointer is currently over, if any. */
  target: string | null;
  release: () => void;
}

export class LayersPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly scenes: ScenesBar;
  private readonly store: DocStore;
  private readonly callbacks: LayersPanelCallbacks;
  private suspended = false;
  private drag: DragState | null = null;
  private itemDrag: ItemDragState | null = null;
  /** Layers whose contents are shown. Expansion is per-session UI state. */
  private readonly expanded = new Set<string>();

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

    this.body = h("div", { class: "panel-body scroll" });
    this.scenes = new ScenesBar(store);
    this.root = h(
      "div",
      { class: "side-panel left" },
      this.scenes.root,
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
      footer,
    );

    store.addEventListener("change", () => {
      if (!this.suspended) this.render();
    });
    // A switch leaves the list showing another scene's layers, and the drag
    // or rename that was in flight is about a row that has gone.
    store.addEventListener("scene", () => {
      this.drag = null;
      this.itemDrag = null;
      this.expanded.clear();
      this.render();
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
    // A drag in flight owns the DOM until it is released; rebuilding under
    // it would drop the element the pointer is holding.
    if (this.drag || this.itemDrag) return;

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
      const items = layerItems(layer, this.store.activeScene.startPointId);
      if (items.length === 0 && layer.strokes.length === 0) {
        group.appendChild(
          h("div", { class: "layer-item empty m", text: "Nothing on this layer" }),
        );
        return;
      }

      for (const item of items) {
        // Only a placement is carried between layers. A fill is a run of grid
        // spaces and a boundary is a polygon; both are addressed in world
        // coordinates that no layer owns, so moving one is a change of draw
        // order alone and the reorder above already covers it.
        const draggable =
          item.selection.kind === "placement" ? item.members ?? [] : null;
        group.appendChild(
          renderLayerItem(
            item,
            isSelected(item, selection),
            (next) => this.callbacks.onSelectItem(next),
            draggable
              ? (event) => this.beginItemDrag(event, layer.id, draggable)
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
    this.endDrag(false);
    this.endItemDrag(null);
  }

  /** Show a layer's contents, e.g. after selecting something inside it. */
  expand(layerId: string): void {
    if (this.expanded.has(layerId)) return;
    this.expanded.add(layerId);
    this.render();
  }

  // ── reordering ────────────────────────────────────────────────────────────

  /**
   * Start a reorder.
   *
   * The rest of the gesture is followed on `window` rather than through
   * `setPointerCapture` on the grip. Capture is released the moment the
   * capturing element is taken out of the document, and moving the row
   * through the list does exactly that — so the pointer-up that commits the
   * drop was landing on whatever the finger happened to be over instead, and
   * the drop was never written. Window listeners see the whole gesture
   * whatever the DOM does underneath it.
   */
  private beginDrag(event: PointerEvent, layerId: string): void {
    const group = (event.currentTarget as HTMLElement).closest(".layer-group");
    if (!(group instanceof HTMLElement) || this.drag) return;

    event.preventDefault();
    event.stopPropagation();

    const { pointerId } = event;
    const onMove = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      moved.preventDefault();
      this.dragTo(moved.clientY);
    };
    const onUp = (ended: PointerEvent) => {
      if (ended.pointerId === pointerId) this.endDrag(true);
    };
    const onCancel = (ended: PointerEvent) => {
      if (ended.pointerId === pointerId) this.endDrag(false);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);

    group.classList.add("dragging");
    this.body.classList.add("reordering");
    this.drag = {
      layerId,
      group,
      pointerId,
      release: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      },
    };
  }

  /**
   * Move the dragged group past whichever neighbour the pointer has crossed.
   *
   * Reading the boxes after each insert is deliberate: the list has already
   * reflowed, so the next comparison is made against where the rows now are
   * rather than where they started.
   */
  private dragTo(y: number): void {
    if (!this.drag) return;
    const { group } = this.drag;

    let before: HTMLElement | null = null;
    for (const sibling of this.body.children) {
      if (!(sibling instanceof HTMLElement) || sibling === group) continue;
      const box = sibling.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        before = sibling;
        break;
      }
    }
    // Inserting a node before the one it already precedes is a real DOM move
    // and a real reflow, so nothing happens unless the order actually changes.
    if (before === group.nextElementSibling) return;
    this.body.insertBefore(group, before);
  }

  // ── carrying a placement to another layer ─────────────────────────────────

  /**
   * Start moving a placed PSD onto a different layer.
   *
   * Followed on `window` for the reason the layer reorder is: the panel
   * rebuilds on every document change, and pointer capture is released the
   * moment the capturing element leaves the document.
   *
   * Unlike a reorder the rows do not move as the finger travels. There is one
   * legal drop per layer rather than a position in a list, so the layer under
   * the pointer is marked instead — the same choice the code modal's file
   * tree makes, for the same reason.
   */
  private beginItemDrag(
    event: PointerEvent,
    layerId: string,
    placementIds: string[],
  ): void {
    if (this.drag || this.itemDrag) return;
    event.preventDefault();
    event.stopPropagation();

    const { pointerId } = event;
    const onMove = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      moved.preventDefault();
      this.highlightLayer(this.layerAt(moved.clientY));
    };
    const onUp = (ended: PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      this.endItemDrag(this.layerAt(ended.clientY));
    };
    const onCancel = (ended: PointerEvent) => {
      if (ended.pointerId === pointerId) this.endItemDrag(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);

    this.body.classList.add("carrying");
    this.itemDrag = {
      layerId,
      placementIds,
      pointerId,
      target: null,
      release: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      },
    };
  }

  /** Which layer's block of the panel a screen Y falls in. */
  private layerAt(y: number): string | null {
    for (const group of this.body.children) {
      if (!(group instanceof HTMLElement)) continue;
      const box = group.getBoundingClientRect();
      if (y >= box.top && y <= box.bottom) return group.dataset.layerId ?? null;
    }
    return null;
  }

  private highlightLayer(layerId: string | null): void {
    if (!this.itemDrag || this.itemDrag.target === layerId) return;
    this.itemDrag.target = layerId;
    for (const group of this.body.children) {
      if (!(group instanceof HTMLElement)) continue;
      // The layer it is already on is not a destination, so it is never lit.
      group.classList.toggle(
        "drop-into",
        group.dataset.layerId === layerId && layerId !== this.itemDrag.layerId,
      );
    }
  }

  private endItemDrag(target: string | null): void {
    const drag = this.itemDrag;
    if (!drag) return;
    this.itemDrag = null;

    drag.release();
    this.body.classList.remove("carrying");
    for (const group of this.body.children) {
      if (group instanceof HTMLElement) group.classList.remove("drop-into");
    }

    if (target && target !== drag.layerId) {
      this.store.movePlacements(drag.layerId, drag.placementIds, target);
      // Follow it: the row the finger let go of is now under a different
      // layer, and leaving the selection pointing at the old one would show
      // the inspector an image that is no longer there.
      this.expanded.add(target);
      this.callbacks.onSelectItem({
        kind: "placement",
        layerId: target,
        placementId: drag.placementIds[0],
      });
    }
    // A cancelled drop still has to put the list back the way it was: the
    // store only re-renders when something actually changed.
    this.render();
  }

  private endDrag(commit: boolean): void {
    if (!this.drag) return;
    const { layerId, group, release } = this.drag;
    this.drag = null;

    release();
    group.classList.remove("dragging");
    this.body.classList.remove("reordering");

    const index = Array.prototype.indexOf.call(this.body.children, group);
    if (commit && index >= 0) this.store.reorderLayer(layerId, index);
    // `reorderLayer` re-renders through the store's change event when the
    // order actually moved; a cancelled or no-op drag still needs the list
    // put back the way the document has it.
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
        onPointerDown: (event: PointerEvent) => this.beginDrag(event, layer.id),
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
      this.grip(layer),
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
  if (layer.placements.length) parts.push(`${layer.placements.length} psd`);
  if (layer.fills.length) {
    // Two kinds of fill in one count: a run of spaces contributes its spaces,
    // a rectangle contributes itself. Counting only cells reported a blank
    // project's fills as nothing at all.
    const cells = layer.fills.reduce((n, f) => n + f.cells.length, 0);
    const rects = layer.fills.filter((f) => f.rect).length;
    if (cells) parts.push(count(cells, "cell"));
    if (rects) parts.push(count(rects, "fill"));
  }
  if (layer.points.length) parts.push(count(layer.points.length, "point"));
  if (layer.zones.length) parts.push(count(layer.zones.length, "zone"));
  if (layer.strokes.length) parts.push(count(layer.strokes.length, "stroke"));
  return parts.length ? parts.join(" · ") : "empty";
}

/** These read at a glance, and "1 strokes" stops the glance. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
