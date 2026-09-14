/**
 * The two libraries, and everything that reads them.
 *
 * One module to import from, because a panel that shows patterns almost
 * always also shows shapes — the TOOL zone's paint control offers both — and
 * three import lines to say so would be three import lines in every file.
 */

import { DEFAULT_PATTERNS } from "./pattern-defs";
import { DEFAULT_SHAPES } from "./shape-defs";
import { Library } from "./store";
import type { PatternDef, ShapeDef } from "./types";

export * from "./types";
export { DEFAULT_PATTERNS } from "./pattern-defs";
export { DEFAULT_SHAPES, BEZIER_CIRCLE } from "./shape-defs";
export { Library } from "./store";

/** Every pixel pattern this install has. */
export const patternLibrary = new Library<PatternDef>({
  storageKey: "idlewild.library.patterns",
  idPrefix: "pattern_",
  defaults: DEFAULT_PATTERNS,
});

/** Every vector shape this install has. */
export const shapeLibrary = new Library<ShapeDef>({
  storageKey: "idlewild.library.shapes",
  idPrefix: "shape_",
  defaults: DEFAULT_SHAPES,
});

/**
 * Hear about a change to either library.
 *
 * Both fire the same bare `change`, and almost every listener wants both —
 * the paint control redraws its whole palette either way. Returns the
 * unsubscribe, which is what every panel in this shell expects to be handed.
 */
export function onLibraryChange(listener: () => void): () => void {
  patternLibrary.addEventListener("change", listener);
  shapeLibrary.addEventListener("change", listener);
  return () => {
    patternLibrary.removeEventListener("change", listener);
    shapeLibrary.removeEventListener("change", listener);
  };
}
