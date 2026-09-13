/**
 * The two drags in the layer panel, and the one gesture that is both.
 *
 * A **layer row** is dragged by its grip to a position in the list. A **placed
 * PSD** listed under a layer is dragged by its own grip, and where the finger
 * ends up decides what that meant: over a different layer it is carried
 * there, over its own it is moved to another place in that layer's list —
 * which is the order it draws in. So one takes a *position*, the other takes
 * a *layer or* a position, and the second is why they are one file.
 *
 * Both are followed on `window` rather than through `setPointerCapture`.
 * Capture is released the moment the capturing element is taken out of the
 * document, and moving a row through the list does exactly that — so the
 * pointer-up that commits the drop was landing on whatever the finger
 * happened to be over instead, and the drop was never written. Window
 * listeners see the whole gesture whatever the DOM does underneath.
 *
 * Split out of `layers-panel.ts` for the line rule, and it splits cleanly:
 * that file is about what the list shows, and this is about what a finger on
 * it means. What it needs from the panel is narrow — the element the rows are
 * in, the document, and a way to say the list should be rebuilt.
 */

import type { DocStore } from "../lib/doc-store";
import { reorderUnit } from "../lib/units";
import type { Selection } from "../lib/types";

/** A layer row being moved to a position in the list. */
interface LayerDragState {
  layerId: string;
  group: HTMLElement;
  pointerId: number;
  /** Undoes the window listeners this drag installed. */
  release: () => void;
}

/**
 * A placed PSD being dragged: to another layer, or to another place in its
 * own layer's list.
 *
 * One gesture, two meanings, decided by where the finger is. Over a different
 * layer it is a carry, and that layer lights up — there is one legal drop per
 * layer rather than a position in a list. Over its own it is a reorder, and
 * the row moves through the DOM as it goes, the way a layer row does, so the
 * list shows the order it is about to commit.
 */
interface ItemDragState {
  layerId: string;
  /** The unit, which is what a reorder moves. Absent means carry only. */
  unit: string | null;
  row: HTMLElement;
  placementIds: string[];
  pointerId: number;
  /** The layer the pointer is currently over, if any. */
  target: string | null;
  /** Whether the row has been moved within its own list. */
  reordered: boolean;
  release: () => void;
}

/** What the drags need from the panel around them. */
export interface LayerDragHost {
  /** The element the layer groups are in. */
  body: HTMLElement;
  store: DocStore;
  /** Rebuild the list — a cancelled drag still has to put it back. */
  render: () => void;
  /** Show a layer's contents, after something has been carried into it. */
  expand: (layerId: string) => void;
  /** Follow what was just carried, so the inspector is describing it. */
  select: (selection: Selection) => void;
}

export class LayerDrags {
  private readonly host: LayerDragHost;
  private drag: LayerDragState | null = null;
  private itemDrag: ItemDragState | null = null;

  constructor(host: LayerDragHost) {
    this.host = host;
  }

  /** Whether a drag owns the DOM, in which case the list must not rebuild. */
  get active(): boolean {
    return this.drag !== null || this.itemDrag !== null;
  }

  /** A scene switch: the row being dragged is about a scene that has gone. */
  forget(): void {
    this.drag = null;
    this.itemDrag = null;
  }

  /**
   * Leaving mid-drag would otherwise strand the window listeners, and with
   * them the store they close over.
   */
  destroy(): void {
    this.endDrag(false);
    this.endItemDrag(null);
  }

  // ── a layer, to a position in the list ────────────────────────────────────

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
  beginLayerDrag(event: PointerEvent, layerId: string): void {
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
    this.host.body.classList.add("reordering");
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
    for (const sibling of this.host.body.children) {
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
    this.host.body.insertBefore(group, before);
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
  beginItemDrag(
    event: PointerEvent,
    layerId: string,
    placementIds: string[],
    unit: string | null,
  ): void {
    if (this.drag || this.itemDrag) return;
    const row = (event.currentTarget as HTMLElement).closest(".layer-item");
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();

    const { pointerId } = event;
    const onMove = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      moved.preventDefault();
      const over = this.layerAt(moved.clientY);
      this.highlightLayer(over);
      // Its own layer means a reorder rather than a carry, so the row travels
      // with the finger instead of lighting a destination up.
      if (over === layerId) this.itemDragTo(moved.clientY);
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

    this.host.body.classList.add("carrying");
    row.classList.add("dragging");
    this.itemDrag = {
      layerId,
      unit,
      row,
      placementIds,
      pointerId,
      target: null,
      reordered: false,
      release: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      },
    };
  }

  /** Which layer's block of the panel a screen Y falls in. */
  private layerAt(y: number): string | null {
    for (const group of this.host.body.children) {
      if (!(group instanceof HTMLElement)) continue;
      const box = group.getBoundingClientRect();
      if (y >= box.top && y <= box.bottom) return group.dataset.layerId ?? null;
    }
    return null;
  }

  /**
   * Move the dragged row past whichever sibling the pointer has crossed.
   *
   * The same gesture a layer reorder makes, over the rows of one layer's list
   * rather than over the layers themselves — and it reads the boxes after
   * each insert for the same reason: the list has reflowed, so the next
   * comparison is against where the rows now are.
   *
   * Only the rows that *are* units move. A fill, a point and a boundary are
   * listed under a layer too, and none of them has a place in the order
   * placed files draw in.
   */
  private itemDragTo(y: number): void {
    const drag = this.itemDrag;
    if (!drag || !drag.unit) return;

    const siblings = [...drag.row.parentElement!.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el !== drag.row && !!el.dataset.unit,
    );
    let before: Element | null = null;
    for (const sibling of siblings) {
      const box = sibling.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        before = sibling;
        break;
      }
    }
    // Past the last unit rather than past the last row: what follows the
    // units is a fill or a boundary, and a file does not belong under those.
    const anchor = before ?? siblings[siblings.length - 1]?.nextElementSibling ?? null;
    if (anchor === drag.row.nextElementSibling) return;
    drag.row.parentElement!.insertBefore(drag.row, anchor);
    drag.reordered = true;
  }

  private highlightLayer(layerId: string | null): void {
    if (!this.itemDrag || this.itemDrag.target === layerId) return;
    this.itemDrag.target = layerId;
    for (const group of this.host.body.children) {
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
    this.host.body.classList.remove("carrying");
    drag.row.classList.remove("dragging");
    for (const group of this.host.body.children) {
      if (group instanceof HTMLElement) group.classList.remove("drop-into");
    }

    // Let go over its own layer: what changed is where it sits in the order
    // its layer draws in — see `reorderUnit`, and `drawOrder`, which reads
    // that order on every projection that does not sort on screen Y.
    if (drag.unit && drag.reordered && (!target || target === drag.layerId)) {
      const index = [...drag.row.parentElement!.children]
        .filter((el) => el instanceof HTMLElement && el.dataset.unit)
        .indexOf(drag.row);
      if (index >= 0) {
        this.host.store.editLayer(drag.layerId, (layer) =>
          reorderUnit(layer, drag.unit as string, index),
        );
      }
      this.host.render();
      return;
    }

    if (target && target !== drag.layerId) {
      this.host.store.movePlacements(drag.layerId, drag.placementIds, target);
      // Follow it: the row the finger let go of is now under a different
      // layer, and leaving the selection pointing at the old one would show
      // the inspector an image that is no longer there.
      this.host.expand(target);
      this.host.select({
        kind: "placement",
        layerId: target,
        placementId: drag.placementIds[0],
      });
    }
    // A cancelled drop still has to put the list back the way it was: the
    // store only re-renders when something actually changed.
    this.host.render();
  }

  private endDrag(commit: boolean): void {
    if (!this.drag) return;
    const { layerId, group, release } = this.drag;
    this.drag = null;

    release();
    group.classList.remove("dragging");
    this.host.body.classList.remove("reordering");

    const index = Array.prototype.indexOf.call(this.host.body.children, group);
    if (commit && index >= 0) this.host.store.reorderLayer(layerId, index);
    // `reorderLayer` re-renders through the store's change event when the
    // order actually moved; a cancelled or no-op drag still needs the list
    // put back the way the document has it.
    this.host.render();
  }
}
