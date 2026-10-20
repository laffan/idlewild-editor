/**
 * A scene's plan: blue strokes over everything, part of nothing.
 *
 * Plan mode (`editor/plan-mode.ts`) is a sheet of tracing paper over the
 * scene — where the cave goes, which way the path runs, a note to yourself —
 * drawn with the same ink engine as everything else, but on no layer. So it
 * is not in a layer's counts, not in the strokes waiting to be converted, not
 * in what the game is sent and not on any page that prints. It lives on the
 * scene (`Scene.plan`), one list per scene, and is written through the
 * document like any other edit, so it saves with the project and undoes.
 */

import type { DocStore } from "./doc-store";
import type { Scene, Stroke } from "./types";

/** The colour a plan is drawn in, and the only one. */
export const PLAN_COLOR = "#0a84ff";

/**
 * How opaque the plan pencil's ink is. A little under full, so a plan stroke
 * crossing another — or the artwork under it — still lets it show through.
 * The alpha travels in the stroke's colour, as every colour's does here, and
 * is applied once to the finished stroke, so a stroke is evenly 90% rather
 * than darker where its stamps overlap.
 */
export const PLAN_INK_ALPHA = 0.9;

/**
 * No plan, as one list rather than a new empty one per ask: the ink engine
 * tells "nothing changed" from "redraw" by identity.
 */
const NONE: readonly Stroke[] = Object.freeze([]);

/** A scene's plan strokes, oldest first. */
export function planOf(scene: Scene | undefined): readonly Stroke[] {
  return scene?.plan ?? NONE;
}

/** Whether a scene has anything planned on it. */
export function hasPlan(scene: Scene | undefined): boolean {
  return planOf(scene).length > 0;
}

/** A scene with its plan replaced — and without the field once it is empty. */
export function withPlan(scene: Scene, strokes: readonly Stroke[]): Scene {
  if (strokes.length > 0) return { ...scene, plan: [...strokes] };
  const { plan: _gone, ...rest } = scene;
  return rest;
}

/** Replace one scene's plan, as one undoable edit. */
export function writePlan(store: DocStore, sceneId: string, strokes: readonly Stroke[]): void {
  store.editDoc((doc) => ({
    ...doc,
    scenes: doc.scenes.map((scene) => (scene.id === sceneId ? withPlan(scene, strokes) : scene)),
  }));
}

/** What the drawing layer reads and writes in plan mode: the open scene's plan. */
export function planSource(store: DocStore): {
  strokes(): readonly Stroke[];
  write(next: Stroke[]): void;
} {
  return {
    strokes: () => planOf(store.activeScene),
    write: (next) => writePlan(store, store.activeSceneId, next),
  };
}
