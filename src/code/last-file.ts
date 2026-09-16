/**
 * Which file the code panel opens with, and why it is usually the one you
 * were last in.
 *
 * The panel is built on the way into Code and destroyed on the way out — that
 * is what makes Code a section rather than a floating window — so without
 * something outside it holding the answer, every visit starts at whatever the
 * panel picks for a project it has never seen. Leaving Code to look at the
 * canvas and coming back is the commonest thing anyone does in this editor,
 * and having the file you were editing close itself behind you is the one
 * thing that made it feel like a modal.
 *
 * Remembered per **project** and per install, in `localStorage`, beside the
 * folds the file column keeps. A path means nothing across projects —
 * `js/prefabs/character.js` is a different file in each — so the map is keyed
 * by project id, and an entry whose file has since been renamed or deleted
 * simply loses: `opening` only answers with a path the listing still has.
 *
 * The fallback is deliberately **the scene**, not a fixed filename. It used to
 * be `js/scenes/WorldScene.js`, which was the one scene file a project had
 * when there was only ever one; a project scaffolded since is a file per scene
 * named after it, so that lookup found nothing and a new project opened into
 * an empty editor.
 */

import type { GameFile } from "../lib/ipc";

const KEY = "idlewild.code.lastFile";
/**
 * How many projects' answers are kept. The map is written whole, and a store
 * that grew a row per project ever opened would be a store nobody prunes —
 * the oldest answer is also the one least likely to be wanted.
 */
const LIMIT = 32;

/** The remembered file for a project, or null if there is not one. */
export function lastFile(projectId: string): string | null {
  const stored = readMap()[projectId];
  return typeof stored === "string" && stored ? stored : null;
}

/** Say which file is open now. Called on every open, including the first. */
export function rememberFile(projectId: string, path: string): void {
  const map = readMap();
  // Deleted first so the re-insert puts it at the end: the map's own order is
  // what `prune` reads as "oldest", and a re-opened project should not be the
  // next one dropped.
  delete map[projectId];
  map[projectId] = path;
  writeMap(prune(map));
}

/** The file went away, or the panel closed it. */
export function forgetFile(projectId: string): void {
  const map = readMap();
  if (!(projectId in map)) return;
  delete map[projectId];
  writeMap(map);
}

/**
 * Which file the panel should open into, given what the project actually has.
 *
 * In order: the remembered one, if the listing still has it as a file; the
 * project's first scene, because a scene is what the canvas beside this panel
 * is showing; `js/main.js`, which is the one file every project has and the
 * one that starts the game; then whatever is first. A project with no files at
 * all answers null, and the panel opens with no file — which is the honest
 * thing to show rather than an error about a file nobody asked for.
 */
export function opening(files: readonly GameFile[], remembered: string | null): string | null {
  const isFile = (path: string | null): path is string =>
    !!path && files.some((f) => !f.isDir && f.path === path);

  if (isFile(remembered)) return remembered;

  const scene = files.find(
    (f) =>
      !f.isDir &&
      f.path.startsWith("js/scenes/") &&
      f.path.endsWith(".js") &&
      // The generated list of scenes, which is a scene file's neighbour rather
      // than a scene: opening into it would be opening into a table of
      // contents nobody edits.
      f.path !== "js/scenes/index.js",
  );
  if (scene) return scene.path;

  if (isFile("js/main.js")) return "js/main.js";
  return files.find((f) => !f.isDir)?.path ?? null;
}

// ── the store ───────────────────────────────────────────────────────────────

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    // Unparseable, or a browser that refuses storage outright. Either way the
    // panel falls back to the scene, which is a working answer.
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Private browsing, or a quota. It still holds for this session, because
    // the panel asks again only after it has been taken down.
  }
}

/** Keep the most recent `LIMIT`, which is the tail of insertion order. */
function prune(map: Record<string, string>): Record<string, string> {
  const keys = Object.keys(map);
  if (keys.length <= LIMIT) return map;
  const kept: Record<string, string> = {};
  for (const key of keys.slice(keys.length - LIMIT)) kept[key] = map[key];
  return kept;
}
