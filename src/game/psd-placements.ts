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
import type { ManifestLayer } from "../lib/manifest";
import {
  hasRootAnchor,
  manifestLayers,
  parseManifest,
  scopeKeys,
  textureKey,
  textureNeeds,
  placeableLayers,
  placedVisibility,
  stackOrder,
} from "../lib/manifest";
import {
  anchorOffset,
  offsetFromAnchor,
  placedPosition,
} from "../lib/placing";
import type { Cell, Placement, Selection } from "../lib/types";
import * as log from "../lib/log";
import type { DocRenderer } from "./doc-renderer";
import { unitMembers, unitOf } from "./unit";
import { migrateLayerPath, repairDocument } from "./psd-migrate";
import { evictPsd, loadPsd } from "./psd-loader";
import { reconcilePlacements } from "./reconcile";

/** What placing a PSD needs from the scene around it. */
export interface PsdHost {
  /** The Phaser scene the plugin loads textures into. */
  readonly scene: Phaser.Scene;
  readonly store: DocStore;
  readonly grid: Grid;
  readonly docRenderer: DocRenderer;
  /**
   * Let go of everything *else* on the canvas holding this file's textures.
   *
   * The doc renderer's own objects go through `detachKey`; this is for the
   * renderers that hold Phaser objects the document has no record of — a
   * pattern layer's copies, which are worked out from the camera. Evicting a
   * texture out from under one of those is a throw inside Phaser's renderer
   * on every frame afterwards, so every path that evicts has to call this
   * first. A new renderer that makes objects from a PSD hooks in here.
   */
  releaseKey(psdKey: string): void;
  /**
   * And the other end of it: the file is back, build from it again.
   *
   * Called however the rewrite ended, because a key held by a reload that
   * threw is a key nothing would ever draw again.
   */
  restoreKey(psdKey: string): void;
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
  /** Every PSD this scene places has loaded — see `WorldSceneConfig`. */
  onPsdsLoaded?(): void;
}

export class PsdPlacements {
  private readonly host: PsdHost;
  /**
   * Files being rewritten, which nothing may be placed from until they are
   * back — see `offline`.
   */
  private readonly held = new Set<string>();

  constructor(host: PsdHost) {
    this.host = host;
  }

  /**
   * Take a file off the canvas, do something to it, and put it back.
   *
   * Every rewrite — a re-parse, a rename, a repoint — is the same four steps
   * in the same order: take down what is standing on the file, evict its
   * textures, load the new ones, place again. Doing that by hand at three
   * call sites is how the fourth one forgets, and forgetting is not a blank
   * sprite: a Phaser object whose texture has been removed under it throws
   * `frame.source.resolution` of null inside the renderer, on every frame
   * from then on, and the pass dies part-way through.
   *
   * The window matters as much as the order. `held` is what makes it a
   * *window* rather than two moments: while a key is in it, nothing may make
   * an object from that file — not the pattern renderer on its frame loop,
   * and not the document renderer, which now asks for an object whenever the
   * document draws a placement the canvas has none of. Both go through
   * `canPlace`.
   *
   * `keys` is usually one. A rename holds both, because the copies on screen
   * were made under the old name and the new one is about to be loaded.
   */
  private async offline(keys: readonly string[], work: () => Promise<void>): Promise<void> {
    for (const key of keys) {
      this.held.add(key);
      this.host.docRenderer.detachKey(key);
      this.host.releaseKey(key);
    }
    try {
      await work();
    } finally {
      // However that went. A key left held is a key nothing draws again.
      for (const key of keys) {
        this.held.delete(key);
        this.host.restoreKey(key);
      }
    }
  }

  /**
   * Whether an object may be made from this file's layer, right now.
   *
   * Three questions, and the first two are not the same. `getData` says the
   * *manifest* parsed, which psd-to-phaser records the moment `data.json`
   * lands — several frames before any image does. The **textures** are what
   * its own `place` looks for, and missing one is what prints *Texture not
   * found for sprite*. And `held` is the third: an instant before an eviction
   * both the others say yes and the textures are about to go.
   *
   * Which textures those are is a question about the layer's *category*, not
   * about its name. A sprite wants one under its own name; a tileset wants
   * one per slice and nothing under its own name at all — so asking the
   * sprite question about a tileset answered no for ever, and a backdrop
   * painted in Photoshop came back to a canvas that never drew it. See
   * `textureNeeds`. A path the manifest does not know falls back to the leaf
   * name, which is the only thing that can be said about it.
   *
   * The names are then scoped to this PSD's key, because that is what the
   * plugin loads them under — see `textureKey`. Asking the unscoped question
   * was the same class of mistake as the two above: it answered *yes* about a
   * layer whose name another file happened to share.
   *
   * Handed to the pattern renderer as well, because the question is the same
   * one and the answer must not be able to differ.
   */
  canPlace(psdKey: string, layerPath: string): boolean {
    if (this.held.has(psdKey)) return false;
    const data = this.plugin()?.getData(psdKey) as
      | { original?: { layers?: unknown } }
      | undefined;
    if (!data) return false;
    const needs = textureNeeds(data.original?.layers, layerPath);
    const keys =
      needs.length > 0
        ? scopeKeys(psdKey, needs.flatMap((need) => need.keys))
        : [textureKey(psdKey, layerPath)];
    return keys.every((key) => this.host.scene.textures.exists(key));
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
    // The manifest parsed, and that is not the same as the file having
    // arrived: psd-to-phaser reads the store over HTTP and nothing else, so
    // a listener that has gone leaves every layer here placeable on paper and
    // nothing on the canvas. Placing anyway is what let a sketch conversion
    // report success, take the ink away, and leave the space empty — see
    // `editor/stroke-actions.ts`, which is counting on this answer.
    if (!this.plugin()?.getData(key)) {
      log.warn(
        `${key}.psd was written but could not be loaded — nothing placed. ` +
          "Its assets did not arrive; see the errors above.",
      );
      return false;
    }

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

      // Where the file's own `P | anchor` sits in its canvas. Each placement
      // keeps its offset from it, because that offset is the only thing that
      // can find the mark again once the placement has been resized — see
      // `Placement.fromAnchor`.
      const mark = anchorOffset(manifest);

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
          fromAnchor: offsetFromAnchor(mark, entry),
          instance,
          order: stack.get(entry.path) ?? 0,
          // What the file says is turned off, here and inside it.
          ...placedVisibility(manifest, entry.path),
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

    await this.offline([key], async () => {
      evictPsd(this.host.scene, this.plugin(), key, this.otherPsdKeys(key));
      await this.load(key);
      for (const layer of this.host.store.layers) {
        for (const placement of layer.placements) {
          if (placement.psdKey === key) this.placeOne(layer.id, placement);
        }
      }
    });

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

    // Both names, for the whole of it. The copies on screen were made under
    // the old one and the new one is about to be loaded — and the rewrite
    // below fires a document change, which is a repaint, which is the
    // renderer asking for an object for every placement it now draws and has
    // none of. Inside this bracket it is told no.
    await this.offline([from, to], async () => {
      evictPsd(this.host.scene, this.plugin(), from, this.otherPsdKeys(from));

      // Across every scene, not just the one on screen: a file is one file
      // for the project, and a placement in another scene left pointing at a
      // key that has gone can never render.
      this.host.store.updatePlacementsEverywhere((placement) => {
        if (placement.psdKey !== from) return null;
        // The layer inside the file is renamed with it when it was named
        // after it — every converted image, sketch and generated PSD is —
        // and a placement points at its layer by that name, so it follows. A
        // layer someone named in Photoshop is left alone at both ends.
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

      // The solid an extrusion was rasterised from is keyed by the file, so
      // it moves with the file rather than being left pointing at a name that
      // has gone.
      this.host.store.copyExtrusion(from, to, false);
      // And what it blocks, which is keyed by the file for the same reason.
      this.host.store.copyCollider(from, to, false);

      await this.load(to);
      for (const { layerId, placement } of moved) this.placeOne(layerId, placement);
    });
    this.host.docRenderer.render();

    // The selection still names a placement id, which has not changed — but
    // the inspector reads the key off the document, so it has to be told to
    // look again now the document says something different.
    this.host.reselect();
  }

  /**
   * Point one placed PSD at a different file and redraw it.
   *
   * What **Make Unique** does. The copy is byte-identical, so the layer paths
   * and the geometry carry over untouched and only the key changes; every other
   * instance goes on reading the original, which is the whole point of doing it
   * per object rather than per file.
   */
  async repoint(
    selection: Extract<Selection, { kind: "placement" }>,
    key: string,
    manifestJson: string,
  ): Promise<void> {
    const selected = this.host.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (!selected) return;

    // **The whole unit**, not the placement that happens to be selected. A PSD
    // with a wall and a roof in it stands on the grid as two placements, and
    // moving one of them to the copy left the other reading the original: Make
    // Unique reported success, the file on disk really was a second file, and
    // editing either one went on changing both pictures. Which of the two rows
    // you had selected decided which half came loose.
    const members = unitMembers(
      this.host.store.layers,
      selection.layerId,
      unitOf(selected),
    );

    const manifest = parseManifest(manifestJson);
    const fallback = placeableLayers(manifest)[0];
    const moves: Array<{ placement: Placement; path: string }> = [];
    for (const placement of members) {
      const entry =
        manifest.all.find((l) => l.path === placement.layerPath) ?? fallback;
      if (!entry) {
        log.warn(`${key}.psd has nothing matching ${placement.layerPath}`);
        continue;
      }
      moves.push({ placement, path: entry.path });
    }
    if (moves.length === 0) return;

    // The placements are about to point somewhere else, and on a pattern layer
    // a placement is a palette entry — so both files' copies are stale.
    const was = selected.psdKey;
    for (const { placement, path } of moves) {
      this.host.docRenderer.detachOne(placement.id);
      this.host.store.updatePlacement(selection.layerId, placement.id, {
        psdKey: key,
        layerPath: path,
      });
    }

    await this.offline([was, key], async () => {
      await this.load(key);
      const layer = this.host.store.layer(selection.layerId);
      for (const { placement } of moves) {
        const updated = layer?.placements.find((p) => p.id === placement.id);
        if (updated) this.placeOne(selection.layerId, updated);
      }
    });
    this.host.docRenderer.render();
    // The copy is a file of its own now, so what it blocks is its own record
    // rather than a second reader of the original's.
    this.syncCollider(key);
    // The inspector reads the key off the document, and the document says
    // something different about the same placement id.
    this.host.reselect();
  }

  /**
   * Every other PSD the document has placed.
   *
   * `evictPsd` needs it because a **mask** is keyed on the layer's name alone,
   * whichever way the file was loaded — so a masked layer whose name another
   * loaded file shares must survive this file being dropped. The artwork is
   * namespaced on the key and needs no such care.
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

  /**
   * Whether a loaded PSD has the anchor mark at the root of its stack.
   *
   * The rule an object layer enforces, answered from the plugin's own copy of
   * the manifest rather than from a field cached on the placement. A cache
   * would have to be kept in step with the file through a re-import, a
   * rewritten layer stack and a rename — three edits that can each take the
   * mark away — and a stale "anchored" is exactly the reassurance this is
   * here to withhold.
   *
   * A key that has not loaded answers **true**: the panel greys a row to say
   * a file is wrong, and saying so about a file nobody has read yet would put
   * the warning on every row for the first second of every session.
   */
  anchored(key: string): boolean {
    const data = this.plugin()?.getData(key);
    if (!data) return true;
    return hasRootAnchor((data.original as { layers?: unknown })?.layers);
  }

  /**
   * What is inside a loaded PSD, flattened and in the file's own order.
   *
   * Read off the plugin's copy of the manifest for the reason `anchored` is:
   * it is the one description of the file that is already in memory and
   * already kept in step with it, so there is nothing to cache and nothing to
   * go stale through a re-parse, a rewritten stack or a rename. A key nobody
   * has loaded answers with an empty list rather than with a guess.
   */
  layersOf(key: string): ManifestLayer[] {
    const data = this.plugin()?.getData(key);
    return data ? manifestLayers((data.original as { layers?: unknown })?.layers) : [];
  }

  private load(key: string): Promise<void> {
    return loadPsd(this.host.scene, this.plugin(), key, this.host.assetBase);
  }

  /**
   * Draw one placement the document already holds.
   *
   * Nothing to draw on a pattern layer: its placements are the palette a rule
   * scatters rather than things standing anywhere, and where the copies go is
   * `pattern-render.ts`'s answer. The renderer's own sweep would destroy an
   * object attached here on its next pass — it keys placements by id and
   * drops every one it no longer finds — so this is a flash of a heap of
   * elements on the anchor space rather than a leak, and not drawing it at
   * all is simply saying what is true.
   *
   * `DocRenderer.draws` is the one place that decision is made, so that the
   * two ends agree: a session that reveals a unit needs it *placed*, and
   * refusing here unconditionally is what left PSD Edit mode framing an empty box.
   */
  placeOne(layerId: string, placement: Placement): void {
    const p2p = this.plugin();
    if (!p2p) return;
    const layer = this.host.store.layer(layerId);
    if (layer && !this.host.docRenderer.draws(layer, placement)) return;
    // And nothing is asked of the plugin that it cannot answer. The renderer
    // asks for anything the document draws and the canvas lacks, and on open
    // that is every placement in the scene, several of them before their own
    // file has finished loading — `loadAll` places those itself once it has
    // them, and a rewrite in flight places its own on the way out.
    if (!this.canPlace(placement.psdKey, placement.layerPath)) return;
    try {
      const object = p2p.place(this.host.scene, placement.psdKey, placement.layerPath);
      this.host.docRenderer.attach(layerId, placement, object);
    } catch (err) {
      log.error(`Could not place ${placement.psdKey}:`, err);
    }
  }

  /**
   * Draw every placement of one unit, wherever in the open scene it lives.
   *
   * What revealing a unit on a pattern layer needs: the reveal says it may be
   * drawn, and this is what makes the objects, because on that layer nothing
   * ever has. `placeOne` still asks `draws`, so a unit that is not the
   * revealed one is refused here as everywhere else.
   */
  placeUnit(instance: string): void {
    for (const layer of this.host.store.layers) {
      for (const placement of layer.placements) {
        // Only what is missing. Re-placing something already on the canvas is
        // a fresh Phaser object for the same record, and the one it replaces
        // is only cleaned up because `attach` now destroys it — which is a
        // safety net rather than a plan.
        if (unitOf(placement) !== instance) continue;
        if (this.host.docRenderer.has(placement.id)) continue;
        this.placeOne(layer.id, placement);
      }
    }
    this.host.docRenderer.render();
  }

  /**
   * Bring a document written by an earlier build up to date, on open.
   *
   * The work is `psd-migrate.ts`; what is here is the one thing it needs from
   * this class — a default collider for a key that has none — and the promise
   * that none of it is an undo step. An undo stack whose first entry is
   * "un-repair the document you just opened" is worse than no undo.
   */
  migrate(): void {
    this.host.store.history.silence(() =>
      repairDocument(this.host.store, (key) => this.syncCollider(key)),
    );
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
          this.placeOne(
            layer.id,
            migrateLayerPath(
              this.host.store,
              this.plugin()?.getData(placement.psdKey),
              layer.id,
              placement,
            ),
          );
        }
      }
    });
    this.host.refresh();
    // And the panels, which ask the plugin rather than the document whether a
    // file carries its anchor mark. Nothing in the document moved here, so
    // the change event they normally listen to never fires.
    this.host.onPsdsLoaded?.();
  }
}
