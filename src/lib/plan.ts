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
 * Pictures dropped on it sit beside the strokes, in `Scene.planImages`.
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

/**
 * A picture dropped on the plan: reference to trace over, not artwork.
 *
 * It is not made into a PSD the way a picture dropped on the canvas is,
 * because it is not going anywhere — it is on no layer and in no export, like
 * the strokes beside it. So it is kept as it will be shown: baked once, when
 * it lands, to the plan's blue (`editor/plan-images.ts`), and held in the
 * document as a JPEG data URL. That is a few hundred kilobytes in the saved
 * file, and the price of a picture that saves, undoes and travels in an
 * `.idlewild` with the scene and needs nothing on disk beside it.
 *
 * Where it stands is world pixels, top-left, and how big it is shown — of
 * the rectangle before it is turned, so the four numbers stay a rectangle.
 */
export interface PlanImage {
  id: string;
  /** The baked picture: desaturated, tinted blue, as a `data:image/jpeg` URL. */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Turned about its middle, in radians, clockwise on screen. Absent is square. */
  rotation?: number;
  /** How much of it shows, 0–1, before the multiply. Absent is all of it. */
  opacity?: number;
}

const NO_IMAGES: readonly PlanImage[] = Object.freeze([]);

/** A scene's plan pictures, back to front. */
export function planImagesOf(scene: Scene | undefined): readonly PlanImage[] {
  return scene?.planImages ?? NO_IMAGES;
}

/** Whether a scene has anything planned on it. */
export function hasPlan(scene: Scene | undefined): boolean {
  return planOf(scene).length > 0 || planImagesOf(scene).length > 0;
}

/** Replace one scene's plan pictures, as one undoable edit. */
export function writePlanImages(
  store: DocStore,
  sceneId: string,
  images: readonly PlanImage[],
): void {
  store.editDoc((doc) => ({
    ...doc,
    scenes: doc.scenes.map((scene) => {
      if (scene.id !== sceneId) return scene;
      if (images.length > 0) return { ...scene, planImages: [...images] };
      const { planImages: _gone, ...rest } = scene;
      return rest;
    }),
  }));
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
