/**
 * The solid behind an extruded PSD, as functions over the store.
 *
 * These were four methods on `DocStore`, and they moved for the reason
 * `lib/layer-kinds.ts` was never in it: the store is about the *document* —
 * scenes, layers, and the edits every kind of thing shares — and what an
 * extrusion is, and when one stops describing the file it was rasterised
 * from, is a different question it has no opinion on. The seam was already
 * there; the seven-hundred-line rule is what made it worth taking.
 *
 * Everything here writes through `DocStore.editDoc`, so a commit is a commit:
 * undo sees these exactly as it sees a dragged placement.
 *
 * See `Docs/extrude.md` for what a solid is and why it outlives the artwork.
 */

import type { DocStore } from "./doc-store";
import type { Extrusion } from "./types";

/** The solid an extruded PSD was rasterised from, if it still has one. */
export function extrusionOf(
  store: DocStore,
  key: string,
): Extrusion | undefined {
  return store.doc.extrusions?.[key];
}

export function setExtrusion(
  store: DocStore,
  key: string,
  extrusion: Extrusion,
): void {
  store.editDoc((doc) => ({
    ...doc,
    extrusions: { ...doc.extrusions, [key]: extrusion },
  }));
}

/**
 * Forget the solid behind a key.
 *
 * Called when the file stops being the editor's own output — a re-import, or
 * a rewrite of its layer stack — because from then on the shape no longer
 * describes what is in the file, and re-applying it would throw away whatever
 * was put there instead.
 */
export function removeExtrusion(store: DocStore, key: string): void {
  if (!store.doc.extrusions?.[key]) return;
  store.editDoc((doc) => {
    const { [key]: _gone, ...rest } = doc.extrusions ?? {};
    return { ...doc, extrusions: rest };
  });
}

/** Carry the record with the file, when the file is renamed or copied. */
export function copyExtrusion(
  store: DocStore,
  from: string,
  to: string,
  keepOriginal = true,
): void {
  const held = store.doc.extrusions?.[from];
  if (!held) return;
  store.editDoc((doc) => {
    const next = { ...doc.extrusions, [to]: held };
    if (!keepOriginal) delete next[from];
    return { ...doc, extrusions: next };
  });
}
