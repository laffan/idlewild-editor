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
 * A file the fork cannot rebuild without losing something — groups, masks,
 * clipping — comes back `writable: false` and is listed read-only, with the
 * reason above it. See src-tauri/src/psd_layers.rs.
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

import { clear, h, ICONS, icon } from "../lib/dom";
import { psd, type PsdLayerInfo, type PsdLayerList } from "../lib/ipc";
import * as log from "../lib/log";

/**
 * A layer this editor owns the name of, and what it offers in its place.
 *
 * `reason` is what the field says when it will not be typed in. `action` is
 * the button on the right of the row — the one thing an owned layer can do
 * that an ordinary one cannot.
 */
export interface OwnedLayer {
  reason: string;
  action?: {
    icon: string | readonly string[];
    label: string;
    run: () => void;
  };
}

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
}

/**
 * Which of a PSD's layers this editor owns the name of.
 *
 * The two orienting marks on any file it wrote — `P | anchor` is looked up by
 * name on every parse, and renaming it silently costs the artwork its
 * alignment on the next re-import — and the artwork layer of an extrusion,
 * which Apply regenerates under the file's own key. That last one is also the
 * way back in: its row carries the button that reopens the solid.
 */
export function psdLayerOwner(
  layer: PsdLayerInfo,
  key: string,
  isExtrusion: boolean,
  onExtrude: () => void,
): OwnedLayer | null {
  // The exported name, not the whole label: `manifestName` is what a
  // placement's path is made of, and it is what psd-to-json reads too.
  const named = manifestName(layer.name)?.toLowerCase() ?? "";
  if (layer.category === "point" && named === "anchor") {
    return { reason: "The editor finds this mark by name — it cannot be renamed" };
  }
  if (layer.category === "zone" && named === "grid") {
    return { reason: "The editor writes this mark — it cannot be renamed" };
  }
  if (isExtrusion && layer.category === "sprite" && named === key.toLowerCase()) {
    return {
      reason: "Extrude mode writes this layer — it cannot be renamed",
      action: {
        icon: ICONS.box,
        label: "Continue extruding this shape",
        run: onExtrude,
      },
    };
  }
  return null;
}

/** A layer as it is in the file, beside the name it is being given. */
interface Row {
  source: PsdLayerInfo;
  name: string;
}

/** A reorder in flight. */
interface DragState {
  row: HTMLElement;
  pointerId: number;
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
  private readonly list: HTMLElement;
  private readonly foot: HTMLElement;
  private stack: PsdLayerList | null = null;
  private rows: Row[] = [];
  private drag: DragState | null = null;
  private busy = false;

  constructor(
    projectId: string,
    key: string,
    callbacks: PsdLayerEditorCallbacks,
  ) {
    this.projectId = projectId;
    this.key = key;
    this.callbacks = callbacks;

    this.status = h("div", { class: "psd-layers-status m" });
    this.list = h("div", { class: "psd-layer-list" });
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
      this.status,
      this.list,
      this.foot,
    );

    void this.load();
  }

  destroy(): void {
    this.endDrag(false);
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
      clear(this.foot);
      log.error(`Could not read the layers of ${this.key}.psd:`, err);
      this.setStatus("This PSD's layers could not be read.");
      return;
    }
    this.stack = stack;
    this.rows = stack.layers.map((source) => ({ source, name: source.name }));
    this.canvas.textContent =
      `${this.key}.psd · ${stack.width} × ${stack.height} canvas · ` +
      `${stack.layers.length} ${stack.layers.length === 1 ? "layer" : "layers"}`;
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
    for (const row of this.rows) this.list.appendChild(this.rowEl(row, stack));
    if (this.rows.length === 0) {
      this.list.appendChild(
        h("div", { class: "psd-layers-status m", text: "No layers." }),
      );
    }
    this.updateFoot();
  }

  private rowEl(row: Row, stack: PsdLayerList): HTMLElement {
    const owner = this.callbacks.ownerOf?.(row.source) ?? null;
    const el = h(
      "div",
      {
        class: `psd-layer-row ${row.source.category}${owner ? " owned" : ""}`,
        dataset: { index: String(row.source.index) },
      },
      stack.writable
        ? h(
            "button",
            {
              class: "psd-layer-grip",
              title: "Drag to reorder",
              "aria-label": `Reorder ${row.source.name}`,
              onPointerDown: (event: PointerEvent) => this.beginDrag(event),
              onKeyDown: (event: KeyboardEvent) => this.onGripKey(event, row),
            },
            icon(ICONS.grip, 14),
          )
        : h("div", { class: "psd-layer-grip" }),
      h(
        "div",
        { class: "psd-layer-main" },
        h("input", {
          class: "psd-layer-name",
          value: row.name,
          readonly: stack.writable && !owner ? null : "true",
          title: owner?.reason ?? null,
          onInput: (event: Event) => {
            row.name = (event.target as HTMLInputElement).value;
            this.updateFoot();
          },
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          },
        }),
        h("div", {
          class: "psd-layer-meta m",
          text: `${row.source.category} · ${row.source.width} × ${row.source.height}`,
        }),
      ),
      owner?.action
        ? h(
            "button",
            {
              class: "psd-layer-action",
              title: owner.action.label,
              "aria-label": owner.action.label,
              onClick: owner.action.run,
            },
            icon(owner.action.icon, 14),
          )
        : null,
    );
    return el;
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
            this.rows = stack.layers.map((source) => ({
              source,
              name: source.name,
            }));
            this.render();
          },
        }),
      ),
    );
  }

  /** Whether anything has been moved or retyped since the last read. */
  private get dirty(): boolean {
    return this.rows.some(
      (row, i) => row.source.index !== i || row.name.trim() !== row.source.name,
    );
  }

  // ── writing ───────────────────────────────────────────────────────────────

  private async apply(): Promise<void> {
    if (this.busy || !this.stack?.writable) return;

    const edits = this.rows.map((row) => ({
      index: row.source.index,
      name: row.name.trim(),
    }));
    if (edits.some((edit) => edit.name === "")) {
      log.warn("Every layer needs a name.");
      return;
    }

    this.busy = true;
    this.updateFoot();
    try {
      const manifest = await psd.writeLayers(this.projectId, this.key, edits);
      log.info(`Rewrote ${this.key}.psd — ${edits.length} layers`);
      this.callbacks.onWritten(manifest, this.renames());
      this.busy = false;
      // The indices every edit is named by have just moved, so the file is
      // read again rather than guessed at.
      await this.load();
    } catch (err) {
      log.error(`Could not rewrite ${this.key}.psd:`, err);
      this.busy = false;
      this.updateFoot();
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

  private onGripKey(event: KeyboardEvent, row: Row): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const from = this.rows.indexOf(row);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= this.rows.length) return;
    this.rows.splice(from, 1);
    this.rows.splice(to, 0, row);
    this.render();
    const moved = this.list.children[to];
    moved?.querySelector<HTMLElement>(".psd-layer-grip")?.focus();
  }

  /**
   * Follow the gesture on `window`: the row is moved through the list as the
   * pointer passes its neighbours, and a captured element that leaves the
   * document takes its capture with it.
   */
  private beginDrag(event: PointerEvent): void {
    const row = (event.currentTarget as HTMLElement).closest(".psd-layer-row");
    if (!(row instanceof HTMLElement) || this.drag) return;
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

    row.classList.add("dragging");
    this.list.classList.add("reordering");
    this.drag = {
      row,
      pointerId,
      release: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      },
    };
  }

  private dragTo(y: number): void {
    if (!this.drag) return;
    const { row } = this.drag;

    let before: HTMLElement | null = null;
    for (const sibling of this.list.children) {
      if (!(sibling instanceof HTMLElement) || sibling === row) continue;
      const box = sibling.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        before = sibling;
        break;
      }
    }
    if (before === row.nextElementSibling) return;
    this.list.insertBefore(row, before);
  }

  private endDrag(commit: boolean): void {
    if (!this.drag) return;
    const { row, release } = this.drag;
    this.drag = null;
    release();
    row.classList.remove("dragging");
    this.list.classList.remove("reordering");

    if (commit) this.takeDomOrder();
    // The names live in the inputs the DOM already holds, so only the
    // Apply row needs rebuilding.
    this.updateFoot();
    if (!commit) this.render();
  }

  /** Read the order back off the list the drag has just rearranged. */
  private takeDomOrder(): void {
    const order: Row[] = [];
    for (const el of this.list.children) {
      if (!(el instanceof HTMLElement)) continue;
      const index = Number(el.dataset.index);
      const row = this.rows.find((r) => r.source.index === index);
      if (row) order.push(row);
    }
    if (order.length === this.rows.length) this.rows = order;
  }
}

/**
 * The name psd-to-json will export a layer under — the second pipe segment,
 * which is what a placement's `layerPath` is made of. Null for a name the
 * parser ignores altogether.
 */
export function manifestName(layerName: string): string | null {
  const parts = layerName.split("|").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4) return null;
  return parts[1] || null;
}
