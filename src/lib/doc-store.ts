/**
 * The live document, plus its autosave.
 *
 * Shapes are treated as immutable once stored — every mutation replaces the
 * object rather than writing through it. That is Hush's load-bearing
 * invariant, and the drawing engine's identity diff will depend on it when
 * the stroke port lands.
 */

import type {
  Cell,
  FillPatch,
  GameDoc,
  Layer,
  Placement,
  Projection,
  Stroke,
  Zone,
} from "./types";
import { doc as docIpc } from "./ipc";
import * as log from "./log";

const SAVE_DEBOUNCE_MS = 800;

let nextId = 0;
export function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
}

export class DocStore extends EventTarget {
  readonly projectId: string;
  private state: GameDoc;
  private saveTimer: number | null = null;
  private dirty = false;

  constructor(projectId: string, initial: GameDoc) {
    super();
    this.projectId = projectId;
    this.state = initial;
  }

  static async load(projectId: string): Promise<DocStore> {
    const body = await docIpc.read(projectId);
    const parsed = JSON.parse(body) as GameDoc;
    return new DocStore(projectId, parsed);
  }

  get doc(): GameDoc {
    return this.state;
  }

  get projection(): Projection {
    return this.state.projection;
  }

  get gridSize(): number {
    return this.state.gridSize;
  }

  /** Layers, top-first — the order the left panel shows them in. */
  get layers(): readonly Layer[] {
    return this.state.layers;
  }

  layer(id: string): Layer | undefined {
    return this.state.layers.find((l) => l.id === id);
  }

  // ── mutation ──────────────────────────────────────────────────────────────

  private commit(next: GameDoc): void {
    this.state = next;
    this.dirty = true;
    this.dispatchEvent(new CustomEvent("change"));
    this.scheduleSave();
  }

  private replaceLayer(layerId: string, update: (layer: Layer) => Layer): void {
    this.commit({
      ...this.state,
      layers: this.state.layers.map((l) => (l.id === layerId ? update(l) : l)),
    });
  }

  addLayer(name?: string): Layer {
    const layer: Layer = {
      id: makeId("layer"),
      name: name ?? `Layer ${this.state.layers.length + 1}`,
      locked: false,
      visible: true,
      fills: [],
      placements: [],
      zones: [],
      strokes: [],
    };
    this.commit({ ...this.state, layers: [layer, ...this.state.layers] });
    return layer;
  }

  removeLayer(layerId: string): void {
    if (this.state.layers.length <= 1) {
      log.warn("A project keeps at least one layer");
      return;
    }
    this.commit({
      ...this.state,
      layers: this.state.layers.filter((l) => l.id !== layerId),
    });
  }

  renameLayer(layerId: string, name: string): void {
    this.replaceLayer(layerId, (l) => ({ ...l, name }));
  }

  setLayerLocked(layerId: string, locked: boolean): void {
    this.replaceLayer(layerId, (l) => ({ ...l, locked }));
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.replaceLayer(layerId, (l) => ({ ...l, visible }));
  }

  /** Move a layer by `delta` places in the top-first list. */
  moveLayer(layerId: string, delta: number): void {
    const from = this.state.layers.findIndex((l) => l.id === layerId);
    if (from < 0) return;
    this.reorderLayer(layerId, from + delta);
  }

  /**
   * Move a layer to an absolute position in the top-first list — what a
   * drag releases against. Out-of-range indices are clamped rather than
   * refused, so a drag that overshoots the end of the list still lands.
   */
  reorderLayer(layerId: string, toIndex: number): void {
    const layers = [...this.state.layers];
    const from = layers.findIndex((l) => l.id === layerId);
    if (from < 0) return;
    const to = Math.max(0, Math.min(layers.length - 1, toIndex));
    if (to === from) return;
    const [moved] = layers.splice(from, 1);
    layers.splice(to, 0, moved);
    this.commit({ ...this.state, layers });
  }

  addFill(layerId: string, fill: Omit<FillPatch, "id">): FillPatch {
    const created: FillPatch = { ...fill, id: makeId("fill") };
    this.replaceLayer(layerId, (l) => ({ ...l, fills: [...l.fills, created] }));
    return created;
  }

  updateFill(layerId: string, fillId: string, patch: Partial<FillPatch>): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      fills: l.fills.map((f) => (f.id === fillId ? { ...f, ...patch } : f)),
    }));
  }

  removeFill(layerId: string, fillId: string): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      fills: l.fills.filter((f) => f.id !== fillId),
    }));
  }

  /** The fill covering a cell on a layer, if any. */
  fillAt(layerId: string, cell: Cell): FillPatch | undefined {
    return this.layer(layerId)?.fills.find((f) =>
      f.cells.some((c) => c.cx === cell.cx && c.cy === cell.cy),
    );
  }

  addPlacement(layerId: string, placement: Omit<Placement, "id">): Placement {
    const created: Placement = { ...placement, id: makeId("place") };
    this.replaceLayer(layerId, (l) => ({
      ...l,
      placements: [...l.placements, created],
    }));
    return created;
  }

  updatePlacement(
    layerId: string,
    placementId: string,
    patch: Partial<Placement>,
  ): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      placements: l.placements.map((p) =>
        p.id === placementId ? { ...p, ...patch } : p,
      ),
    }));
  }

  removePlacement(layerId: string, placementId: string): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      placements: l.placements.filter((p) => p.id !== placementId),
    }));
  }

  /** Replace a layer's strokes wholesale — how the drawing layer writes. */
  replaceStrokes(layerId: string, strokes: Stroke[]): void {
    this.replaceLayer(layerId, (l) => ({ ...l, strokes }));
  }

  addZone(layerId: string, zone: Omit<Zone, "id">): Zone {
    const created: Zone = { ...zone, id: makeId("zone") };
    this.replaceLayer(layerId, (l) => ({ ...l, zones: [...l.zones, created] }));
    return created;
  }

  removeZone(layerId: string, zoneId: string): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      zones: l.zones.filter((z) => z.id !== zoneId),
    }));
  }

  /** Camera position rides the document but must never mark it content-dirty
   *  on its own — a pan-only session should not queue a save storm. */
  setCamera(x: number, y: number, zoom: number): void {
    this.state = { ...this.state, camera: { x, y, zoom } };
    this.dirty = true;
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await docIpc.write(this.projectId, JSON.stringify(this.state));
    } catch (err) {
      this.dirty = true;
      log.error("Save failed:", err);
    }
  }

  /** Flush before navigating away, so nothing rides on the debounce. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }
}
