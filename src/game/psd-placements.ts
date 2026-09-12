/**
 * The scene's PSD side: registering a processed file with psd-to-phaser,
 * placing it, and keeping the document's placements in step with it.
 *
 * Split from the scene for the reason `drag.ts` was: it is a coherent job
 * with a narrow set of things it needs — the document, the grid, what is
 * rendered, and where the assets are served from — and the scene has several
 * jobs. Everything here is about one PSD key at a time.
 */

import type Phaser from "phaser";
import type PsdToPhaser from "psd-to-phaser";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { makeId } from "../lib/doc-store";
import { defaultCollider, placementsBox, unitOfKey } from "../lib/collider";
import {
  parseManifest,
  placeableLayers,
  placedPosition,
  stackOrder,
} from "../lib/manifest";
import type { Cell, Placement, Selection } from "../lib/types";
import * as log from "../lib/log";
import type { DocRenderer } from "./doc-renderer";
import { instanceOf } from "./instance";
import { evictPsd, loadPsd } from "./psd-loader";
import { reconcilePlacements } from "./reconcile";

/** What placing a PSD needs from the scene around it. */
export interface PsdHost {
  /** The Phaser scene the plugin loads textures into. */
  readonly scene: Phaser.Scene;
  readonly store: DocStore;
  readonly grid: Grid;
  readonly docRenderer: DocRenderer;
  /** Where this project's processed assets are served from. */
  readonly assetBase: string;
  /** The layer new work lands on. */
  readonly activeLayerId: string;
  setSelection(selection: Selection): void;
  /**
   * Push the current selection out again without changing it.
   *
   * A rename leaves the selection naming the same placement, but the
   * inspector reads that placement's key out of the document — so it has to
   * be told to look again now the document says something different.
   */
  reselect(): void;
  refresh(): void;
}

export class PsdPlacements {
  private readonly host: PsdHost;

  constructor(host: PsdHost) {
    this.host = host;
  }

  /**
   * Register a processed PSD with psd-to-phaser and place it.
   *
   * One placement per top-level manifest layer, each keeping its offset
   * within the PSD so a multi-layer document arrives as the composition its
   * author built. There is no "root" path — `place()` resolves by walking
   * the manifest's layers by name, so it must be given a real one.
   *
   * The PSD's `P | anchor` mark is what lands on the anchor cell. A file
   * without one falls back to its canvas centre, which is where an import
   * has always gone; a file with one keeps its position through the artist
   * resizing the canvas or moving the artwork inside it, because the mark
   * moves with them and the centre does not.
   *
   * `scale` is how big the artwork is displayed against its own pixels —
   * see `editor/import-anchor.ts` for why an import arrives at a half of it.
   *
   * Answers whether anything landed. A locked layer and a file with no
   * placeable layers are both refusals with nothing on the canvas to show for
   * them, and a caller that *consumes* something to make this call — a sketch
   * conversion, which takes the ink away — needs to know the difference
   * between that and a placement it can now see.
   */
  async place(
    key: string,
    manifestJson: string,
    at: Cell,
    scale = 1,
  ): Promise<boolean> {
    const layer = this.host.store.layer(this.host.activeLayerId);
    if (!layer || layer.locked) {
      log.warn("The active layer is locked");
      return false;
    }

    const manifest = parseManifest(manifestJson);
    const layers = placeableLayers(manifest);
    if (layers.length === 0) {
      log.warn(`${key}.psd has no placeable layers — check the naming convention`);
      return false;
    }

    const world = this.host.grid.cellToWorld(at);
    await this.load(key);

    // One drop is one undo step. A PSD with a background, a building and a
    // roof writes four times — one placement per layer, then the collider —
    // and a history that stepped back out of it a layer at a time would be a
    // history of the loop rather than of the drop.
    this.host.store.history.begin();
    try {
      // Everything this call places is one thing on the canvas. A PSD with a
      // background, a building and a roof was dropped once and should move
      // once; the layers are reachable individually through a double-tap.
      const instance = makeId("psd");

      // What the PSD says is on top of what. Kept on each placement because a
      // re-import can restack the file, and once a placement is in the
      // document nothing in it says which of two layers was above.
      const stack = stackOrder(manifest);

      let last: Placement | null = null;
      for (const entry of layers) {
        const width = entry.width || manifest.width;
        const height = entry.height || manifest.height;
        const at2 = placedPosition(world, manifest, entry, scale, scale);
        const placement = this.host.store.addPlacement(layer.id, {
          psdKey: key,
          layerPath: entry.path,
          x: at2.x,
          y: at2.y,
          width: width * scale,
          height: height * scale,
          // The size the manifest exported at, which the displayed size is
          // measured against — so a re-import can keep this scale.
          naturalWidth: width,
          naturalHeight: height,
          anchor: at,
          instance,
          order: stack.get(entry.path) ?? 0,
        });
        this.placeOne(layer.id, placement);
        last = placement;
      }

      // What the file blocks, before anyone has said otherwise. Written here
      // rather than left to be derived on demand so that everything reading
      // the document downstream — play mode, the export, the inspector —
      // reads one answer rather than three implementations of the same guess.
      this.syncCollider(key);

      if (last) {
        this.host.setSelection({
          kind: "placement",
          layerId: layer.id,
          placementId: last.id,
        });
      }
      return last !== null;
    } finally {
      this.host.store.history.end();
    }
  }

  /**
   * Write the default collider for a key, unless someone has edited it.
   *
   * An edited collider is an answer; a default is only a guess that has not
   * been corrected yet, so it is recomputed whenever the thing it was guessed
   * from changes — the artwork's footprint on a re-import, the solid's ground
   * on a second Apply.
   */
  private syncCollider(key: string): void {
    if (this.host.store.collider(key)?.edited) return;
    const unit = unitOfKey(this.host.store.allLayers, key);
    if (!unit) return;
    this.host.store.setCollider(
      key,
      defaultCollider(
        this.host.grid,
        unit.anchor,
        placementsBox(unit.placements),
        this.host.store.extrusion(key),
      ),
    );
  }

  /**
   * Swap in a re-imported PSD under the key it already had.
   *
   * Every cache holding the old file is dropped first — see `evictPsd` — and
   * the placements pointing at the key are brought in line with the new
   * manifest before anything is drawn, so an edit lands where the old
   * artwork was standing.
   *
   * `renames` is for the one edit that changes a layer's name rather than
   * its pixels: the inspector's layer list. It says which paths moved, so a
   * renamed layer is recognised rather than mourned.
   */
  async reload(
    key: string,
    manifestJson: string,
    renames?: ReadonlyMap<string, string>,
  ): Promise<void> {
    // Undo stops here. The file on disk is a different file now, so every
    // document state before this one names layers it may no longer have, and
    // a placement restored onto one can never render — see
    // `UndoHistory.clear`.
    this.host.store.history.clear();
    reconcilePlacements(
      this.host.store,
      this.host.grid,
      key,
      parseManifest(manifestJson),
      renames,
    );

    this.host.docRenderer.detachKey(key);
    evictPsd(this.host.scene, this.plugin(), key, this.otherPsdKeys(key));
    await this.load(key);

    for (const layer of this.host.store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey === key) this.placeOne(layer.id, placement);
      }
    }
    // The artwork has just changed shape, and a default collider is a
    // statement about the artwork — so it follows the file rather than
    // staying where the old one was.
    this.syncCollider(key);
    this.host.docRenderer.render();
  }

  /**
   * Move every placement on one PSD key over to another.
   *
   * The file behind the key has been renamed, not changed: the same bytes
   * under a new name, re-run through psd-to-json. So the geometry is left
   * exactly as it is — there is nothing to reconcile — and all this has to do
   * is take the rendered objects down, forget the caches under the *old* key,
   * rewrite the key on each placement, and load and place the new one.
   */
  async rename(from: string, to: string): Promise<void> {
    // And here, for the same reason: the file has moved, so a placement
    // restored to the old key points at nothing.
    this.host.store.history.clear();
    this.host.docRenderer.detachKey(from);
    evictPsd(this.host.scene, this.plugin(), from, this.otherPsdKeys(from));

    // Across every scene, not just the one on screen: a file is one file for
    // the project, and a placement in another scene left pointing at a key
    // that has gone can never render.
    this.host.store.updatePlacementsEverywhere((placement) => {
      if (placement.psdKey !== from) return null;
      // The layer inside the file is renamed with it when it was named after
      // it — every converted image, sketch and generated PSD is — and a
      // placement points at its layer by that name, so it follows. A layer
      // someone named in Photoshop is left alone at both ends.
      return placement.layerPath === from
        ? { psdKey: to, layerPath: to }
        : { psdKey: to };
    });

    // Only the open scene's are on the canvas to be redrawn; the rest are
    // placed from the document when their scene is next opened.
    const moved: Array<{ layerId: string; placement: Placement }> = [];
    for (const layer of this.host.store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey === to) moved.push({ layerId: layer.id, placement });
      }
    }

    // The solid an extrusion was rasterised from is keyed by the file, so it
    // moves with the file rather than being left pointing at a name that has
    // gone.
    this.host.store.copyExtrusion(from, to, false);
    // And what it blocks, which is keyed by the file for the same reason.
    this.host.store.copyCollider(from, to, false);

    await this.load(to);
    for (const { layerId, placement } of moved) this.placeOne(layerId, placement);
    this.host.docRenderer.render();

    // The selection still names a placement id, which has not changed — but
    // the inspector reads the key off the document, so it has to be told to
    // look again now the document says something different.
    this.host.reselect();
  }

  /**
   * Point one placement at a different PSD and redraw it.
   *
   * What breaking a reference does: the copy is byte-identical, so the
   * layer path and the geometry carry over untouched and only the key
   * changes. Everything else still reading the original is left alone,
   * which is the whole point of doing it per placement.
   */
  async repoint(
    selection: Extract<Selection, { kind: "placement" }>,
    key: string,
    manifestJson: string,
  ): Promise<void> {
    const placement = this.host.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (!placement) return;

    const manifest = parseManifest(manifestJson);
    const entry =
      manifest.all.find((l) => l.path === placement.layerPath) ??
      placeableLayers(manifest)[0];
    if (!entry) {
      log.warn(`${key}.psd has nothing matching ${placement.layerPath}`);
      return;
    }

    this.host.docRenderer.detachOne(placement.id);
    this.host.store.updatePlacement(selection.layerId, selection.placementId, {
      psdKey: key,
      layerPath: entry.path,
    });

    await this.load(key);
    const updated = this.host.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (updated) this.placeOne(selection.layerId, updated);
    this.host.docRenderer.render();
  }

  /**
   * Every other PSD the document has placed.
   *
   * `evictPsd` needs it because textures are keyed on layer *names*, which
   * two files can share — so a name still in use elsewhere must survive this
   * file being dropped.
   */
  private otherPsdKeys(key: string): string[] {
    const keys = new Set<string>();
    for (const layer of this.host.store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey !== key) keys.add(placement.psdKey);
      }
    }
    return [...keys];
  }

  private plugin(): PsdToPhaser | undefined {
    return (this.host.scene as unknown as Record<string, PsdToPhaser | undefined>).P2P;
  }

  private load(key: string): Promise<void> {
    return loadPsd(this.host.scene, this.plugin(), key, this.host.assetBase);
  }

  /** Draw one placement the document already holds. */
  placeOne(layerId: string, placement: Placement): void {
    const p2p = this.plugin();
    if (!p2p) return;
    try {
      const object = p2p.place(this.host.scene, placement.psdKey, placement.layerPath);
      this.host.docRenderer.attach(layerId, placement, object);
    } catch (err) {
      log.error(`Could not place ${placement.psdKey}:`, err);
    }
  }

  /**
   * Bring a document written by an earlier build up to date, on open.
   *
   * **Units.** Placements made before instances existed get one each. They
   * were made the way `placePsd` still makes them — one call per PSD, one
   * placement per layer, all on the same document layer — so grouping by
   * layer and key reconstructs what was placed together. An option-drag copy
   * of a multi-layer PSD joins its original's unit, which is the one case
   * this guesses wrong; a double-tap and a drag separates them, and the
   * alternative is every layer of every old project moving on its own.
   *
   * **Stacking.** Placements made before the PSD's own layer order was
   * recorded get it from the order they are in, which was the manifest's.
   *
   * **Colliders.** Every placed key that has no record gets the same default
   * a fresh import would: an extrusion blocks the spaces it stands on, and
   * anything else blocks the spaces its artwork covers. Done on open rather
   * than lazily, because a collider that appeared the first time something
   * asked for it would make a project play differently depending on what had
   * been looked at.
   */
  migrate(): void {
    // Not the user's edit, so not a step. An undo stack whose first entry is
    // "un-repair the document you just opened" is worse than no undo.
    this.host.store.history.silence(() => this.repair());
  }

  private repair(): void {
    for (const layer of this.host.store.layers) {
      const assigned = new Map<string, string>();
      for (const placement of layer.placements) {
        if (placement.instance) continue;
        let instance = assigned.get(placement.psdKey);
        if (!instance) {
          instance = makeId("psd");
          assigned.set(placement.psdKey, instance);
        }
        this.host.store.updatePlacement(layer.id, placement.id, { instance });
      }
    }

    // A document written before stacking was recorded has its placements in
    // the order they were made, which was the manifest's: top-first. So the
    // first of a unit was its top layer, and counting down from there is the
    // stack it should have had all along.
    for (const layer of this.host.store.layers) {
      const units = new Map<string, Placement[]>();
      for (const placement of layer.placements) {
        const unit = units.get(instanceOf(placement));
        if (unit) unit.push(placement);
        else units.set(instanceOf(placement), [placement]);
      }
      for (const unit of units.values()) {
        if (unit.every((p) => p.order !== undefined)) continue;
        unit.forEach((placement, index) => {
          this.host.store.updatePlacement(layer.id, placement.id, {
            order: unit.length - 1 - index,
          });
        });
      }
    }

    // Every scene's keys, not the open scene's: a PSD standing in a scene
    // nobody has looked at this session is still in the export, and a
    // collider nothing ever wrote is a file that blocks nothing there.
    const keys = new Set<string>();
    for (const layer of this.host.store.allLayers) {
      for (const placement of layer.placements) keys.add(placement.psdKey);
    }
    for (const key of keys) {
      if (!this.host.store.collider(key)) this.syncCollider(key);
    }
  }

  /** On open, bring back every placement the document already holds. */
  async loadAll(): Promise<void> {
    const keys = new Set<string>();
    for (const layer of this.host.store.layers) {
      for (const placement of layer.placements) keys.add(placement.psdKey);
    }
    for (const key of keys) {
      try {
        await this.load(key);
      } catch (err) {
        log.error(`Could not load ${key}:`, err);
      }
    }

    this.host.store.history.silence(() => {
      for (const layer of this.host.store.layers) {
        for (const placement of layer.placements) {
          this.placeOne(layer.id, this.migrateLayerPath(layer.id, placement));
        }
      }
    });
    this.host.refresh();
  }

  /**
   * Rewrite the placeholder path early builds wrote.
   *
   * Those saved `layerPath: "root"`, which psd-to-phaser resolves by looking
   * for a layer of that name and never finds — the placement came back as an
   * empty group. Repoint it at the PSD's first real top-level layer.
   */
  private migrateLayerPath(layerId: string, placement: Placement): Placement {
    if (placement.layerPath !== "root") return placement;

    const data = this.plugin()?.getData(placement.psdKey);
    const layers = (data?.original as { layers?: Array<{ name?: string }> })
      ?.layers;
    const name = layers?.[0]?.name;
    if (!name) {
      log.warn(`${placement.psdKey} has no top-level layer to place`);
      return placement;
    }

    log.info(`Repointed ${placement.psdKey} from "root" to "${name}"`);
    this.host.store.updatePlacement(layerId, placement.id, { layerPath: name });
    return { ...placement, layerPath: name };
  }
}
