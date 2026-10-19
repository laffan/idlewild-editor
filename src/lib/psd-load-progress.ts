/**
 * How far a project's PSDs have got on their way onto the canvas.
 *
 * Opening a project loads every file its scene places, one after another, and
 * a project with a few dozen large ones can take twenty seconds over it. The
 * canvas looks finished all the while — the grid, the fills and the ink are up
 * at once — so what is still missing reads as missing rather than as on its
 * way, and anything done to it in the meantime is done to half a canvas.
 *
 * The scene knows how far it has got and the editor's chrome is what says so,
 * and neither holds the other: this is the line between them. One editor is
 * open at a time (see **One game at a time** in `Docs/shell-and-runtime.md`),
 * so a module-level channel is the whole of it.
 */

export interface PsdLoadProgress {
  /** Files finished, failed ones included: a failure is not still loading. */
  done: number;
  /** Files this pass loads. Zero for a scene that places none. */
  total: number;
  /** The file being loaded now, or null once the pass is over. */
  key: string | null;
}

type Listener = (progress: PsdLoadProgress) => void;

const listeners = new Set<Listener>();
let latest: PsdLoadProgress = { done: 0, total: 0, key: null };

/** Whether a pass is still under way. */
export function loading(progress: PsdLoadProgress): boolean {
  return progress.total > 0 && progress.done < progress.total;
}

/** The scene's half: where the pass has got to. */
export function reportPsdLoad(progress: PsdLoadProgress): void {
  latest = { ...progress, done: Math.min(progress.done, progress.total) };
  for (const listener of listeners) listener(latest);
}

/**
 * The editor's half. Told at once where the pass stands, because the scene
 * can start loading before whatever is listening has been built.
 */
export function onPsdLoad(listener: Listener): () => void {
  listeners.add(listener);
  listener(latest);
  return () => listeners.delete(listener);
}

/**
 * Load each key in turn, saying how far it has got. Every key is counted
 * whether its load succeeds or not; the caller's `load` decides what a
 * failure means.
 */
export async function loadInTurn(
  keys: readonly string[],
  load: (key: string) => Promise<void>,
): Promise<void> {
  const total = keys.length;
  for (const [done, key] of keys.entries()) {
    reportPsdLoad({ done, total, key });
    await load(key);
  }
  reportPsdLoad({ done: total, total, key: null });
}
