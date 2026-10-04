/**
 * What marks an object on the editor's canvas as the editor's own chrome
 * rather than canvas material — read by Include context's capture
 * (`context-capture.ts`). Its own file so `grid-renderer.ts` can name its
 * lattice without importing Phaser along with the capture.
 */

/** The name the lattice's graphics carry, so a capture can leave it out. */
export const CHROME_NAME = "idlewild:chrome";

/** At or above this depth an object is the editor's chrome. */
export const CHROME_DEPTH = 800_000;

/** Whether an object is canvas material a capture should draw. */
export function isMaterial(object: {
  visible?: boolean;
  alpha?: number;
  name?: string;
  depth?: number;
  scrollFactorX?: number;
  scrollFactorY?: number;
}): boolean {
  if (object.visible === false || object.alpha === 0) return false;
  if (object.name === CHROME_NAME) return false;
  if ((object.depth ?? 0) >= CHROME_DEPTH) return false;
  return (object.scrollFactorX ?? 1) === 1 && (object.scrollFactorY ?? 1) === 1;
}
