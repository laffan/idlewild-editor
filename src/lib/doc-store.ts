/**
 * The live document, plus its autosave.
 *
 * Shapes are treated as immutable once stored — every mutation replaces the
 * object rather than writing through it. That is Hush's load-bearing
 * invariant, and the drawing engine's identity diff will depend on it when
 * the stroke port lands.
 *
 * Layers hang off a **scene**, and every layer method here works on the
 * active one. That is deliberate: `layers` and `layer(id)` read the same as
 * they always did, so the scene, the panels and the renderers never had to
 * learn that scenes exist — switching scenes is this object answering
 * differently, not thirty call sites asking a new question.
 *
 * A switch fires `scene` as well as `change`. `change` means the document
 * moved; `scene` means everything on the canvas is now about somewhere else,
 * which is a redraw rather than a refresh — see `WorldScene.reloadScene`.
 */

import type {
  Cell,
  Collider,
  Extrusion,
  FillPatch,
  GameDoc,
  Genre,
  Layer,
  MapPoint,
  Placement,
  Projection,
  Scene,
  StoredDoc,
  Stroke,
  Zone,
} from "./types";
import { doc as docIpc } from "./ipc";
import { emptyLayer, copyLayer, makeId, withScenes } from "./doc-shape";
import * as log from "./log";

// Re-exported because they were this module's before `doc-shape.ts` was split
// out of it, and because the callers that mint ids — the drawing engine, the
// drag controller, the PSD placer — are asking the document for one rather
// than reaching for a utility.
export { makeId, withScenes };

const SAVE_DEBOUNCE_MS = 800;

export class DocStore extends EventTarget {
  readonly projectId: string;
  private state: GameDoc;
  private saveTimer: number | null = null;
  private dirty = false;

  constructor(projectId: string, initial: StoredDoc) {
    super();
    this.projectId = projectId;
    this.state = withScenes(initial);
  }

  static async load(projectId: string): Promise<DocStore> {
    const body = await docIpc.read(projectId);
    const parsed = JSON.parse(body) as StoredDoc;
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

  /** Top down unless the document says otherwise — see `Genre`. */
  get genre(): Genre {
    return this.state.genre ?? "topdown";
  }

  // ── scenes ────────────────────────────────────────────────────────────────

  get scenes(): readonly Scene[] {
    return this.state.scenes;
  }

  get activeSceneId(): string {
    return this.state.activeSceneId;
  }

  /**
   * The scene everything else means when it says "the document".
   *
   * Never undefined: `withScenes` guarantees at least one scene and an
   * `activeSceneId` that names one of them, so no caller has to hold an
   * opinion about a project with nowhere to draw.
   */
  get activeScene(): Scene {
    return (
      this.state.scenes.find((s) => s.id === this.state.activeSceneId) ??
      this.state.scenes[0]
    );
  }

  scene(id: string): Scene | undefined {
    return this.state.scenes.find((s) => s.id === id);
  }

  /** Look somewhere else. Fires `scene` after `change`, so a listener that
   *  redraws runs after one that re-reads. */
  setActiveScene(sceneId: string): void {
    if (sceneId === this.state.activeSceneId) return;
    if (!this.scene(sceneId)) return;
    this.commit({ ...this.state, activeSceneId: sceneId });
    this.dispatchEvent(new CustomEvent("scene"));
  }

  /** A new scene, with the one empty layer a project starts with, and open. */
  addScene(name?: string): Scene {
    const scene: Scene = {
      id: makeId("scene"),
      name: name ?? `Scene ${this.state.scenes.length + 1}`,
      layers: [emptyLayer("Terrain")],
    };
    this.commit({
      ...this.state,
      scenes: [...this.state.scenes, scene],
      activeSceneId: scene.id,
    });
    this.dispatchEvent(new CustomEvent("scene"));
    return scene;
  }

  renameScene(sceneId: string, name: string): void {
    this.replaceScene(sceneId, (scene) => ({ ...scene, name }));
  }

  /**
   * A copy, everything in it given ids of its own.
   *
   * Fresh ids rather than a structural clone, because ids are how the canvas
   * and the inspector name things: two scenes sharing a placement id would
   * be one rendered object that belongs to both, and switching between them
   * would show whichever was drawn last.
   */
  duplicateScene(sceneId: string): Scene | undefined {
    const source = this.scene(sceneId);
    if (!source) return undefined;
    const points = new Map<string, string>();
    const copy: Scene = {
      id: makeId("scene"),
      name: `${source.name} copy`,
      layers: source.layers.map((layer) => copyLayer(layer, points)),
      ...(source.camera ? { camera: source.camera } : {}),
      // Through the map, because the copy's points have ids of their own: an
      // untranslated id would leave the duplicate starting on the original's
      // point, which is in another scene entirely.
      ...(source.startPointId && points.has(source.startPointId)
        ? { startPointId: points.get(source.startPointId) }
        : {}),
    };
    const at = this.state.scenes.findIndex((s) => s.id === sceneId) + 1;
    const scenes = [...this.state.scenes];
    scenes.splice(at, 0, copy);
    this.commit({ ...this.state, scenes, activeSceneId: copy.id });
    this.dispatchEvent(new CustomEvent("scene"));
    return copy;
  }

  removeScene(sceneId: string): void {
    if (this.state.scenes.length <= 1) {
      log.warn("A project keeps at least one scene");
      return;
    }
    const scenes = this.state.scenes.filter((s) => s.id !== sceneId);
    const active =
      sceneId === this.state.activeSceneId ? scenes[0].id : this.state.activeSceneId;
    this.commit({ ...this.state, scenes, activeSceneId: active });
    this.dispatchEvent(new CustomEvent("scene"));
  }

  // ── layers, always the active scene's ─────────────────────────────────────

  /** Layers, top-first — the order the left panel shows them in. */
  get layers(): readonly Layer[] {
    return this.activeScene.layers;
  }

  layer(id: string): Layer | undefined {
    return this.activeScene.layers.find((l) => l.id === id);
  }

  // ── mutation ──────────────────────────────────────────────────────────────

  private commit(next: GameDoc): void {
    this.state = next;
    this.dirty = true;
    this.dispatchEvent(new CustomEvent("change"));
    this.scheduleSave();
  }

  private replaceScene(sceneId: string, update: (scene: Scene) => Scene): void {
    this.commit({
      ...this.state,
      scenes: this.state.scenes.map((s) => (s.id === sceneId ? update(s) : s)),
    });
  }

  /** Rewrite the active scene's layer list. Every layer edit lands here. */
  private replaceLayers(update: (layers: readonly Layer[]) => Layer[]): void {
    this.replaceScene(this.state.activeSceneId, (scene) => ({
      ...scene,
      layers: update(scene.layers),
    }));
  }

  private replaceLayer(layerId: string, update: (layer: Layer) => Layer): void {
    this.replaceLayers((layers) =>
      layers.map((l) => (l.id === layerId ? update(l) : l)),
    );
  }

  addLayer(name?: string): Layer {
    const layer = emptyLayer(`Layer ${this.layers.length + 1}`, name);
    this.replaceLayers((layers) => [layer, ...layers]);
    return layer;
  }

  removeLayer(layerId: string): void {
    if (this.layers.length <= 1) {
      log.warn("A scene keeps at least one layer");
      return;
    }
    // The scene's start point may be on the layer that is going. A dangling
    // id is a scene that says it starts somewhere that is not there, which
    // nothing downstream can report and the config would export as a spawn
    // at the origin without saying why.
    const doomed = this.layer(layerId);
    const orphaned = doomed?.points.some((p) => p.id === this.activeScene.startPointId);
    this.replaceLayers((layers) => layers.filter((l) => l.id !== layerId));
    if (orphaned) this.setStartPoint(null);
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
    const from = this.layers.findIndex((l) => l.id === layerId);
    if (from < 0) return;
    this.reorderLayer(layerId, from + delta);
  }

  /**
   * Move a layer to an absolute position in the top-first list — what a
   * drag releases against. Out-of-range indices are clamped rather than
   * refused, so a drag that overshoots the end of the list still lands.
   */
  reorderLayer(layerId: string, toIndex: number): void {
    const layers = [...this.layers];
    const from = layers.findIndex((l) => l.id === layerId);
    if (from < 0) return;
    const to = Math.max(0, Math.min(layers.length - 1, toIndex));
    if (to === from) return;
    const [moved] = layers.splice(from, 1);
    layers.splice(to, 0, moved);
    this.replaceLayers(() => layers);
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

  /**
   * The fill covering a cell on a layer, if any.
   *
   * A `rect` fill exists only on a project whose grid does not snap, and
   * there a cell *is* a world pixel — so its coordinates are the point to
   * test the rectangle against, with no projection in between.
   */
  fillAt(layerId: string, cell: Cell): FillPatch | undefined {
    return this.layer(layerId)?.fills.find((f) => {
      if (f.rect) {
        return (
          cell.cx >= f.rect.x &&
          cell.cx <= f.rect.x + f.rect.width &&
          cell.cy >= f.rect.y &&
          cell.cy <= f.rect.y + f.rect.height
        );
      }
      return f.cells.some((c) => c.cx === cell.cx && c.cy === cell.cy);
    });
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

  /**
   * Carry a placed PSD from one layer to another, keeping its geometry.
   *
   * A layer is draw order and visibility, not position — so the only thing
   * that changes is which list the records live in, and they land at the end
   * of the destination's, drawing over what was already there. That is what a
   * drop onto a layer means everywhere else in this editor.
   *
   * Every member of the unit goes, and the unit survives the trip. The panel
   * lists one row per placed *file* rather than one per layer inside it — the
   * two senses of the word are different things — so a drop is a statement
   * about the file, and a tower that arrived on Foreground as one thing has
   * to arrive on Background as one thing too.
   */
  movePlacements(
    fromLayerId: string,
    placementIds: readonly string[],
    toLayerId: string,
  ): void {
    if (fromLayerId === toLayerId) return;
    const carried = new Set(placementIds);
    const moving = this.layer(fromLayerId)?.placements.filter((p) =>
      carried.has(p.id),
    );
    if (!moving || moving.length === 0) return;

    this.replaceLayers((layers) =>
      layers.map((l) => {
        if (l.id === fromLayerId) {
          return { ...l, placements: l.placements.filter((p) => !carried.has(p.id)) };
        }
        if (l.id === toLayerId) {
          return { ...l, placements: [...l.placements, ...moving] };
        }
        return l;
      }),
    );
  }

  /**
   * Every layer, and every placement, in the project — scene by scene.
   *
   * PSDs are project-wide — `psd/` is one directory — so the questions about
   * them are too. "How many placements draw this layer?" is not a question
   * about the canvas you happen to be looking at, and neither is "what does
   * this file block", which is why a collider is worked out from these rather
   * than from the scene that happens to be open.
   */
  get allLayers(): Layer[] {
    return this.state.scenes.flatMap((scene) => scene.layers);
  }

  *everyPlacement(): Generator<{
    sceneId: string;
    layerId: string;
    placement: Placement;
  }> {
    for (const scene of this.state.scenes) {
      for (const layer of scene.layers) {
        for (const placement of layer.placements) {
          yield { sceneId: scene.id, layerId: layer.id, placement };
        }
      }
    }
  }

  /**
   * Patch placements across every scene, in one write.
   *
   * `claim` returns what to change about a placement, or null to leave it.
   * This is for the edits that are about a *file* rather than about a canvas:
   * a PSD renamed under the placement you can see is renamed under every
   * placement of it in every other scene too, and one left pointing at a key
   * that has gone can never render with nothing on screen to say why.
   */
  updatePlacementsEverywhere(
    claim: (placement: Placement) => Partial<Placement> | null,
  ): void {
    let touched = false;
    const scenes = this.state.scenes.map((scene) => ({
      ...scene,
      layers: scene.layers.map((layer) => ({
        ...layer,
        placements: layer.placements.map((placement) => {
          const patch = claim(placement);
          if (!patch) return placement;
          touched = true;
          return { ...placement, ...patch };
        }),
      })),
    }));
    if (touched) this.commit({ ...this.state, scenes });
  }

  removePlacement(layerId: string, placementId: string): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      placements: l.placements.filter((p) => p.id !== placementId),
    }));
  }

  // ── extrusions ────────────────────────────────────────────────────────────

  /** The solid an extruded PSD was rasterised from, if it still has one. */
  extrusion(key: string): Extrusion | undefined {
    return this.state.extrusions?.[key];
  }

  setExtrusion(key: string, extrusion: Extrusion): void {
    this.commit({
      ...this.state,
      extrusions: { ...this.state.extrusions, [key]: extrusion },
    });
  }

  /**
   * Forget the solid behind a key.
   *
   * Called when the file stops being the editor's own output — a re-import,
   * or a rewrite of its layer stack — because from then on the shape no
   * longer describes what is in the file, and re-applying it would throw
   * away whatever was put there instead.
   */
  removeExtrusion(key: string): void {
    if (!this.state.extrusions?.[key]) return;
    const { [key]: _gone, ...rest } = this.state.extrusions;
    this.commit({ ...this.state, extrusions: rest });
  }

  /** Carry the record with the file, when the file is renamed or copied. */
  copyExtrusion(from: string, to: string, keepOriginal = true): void {
    const held = this.state.extrusions?.[from];
    if (!held) return;
    const next = { ...this.state.extrusions, [to]: held };
    if (!keepOriginal) delete next[from];
    this.commit({ ...this.state, extrusions: next });
  }

  // ── colliders ─────────────────────────────────────────────────────────────

  /** What a placed PSD blocks, if the document has been told. */
  collider(key: string): Collider | undefined {
    return this.state.colliders?.[key];
  }

  get colliders(): Record<string, Collider> | undefined {
    return this.state.colliders;
  }

  setCollider(key: string, collider: Collider): void {
    this.commit({
      ...this.state,
      colliders: { ...this.state.colliders, [key]: collider },
    });
  }

  /**
   * Carry the record with the file, when the file is renamed or copied.
   *
   * A copy is a file of its own from here on — that is what breaking a
   * reference means — so it takes the collider the original had and the two
   * part company from then on.
   */
  copyCollider(from: string, to: string, keepOriginal = true): void {
    const held = this.state.colliders?.[from];
    if (!held) return;
    const next = { ...this.state.colliders, [to]: held };
    if (!keepOriginal) delete next[from];
    this.commit({ ...this.state, colliders: next });
  }

  /** Replace a layer's strokes wholesale — how the drawing layer writes. */
  replaceStrokes(layerId: string, strokes: Stroke[]): void {
    this.replaceLayer(layerId, (l) => ({ ...l, strokes }));
  }

  // ── points ────────────────────────────────────────────────────────────────

  /**
   * A named place on a layer.
   *
   * The name is worked out here rather than by the caller because it is a
   * fact about the whole scene: "Point 3" has to be the third one anywhere in
   * it, not the third on this layer, or two layers each get a Point 1 and the
   * game reads whichever it finds first.
   */
  addPoint(layerId: string, cell: Cell, name?: string): MapPoint {
    const created: MapPoint = {
      id: makeId("point"),
      name: name?.trim() || nextPointName(this.layers),
      cell,
    };
    this.replaceLayer(layerId, (l) => ({ ...l, points: [...l.points, created] }));
    return created;
  }

  updatePoint(layerId: string, pointId: string, patch: Partial<MapPoint>): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      points: l.points.map((p) => (p.id === pointId ? { ...p, ...patch } : p)),
    }));
  }

  removePoint(layerId: string, pointId: string): void {
    // Written as one commit rather than two: a point that was the scene's
    // start and a scene that still names it must never both be true, not even
    // for the one `change` event in between.
    this.replaceScene(this.state.activeSceneId, (scene) => ({
      ...scene,
      layers: scene.layers.map((l) =>
        l.id === layerId ? { ...l, points: l.points.filter((p) => p.id !== pointId) } : l,
      ),
      ...(scene.startPointId === pointId ? { startPointId: undefined } : {}),
    }));
  }

  /** The point play begins on in the open scene, if it has one. */
  get startPoint(): MapPoint | undefined {
    const id = this.activeScene.startPointId;
    if (!id) return undefined;
    for (const layer of this.layers) {
      const found = layer.points.find((p) => p.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Say where play begins in the open scene, or that it begins nowhere.
   *
   * One per scene, and that is enforced by *where this is stored* rather than
   * by clearing a flag on every other point: the scene holds one id, so
   * naming a second point is the first one ceasing to be it.
   */
  setStartPoint(pointId: string | null): void {
    this.replaceScene(this.state.activeSceneId, (scene) => ({
      ...scene,
      startPointId: pointId ?? undefined,
    }));
  }

  addZone(layerId: string, zone: Omit<Zone, "id">): Zone {
    const created: Zone = { ...zone, id: makeId("zone") };
    this.replaceLayer(layerId, (l) => ({ ...l, zones: [...l.zones, created] }));
    return created;
  }

  updateZone(layerId: string, zoneId: string, patch: Partial<Zone>): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      zones: l.zones.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)),
    }));
  }

  removeZone(layerId: string, zoneId: string): void {
    this.replaceLayer(layerId, (l) => ({
      ...l,
      zones: l.zones.filter((z) => z.id !== zoneId),
    }));
  }

  /**
   * Camera position rides the *scene* — a scene is a place, and coming back
   * to it should be coming back to where you were standing. It must never
   * mark the document content-dirty on its own, though: a pan-only session
   * should not queue a save storm, so this writes through rather than
   * committing.
   */
  setCamera(x: number, y: number, zoom: number): void {
    const activeId = this.state.activeSceneId;
    this.state = {
      ...this.state,
      scenes: this.state.scenes.map((s) =>
        s.id === activeId ? { ...s, camera: { x, y, zoom } } : s,
      ),
    };
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
      // Writing the document rewrites `game/js/game.config.json` behind it,
      // so anything showing that file is now a save behind — see
      // `store::sync_game_config` and the code modal's `refreshGenerated`.
      this.dispatchEvent(new CustomEvent("saved"));
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

/**
 * The next unclaimed "Point N" across the scene.
 *
 * Counting the points and adding one is not enough: delete Point 1 of two and
 * the next one made would be Point 2 again, and two points with one name is
 * the one thing a name is for avoiding. So it walks up from one until it
 * finds a name nothing is using.
 */
function nextPointName(layers: readonly Layer[]): string {
  const taken = new Set(layers.flatMap((l) => l.points.map((p) => p.name)));
  for (let n = 1; ; n++) {
    const name = `Point ${n}`;
    if (!taken.has(name)) return name;
  }
}
