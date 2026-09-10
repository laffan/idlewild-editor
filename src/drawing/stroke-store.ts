/**
 * The slim replacement for Hush's DrawingState: strokes, the layer they sit
 * on, and nothing else. It writes through to the game document so strokes
 * persist with the project and appear in the layer panel's counts.
 *
 * Strokes are immutable once stored — every mutation replaces the object.
 * The engine's sync shim diffs by identity, so an in-place write would make
 * it miss the change.
 */

import type { DocStore } from "../lib/doc-store";
import * as log from "../lib/log";
import { makeId } from "../lib/doc-store";
import type { Stroke } from "../lib/types";
import { DEFAULT_STYLE, type StrokeStyle } from "./types";

export class StrokeStore extends EventTarget {
  private readonly doc: DocStore;
  private layerId: string;
  style: StrokeStyle = { ...DEFAULT_STYLE };
  private selected = new Set<string>();

  constructor(doc: DocStore, layerId: string) {
    super();
    this.doc = doc;
    this.layerId = layerId;
  }

  setLayer(layerId: string): void {
    this.layerId = layerId;
    this.selected.clear();
    this.dispatchEvent(new CustomEvent("change"));
  }

  get strokes(): readonly Stroke[] {
    return this.doc.layer(this.layerId)?.strokes ?? [];
  }

  get selectedStrokes(): Stroke[] {
    return this.strokes.filter((s) => this.selected.has(s.id));
  }

  /** Replace the layer's strokes wholesale — how an erase drag commits. */
  replace(strokes: readonly Stroke[]): void {
    this.writeStrokes([...strokes]);
  }

  add(points: number[], style: StrokeStyle = this.style): Stroke {
    const stroke: Stroke = {
      id: makeId("stroke"),
      points,
      brushId: style.brushId,
      size: style.size,
      color: style.color,
      mode: style.mode,
      createdAt: Date.now(),
    };
    this.writeStrokes([...this.strokes, stroke]);
    return stroke;
  }

  remove(ids: Iterable<string>): void {
    const drop = new Set(ids);
    if (drop.size === 0) return;
    this.writeStrokes(this.strokes.filter((s) => !drop.has(s.id)));
    for (const id of drop) this.selected.delete(id);
  }

  select(ids: Iterable<string>): void {
    this.selected = new Set(ids);
    this.dispatchEvent(new CustomEvent("selection"));
  }

  clearSelection(): void {
    this.select([]);
  }

  /**
   * Strokes go into the document through the layer they belong to, so they
   * ride the same autosave as everything else.
   */
  private writeStrokes(next: Stroke[]): void {
    const layer = this.doc.layer(this.layerId);
    if (!layer) return;
    if (layer.locked) {
      // Silently dropping the stroke reads as the pencil being broken.
      log.warn(`${layer.name} is locked — unlock it to draw on it`);
      return;
    }
    this.doc.replaceStrokes(this.layerId, next);
    this.dispatchEvent(new CustomEvent("change"));
  }
}
