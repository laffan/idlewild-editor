/**
 * The selected PSD's own layer stack, listed in the inspector.
 *
 * Two things about a PSD layer matter to the game, and both are edited here.
 * Order is draw order. The name carries psd-to-json's pipe convention, so
 * renaming `S | tower` to `T | tower` is what turns a sprite into a tileset —
 * which until now meant a round trip out to Photoshop for a change of one
 * character.
 *
 * Edits are held until Apply rather than written per keystroke: the Rust side
 * rebuilds the file and runs the whole pipeline over it again, which is far
 * too much to hang off a keypress. Reordering is the same drag as the layer
 * panel's, and for the same reason followed on `window`.
 *
 * A file the fork cannot rebuild without losing something — masks, clipping —
 * comes back `writable: false` and is listed read-only, with the reason above
 * it. See src-tauri/src/psd_layers.rs.
 *
 * The file is a tree and this list is flat, so a group is a row of its own
 * with its contents indented under it, exactly as Photoshop's panel reads.
 * Reordering therefore moves **blocks**: dragging a group takes what is
 * inside it, and a block only lands among its own siblings, so no drag can
 * quietly move a layer into or out of a group. The arithmetic behind that is
 * in psd-layer-tree.ts, apart from the DOM and tested without one.
 *
 * Some layers are the *app's* rather than the author's, and their names are
 * load-bearing: the two orienting marks are found by name on every re-parse,
 * and an extrusion's artwork layer is regenerated under the file's own key
 * every time the solid behind it is applied again. Renaming one of those is
 * not an edit, it is a way to break something quietly — so an owned layer is
 * listed read-only however writable the file is, and says why. Some of them
 * offer something better instead: the extrusion's carries the way back into
 * extrude mode.
 */

import { clear, h } from "../lib/dom";
import {
  blockLength,
  dropSlots,
  hiddenBy,
  moveBlock,
} from "./psd-layer-tree";
import {
  newLayerButton,
  psdHeadRow,
  type PsdHeadState,
} from "./psd-layer-actions";
import { manifestName, type OwnedLayer } from "./psd-layer-owner";
import { asRow, psdLayerRow, type Row } from "./psd-layer-row";
import { psd, type PsdLayerInfo, type PsdLayerList } from "../lib/ipc";
import * as log from "../lib/log";

export interface PsdLayerEditorCallbacks {
  /**
   * The file was rewritten and re-parsed.
   *
   * `renames` maps the manifest paths that moved, old to new. A placement
   * points at its layer by name, so without it a rename would read as a
   * layer that had gone and take the placement with it.
   */
  onWritten: (manifest: string, renames: Map<string, string>) => void;
  /**
   * Whether the app owns this layer's name. Optional: a caller that has no
   * opinion gets the old behaviour, where every layer of a writable file can
   * be renamed.
   */
  ownerOf?: (layer: PsdLayerInfo) => OwnedLayer | null;
  /** Hand the file to the OS: a desktop editor, or an iPadOS share sheet. */
  onOpen: () => void;
  /** Bring its edits back — a re-parse on desktop, a re-import on iPadOS. */
  onRefresh: () => void;
  /** Open the placed PSD up into its layers on the canvas, or close it. */
  onToggleAdjust: () => void;
  /** Draw into one sprite layer of this file — see `penable`. */
  onPen: (layer: PsdLayerInfo) => void;
  /**
   * Show this file's layers on the canvas the way the list has them staged,
   * or stop and let the document answer again.
   *
   * The eye is staged with everything else — one rewrite and one re-parse for
   * a handful of clicks — and a staged edit you cannot see is one nobody can
   * judge. `names` are what psd-to-json calls the layers, a hidden group's
   * contents included; an empty list means the file itself is the answer.
   */
  onPreviewVisibility: (names: string[]) => void;
  /** What the two round-trip buttons are called on this platform. */
  openLabel: string;
  refreshLabel: string;
}

/**
 * A reorder in flight.
 *
 * `at` and `size` are the block being moved, in the order as it stands — both
 * follow the block as it passes its siblings. `before` is the order to put
 * back if the gesture is cancelled.
 */
interface DragState {
  at: number;
  size: number;
  pointerId: number;
  before: Row[];
  release: () => void;
}

export class PsdLayerEditor {
  readonly root: HTMLElement;
  /** Which PSD this is for, so the inspector can tell it apart from another. */
  readonly key: string;

  private readonly projectId: string;
  private readonly callbacks: PsdLayerEditorCallbacks;
  private readonly status: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly newRow: HTMLElement;
  private readonly foot: HTMLElement;
  private stack: PsdLayerList | null = null;
  private rows: Row[] = [];
  private drag: DragState | null = null;
  private busy = false;
  /**
   * What the canvas is doing with this PSD, as the inspector last said.
   *
   * Pushed in rather than read out: this list knows about a *file*, and
   * whether the placement of it is open for layer-by-layer moves is a fact
   * about the canvas. Null while nothing has said — a file with one layer,
   * or one nothing has placed.
   */
  private adjust: { members: number; adjusting: boolean } | null = null;
  /**
   * The groups that are folded shut, by the name the file holds them under.
   *
   * By name rather than by index because the list is re-read on every
   * rewrite and every re-parse, and an index means something different after
   * each of those while a name does not. The name as *read*, not as typed,
   * so a group does not spring open while someone is renaming it — Apply
   * carries the fold over to the new name. Two groups sharing a name fold
   * together, which is a truthful answer to an ambiguous file.
   */
  private collapsed = new Set<string>();

  constructor(
    projectId: string,
    key: string,
    callbacks: PsdLayerEditorCallbacks,
  ) {
    this.projectId = projectId;
    this.key = key;
    this.callbacks = callbacks;

    this.status = h("div", { class: "psd-layers-status m" });
    // Three slots the panel refills rather than three panels: the row above
    // the list changes with the canvas, and the one below it with the file.
    this.head = h("div", { class: "psd-layers-head-slot" });
    this.list = h("div", { class: "psd-layer-list" });
    this.newRow = h("div", { class: "psd-layers-new-slot" });
    this.foot = h("div", { class: "psd-layers-foot" });
    // The file's own size, which is not the placement's: a converted sketch
    // carries the grid it was drawn over beside the artwork, so the canvas
    // Photoshop opens is bigger than the image the canvas shows. Saying so
    // here is what stops the two numbers looking like a bug.
    this.canvas = h("div", { class: "psd-layers-canvas m" });
    this.root = h(
      "div",
      { class: "inspect-section psd-layers" },
      h("div", { class: "inspect-section-title m", text: "PSD" }),
      this.canvas,
      this.head,
      this.status,
      this.list,
      this.newRow,
      this.foot,
    );
    // Before the file has been read, so the buttons that are about the file
    // rather than about its stack are there from the first frame.
    this.renderHead();

    void this.load();
  }

  destroy(): void {
    this.endDrag(false);
    // A preview belongs to the panel showing it. Leaving one behind would
    // leave a layer turned off on a canvas with nothing left to say why.
    this.callbacks.onPreviewVisibility([]);
  }

  /**
   * Read the file again.
   *
   * The list is built once and kept across the inspector's re-renders,
   * because it holds half-typed names and a pending reorder. That is right
   * for a re-render and wrong for a *re-parse*: the file on disk has just
   * changed, and a stack listed from the old one shows neither the layer
   * someone added in Photoshop nor the indices an edit would now be against.
   * A drag in flight is dropped rather than reconciled — the rows it was
   * moving may not exist any more.
   */
  reload(): void {
    if (this.busy) return;
    this.endDrag(false);
    void this.load();
  }

  /**
   * Say what the canvas is doing with the placement this list belongs to, so
   * the head can offer the switch between the two.
   *
   * Told on every inspector render rather than once, because the answer
   * changes without the file changing: a double-tap on the canvas opens a PSD
   * up, and this list is built once and kept until the selection moves to a
   * different file.
   */
  setAdjust(state: { members: number; adjusting: boolean } | null): void {
    const same =
      this.adjust?.members === state?.members &&
      this.adjust?.adjusting === state?.adjusting;
    this.adjust = state;
    if (!same) this.renderHead();
  }

  // ── loading ───────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    this.setStatus("Reading the file…");
    let stack: PsdLayerList;
    try {
      stack = await psd.readLayers(this.projectId, this.key);
    } catch (err) {
      this.stack = null;
      this.rows = [];
      clear(this.list);
      clear(this.newRow);
      clear(this.foot);
      log.error(`Could not read the layers of ${this.key}.psd:`, err);
      this.setStatus("This PSD's layers could not be read.");
      return;
    }
    this.stack = stack;
    this.rows = stack.layers.map(asRow);
    // Groups are rows too, but they are not layers, and counting them as
    // layers would make the number disagree with what Photoshop reports.
    const count = stack.layers.filter((layer) => !layer.isGroup).length;
    this.canvas.textContent =
      `${this.key}.psd · ${stack.width} × ${stack.height} canvas · ` +
      `${count} ${count === 1 ? "layer" : "layers"}`;
    this.render();
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === "";
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    const stack = this.stack;
    if (!stack) return;

    this.setStatus(stack.writable ? "" : (stack.blockedBy ?? "Read-only."));
    this.status.classList.toggle("blocked", !stack.writable);

    clear(this.list);
    // Every row is rendered whether or not it shows, so the list and the
    // model stay one to one — the drag indexes one against the other, and a
    // folded group would otherwise shift everything under it out of step.
    const hidden = hiddenBy(this.rows, (row) => this.isFolded(row));
    this.rows.forEach((row, at) => {
      const el = psdLayerRow(row, {
        stack,
        rows: this.rows,
        owner: (layer) => this.callbacks.ownerOf?.(layer) ?? null,
        folded: (held) => this.isFolded(held),
        onFold: (held) => this.fold(held),
        onRename: (held, name) => {
          held.name = name;
          this.updateFoot();
        },
        onVisible: (held, visible) => {
          held.visible = visible;
          // The canvas first: this is the half of the edit that is free, and
          // the whole reason the other half can wait for Apply.
          this.pushPreview();
          this.render();
        },
        onGripDown: (event) => this.beginDrag(event),
        onGripKey: (event, held) => this.onGripKey(event, held),
        onPen: (layer) => this.callbacks.onPen(layer),
      });
      el.hidden = hidden[at];
      this.list.appendChild(el);
    });
    if (this.rows.length === 0) {
      this.list.appendChild(
        h("div", { class: "psd-layers-status m", text: "No layers." }),
      );
    }
    this.renderHead();
    this.renderNew();
    this.updateFoot();
  }

  /** The row of buttons above the list — see psd-layer-actions.ts. */
  private renderHead(): void {
    clear(this.head);
    const state: PsdHeadState = {
      members: this.adjust?.members ?? 0,
      adjusting: this.adjust?.adjusting ?? false,
      openLabel: this.callbacks.openLabel,
      refreshLabel: this.callbacks.refreshLabel,
    };
    this.head.appendChild(
      psdHeadRow(state, {
        onToggleAdjust: () => this.callbacks.onToggleAdjust(),
        onOpen: () => this.callbacks.onOpen(),
        onRefresh: () => this.callbacks.onRefresh(),
      }),
    );
  }

  /**
   * New layer, under the list.
   *
   * Left off a file this editor cannot rewrite at all: adding a layer to one
   * carrying masks or clipping is the same rebuild a rename is, and the same
   * work lost.
   */
  private renderNew(): void {
    clear(this.newRow);
    if (!this.stack?.writable) return;
    this.newRow.appendChild(
      newLayerButton(this.busy, () => void this.addLayer()),
    );
  }

  private updateFoot(): void {
    clear(this.foot);
    const stack = this.stack;
    if (!stack?.writable || this.rows.length === 0) return;

    if (this.busy) {
      this.foot.appendChild(
        h("div", { class: "psd-layers-status m", text: "Rewriting the PSD…" }),
      );
      return;
    }
    if (!this.dirty) return;

    this.foot.appendChild(
      h(
        "div",
        { class: "panel-btn-row" },
        h("button", {
          class: "panel-btn primary",
          text: "Apply",
          onClick: () => void this.apply(),
        }),
        h("button", {
          class: "panel-btn",
          text: "Revert",
          onClick: () => {
            this.rows = stack.layers.map(asRow);
            this.pushPreview();
            this.render();
          },
        }),
      ),
    );
  }

  /** Whether anything has been moved, retyped or turned off since the read. */
  private get dirty(): boolean {
    return this.rows.some(
      (row, i) =>
        row.source.index !== i ||
        row.name.trim() !== row.source.name ||
        row.visible !== row.source.visible,
    );
  }

  /**
   * Show the canvas what this list has staged, or hand it back to the file.
   *
   * The names are *effective*: a layer inside a group that has been turned
   * off is turned off too, which is the reading psd-to-json leaves to
   * whoever consumes it — and `hiddenBy` already walks a flat list of depths
   * for exactly this shape of question, for folding.
   *
   * Nothing staged means nothing to preview, and the renderer goes back to
   * reading the document. The names are the ones the file *currently* holds,
   * because what is on the canvas was made from the file as it currently is.
   */
  private pushPreview(): void {
    if (!this.rows.some((row) => row.visible !== row.source.visible)) {
      this.callbacks.onPreviewVisibility([]);
      return;
    }
    const inside = hiddenBy(this.rows, (row) => !row.visible);
    const names: string[] = [];
    this.rows.forEach((row, at) => {
      if (row.visible && !inside[at]) return;
      const name = manifestName(row.source.name);
      if (name) names.push(name);
    });
    this.callbacks.onPreviewVisibility(names);
  }

  // ── writing ───────────────────────────────────────────────────────────────

  private async apply(): Promise<void> {
    if (this.busy || !this.stack?.writable) return;

    const edits = this.rows.map((row) => ({
      index: row.source.index,
      name: row.name.trim(),
      depth: row.depth,
      visible: row.visible,
    }));
    if (edits.some((edit) => edit.name === "")) {
      log.warn("Every layer needs a name.");
      return;
    }

    this.busy = true;
    this.renderNew();
    this.updateFoot();
    try {
      const manifest = await psd.writeLayers(this.projectId, this.key, edits);
      log.info(`Rewrote ${this.key}.psd — ${edits.length} layers`);
      // The file says it now, so the canvas stops being told and reads the
      // document again — which the re-parse below is about to refresh.
      this.callbacks.onPreviewVisibility([]);
      this.callbacks.onWritten(manifest, this.renames());
      this.busy = false;
      // A folded group that has just been renamed is still folded, so the
      // fold moves to the name the file now holds it under.
      for (const row of this.rows) {
        const after = row.name.trim();
        if (after !== row.source.name && this.collapsed.delete(row.source.name)) {
          this.collapsed.add(after);
        }
      }
      // The indices every edit is named by have just moved, so the file is
      // read again rather than guessed at.
      await this.load();
    } catch (err) {
      log.error(`Could not rewrite ${this.key}.psd:`, err);
      this.busy = false;
      this.updateFoot();
    }
  }

  /**
   * Put an empty sprite layer on the top of the file.
   *
   * Written straight away rather than held with the pending edits above it,
   * because what the row is *for* is somewhere to draw and pen mode can only
   * put ink in a layer the file really has. The file is read again after, so
   * a half-typed rename waiting for Apply is lost — which is why the button
   * goes quiet while the write is in flight rather than trying to be clever
   * about merging the two.
   */
  private async addLayer(): Promise<void> {
    if (this.busy || !this.stack?.writable) return;
    this.busy = true;
    this.renderNew();
    this.updateFoot();
    try {
      const manifest = await psd.addLayer(this.projectId, this.key);
      log.info(`Added a layer to ${this.key}.psd`);
      // Nothing was renamed, so no placement is pointing anywhere new.
      this.callbacks.onWritten(manifest, new Map());
      this.busy = false;
      await this.load();
    } catch (err) {
      log.error(`Could not add a layer to ${this.key}.psd:`, err);
      this.busy = false;
      this.render();
    }
  }

  /** The manifest paths this write moves, old name to new. */
  private renames(): Map<string, string> {
    const out = new Map<string, string>();
    for (const row of this.rows) {
      const before = manifestName(row.source.name);
      const after = manifestName(row.name);
      if (before && after && before !== after) out.set(before, after);
    }
    return out;
  }

  // ── reordering ────────────────────────────────────────────────────────────

  private isFolded(row: Row): boolean {
    return row.source.isGroup && this.collapsed.has(row.source.name);
  }

  /** Fold a group away, or open it back up. */
  private fold(row: Row): void {
    if (!this.collapsed.delete(row.source.name)) {
      this.collapsed.add(row.source.name);
    }
    this.render();
  }

  /**
   * Move a block to one of the slots open to it, and say where it landed.
   *
   * Everything that reorders goes through here — the drag, the keyboard —
   * so there is one answer to what a legal move is: a block lands among its
   * own siblings or it does not move.
   */
  private moveTo(at: number, to: number): number {
    const size = blockLength(this.rows, at);
    if (size <= 0 || !dropSlots(this.rows, at).includes(to)) return at;
    this.rows = moveBlock(this.rows, at, size, to);
    return to > at ? to - size : to;
  }

  /**
   * Step a block past the sibling above or below it.
   *
   * The slots either side of a block are the starts of its sibling blocks and
   * the end of the run; stepping down means clearing the next block whole,
   * which is the slot *after* the one that block starts at.
   */
  private onGripKey(event: KeyboardEvent, row: Row): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();

    const at = this.rows.indexOf(row);
    if (at < 0) return;
    const slots = dropSlots(this.rows, at);
    const above = slots.filter((slot) => slot < at);
    const below = slots.filter((slot) => slot > at);
    const to = delta < 0 ? above.at(-1) : below[1];
    if (to === undefined) return;

    const landed = this.moveTo(at, to);
    this.render();
    this.list.children[landed]
      ?.querySelector<HTMLElement>(".psd-layer-grip")
      ?.focus();
  }

  /**
   * Follow the gesture on `window`: the block is moved through the list as
   * the pointer passes its siblings, and a captured element that leaves the
   * document takes its capture with it.
   *
   * The order is kept in `this.rows` and the list redrawn from it, rather
   * than the rows being shuffled in the DOM and read back: a block is several
   * elements, and moving them one at a time is a way to end a drag holding
   * half of one.
   */
  private beginDrag(event: PointerEvent): void {
    const el = (event.currentTarget as HTMLElement).closest(".psd-layer-row");
    if (!(el instanceof HTMLElement) || this.drag) return;
    const at = [...this.list.children].indexOf(el);
    if (at < 0) return;
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

    this.list.classList.add("reordering");
    this.drag = {
      at,
      size: blockLength(this.rows, at),
      pointerId,
      before: [...this.rows],
      release: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      },
    };
    this.markDragged();
  }

  /**
   * Put the block wherever the pointer is nearest to a slot it may take.
   *
   * Nearest rather than crossed-over: the slots open to a block are not every
   * row boundary, so a rule about passing the midpoint of whatever happens to
   * be under the pointer would refuse to commit while the pointer sits over a
   * group's contents.
   */
  private dragTo(y: number): void {
    const drag = this.drag;
    if (!drag) return;

    let best = drag.at;
    let nearest = Infinity;
    for (const slot of dropSlots(this.rows, drag.at)) {
      const away = Math.abs(this.slotY(slot) - y);
      if (away < nearest) {
        nearest = away;
        best = slot;
      }
    }
    if (best === drag.at || best === drag.at + drag.size) return;

    drag.at = this.moveTo(drag.at, best);
    this.render();
    this.markDragged();
  }

  /**
   * Where a slot sits on screen: the top of the first row after it that is
   * actually showing, or the bottom of the list if there is none.
   *
   * A folded group's contents are still in the list, with no box to measure —
   * so a slot is found by looking past them rather than at them.
   */
  private slotY(slot: number): number {
    const children = [...this.list.children];
    for (let i = slot; i < children.length; i++) {
      const el = children[i];
      if (el instanceof HTMLElement && !el.hidden) {
        return el.getBoundingClientRect().top;
      }
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const el = children[i];
      if (el instanceof HTMLElement && !el.hidden) {
        return el.getBoundingClientRect().bottom;
      }
    }
    return 0;
  }

  /** Show the whole block as picked up, not just the row under the grip. */
  private markDragged(): void {
    const drag = this.drag;
    if (!drag) return;
    for (let i = drag.at; i < drag.at + drag.size; i++) {
      this.list.children[i]?.classList.add("dragging");
    }
  }

  private endDrag(commit: boolean): void {
    if (!this.drag) return;
    const { release, before } = this.drag;
    this.drag = null;
    release();
    this.list.classList.remove("reordering");
    if (!commit) this.rows = before;
    this.render();
  }
}
