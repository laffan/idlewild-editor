/**
 * Whether a pen is laying ink right now — for whoever has work it can put off
 * until it is not.
 *
 * The one who can is Phaser. Its loop renders the whole scene every animation
 * frame whether anything on it changed or not: the lattice and every other
 * `Graphics` object tessellated again, the batch rebuilt, the WebGL canvas
 * presented and composited. During a stroke nothing on it changes — the ink
 * is on its own canvases over it, and the document is written when the pen
 * comes up — so that frame is the main thread and the GPU spent on a picture
 * that is already on screen, in the same frames the pen is trying to draw in.
 * `game/boot.ts` sleeps the loop while this says a pen is down, and wakes it
 * when the stroke is over.
 *
 * Nothing goes stale while it sleeps. A finger landing mid-stroke ends the
 * stroke (two pointers are navigation, not drawing — see `DrawingLayer`), so
 * the camera never moves under a sleeping loop.
 *
 * Several drawing layers can say so at once — the scene's ink and the plan
 * are two — so it is a set of who is inking rather than a flag.
 */

type Listener = (inking: boolean) => void;

const inking = new Set<object>();
const listeners = new Set<Listener>();

/** `who` has started or stopped laying ink. Idempotent either way. */
export function setInking(who: object, on: boolean): void {
  const before = inking.size > 0;
  if (on) inking.add(who);
  else inking.delete(who);
  const after = inking.size > 0;
  if (before === after) return;
  for (const listener of listeners) listener(after);
}

/** Hear when the answer to "is anyone inking?" changes. Returns the unsubscribe. */
export function onInking(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
