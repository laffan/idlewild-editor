/**
 * Keeping a PSD to Phaser project's scene files and its canvas in touch,
 * without either one owning the other.
 *
 * Draw is where artwork is made and the scene file is where the program says
 * where it goes. They are allowed to disagree — that is what it means for the
 * code to be yours — and this is everything that bridges them:
 *
 * - **Something placed in Draw is placed in the code, once** — a backdrop
 *   added to a background layer too, as Graphics. When the
 *   document is saved with a placement the session has not seen before, its
 *   lines are written after the last placing block of its scene's file — see
 *   `code/placement-code.ts` and `code/scene-code.ts`. A scene file with no
 *   placing block at all, opened in a project whose scene has placements, gets
 *   all of them. After that the lines are the author's: deleting them does not
 *   bring them back, and moving the thing on the canvas does not move them.
 * - **Where the two disagree, the sidebar says so.** A placed PSD, or a layer
 *   in one, whose `setPosition` is not where the canvas has it carries a reset
 *   in Code's directory, which writes the canvas's numbers into the call.
 * - **The caret in a `setPosition` or a `setScale` picks the sprite up.** The
 *   running game is told which sprite the call places, and outlines it;
 *   dragging it moves it, or scales it from its top-left corner, writes the
 *   numbers into the call as it goes and saves on release. See
 *   `templates/play/drag-bridge.js` for the other half.
 *
 * Every write is saved as it is made — through the code panel when the file
 * is open in it, so its undo history and its caret survive, and straight to
 * disk when it is not — and a save restarts a running game, so what was
 * changed is on screen.
 */

import { gameFiles } from "../lib/ipc";
import * as log from "../lib/log";
import { textureKey } from "../lib/manifest";
import { unitOf } from "../game/unit";
import type { DocStore } from "../lib/doc-store";
import type { Layer } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import {
  declaredNames,
  partsCode,
  sceneBackdrops,
  sceneLines,
  scenePieces,
  type BackdropPiece,
  type PlacedPiece,
  type PlacementSource,
} from "../code/placement-code";
import {
  appendPoint,
  matchBlocks,
  parseBlocks,
  callAtCaret,
  samePosition,
  withLines,
  withPosition,
  withScale,
} from "../code/scene-code";
import type { CodePanel } from "./code-panel";
import type { GameFrame } from "./game-frame";

export interface CodeSyncDeps {
  projectId: string;
  store: DocStore;
  code: CodePanel;
  gameFrame: GameFrame;
  scene: () => WorldScene | null;
  /** Redraw the sidebar, whose reset icons this decides. */
  redraw: () => void;
  /** Whether the editor is in Code, where the caret and the sidebar matter. */
  inCode: () => boolean;
}

export interface CodeSync {
  /** Whether a placed PSD's unit, or one layer of it, stands elsewhere in code. */
  diverged: (placementId: string, path?: string) => boolean;
  /** Write the canvas's position into the code, for a unit or one layer. */
  reset: (placementId: string, path?: string) => void;
  /** Read the open scene's file again — after anything that changed it. */
  refresh: () => void;
  destroy: () => void;
}

const CONFIG = "js/game.config.json";
const TARGET = "idlewild-drag-target";

export function createCodeSync(deps: CodeSyncDeps): CodeSync {
  const { store, code, gameFrame, projectId } = deps;
  const known = new Set(allPlacementIds(store));
  let started = false;
  let off = new Set<string>();
  let posted = "";
  let held: { name: string; kind: "position" | "scale" } | null = null;
  let queue: Promise<void> = Promise.resolve();
  let refreshTimer = 0;

  const source = (layers: readonly Layer[]): PlacementSource => ({
    layers,
    isometric: store.projection === "isometric",
    psdLayers: (key) => deps.scene()?.psdLayers(key) ?? [],
    colliders: store.colliders,
  });

  /** The scene file a scene is written in, from the config the editor keeps. */
  async function fileOf(sceneId: string): Promise<string | null> {
    try {
      const config = JSON.parse(await gameFiles.read(projectId, CONFIG)) as {
        scenes?: Array<{ id?: string; file?: string }>;
      };
      const file = config.scenes?.find((s) => s.id === sceneId)?.file;
      return file ? `js/scenes/${file}.js` : null;
    } catch {
      return null;
    }
  }

  async function read(path: string): Promise<string | null> {
    const open = code.editing;
    if (open?.path === path) return open.view.state.doc.toString();
    return gameFiles.read(projectId, path).catch(() => null);
  }

  /**
   * Change a file, one at a time and saved: through the panel when it has
   * the file open, so its history and caret survive, and on disk otherwise.
   */
  function edit(path: string, change: (text: string) => string | null): Promise<void> {
    queue = queue.then(async () => {
      const open = code.editing;
      if (open?.path === path) {
        if (!replaceIn(open.view, change(open.view.state.doc.toString()))) return;
        await code.save();
        return;
      }
      const text = await gameFiles.read(projectId, path).catch(() => null);
      const next = text === null ? null : change(text);
      if (next === null || next === text) return;
      await gameFiles.write(projectId, path, next);
      if (gameFrame.isRunning) gameFrame.reload();
    });
    return queue.catch((err) => log.error(`Could not update ${path}:`, err));
  }

  /** Lines for pieces, after the last placing block in a scene's file. */
  async function place(sceneId: string, pieces: PlacedPiece[], backdrops: BackdropPiece[]): Promise<void> {
    const path = await fileOf(sceneId);
    if (!path || pieces.length + backdrops.length === 0) return;
    await edit(path, (text) => {
      const point = appendPoint(text, parseBlocks(text));
      if (!point) return null;
      return withLines(text, point, partsCode(pieces, backdrops, declaredNames(text)));
    });
  }

  /** A scene file with nothing placed in it, in a scene with things placed. */
  async function fillEmpty(): Promise<void> {
    for (const scene of store.scenes) {
      const path = await fileOf(scene.id);
      const text = path && (await read(path));
      if (!path || !text || parseBlocks(text).length > 0) continue;
      const all = source(scene.layers);
      if (scenePieces(all).length === 0 && sceneBackdrops(all).length === 0) continue;
      // Written now, so not written again as new.
      idsOf(scene.layers).forEach((id) => known.add(id));
      await edit(path, (now) => {
        const point = appendPoint(now, parseBlocks(now));
        return point ? withLines(now, point, sceneLines(all, declaredNames(now))) : null;
      });
    }
  }

  /** Placements the session has not seen, written into their scenes' files. */
  async function placeNew(): Promise<void> {
    if (!started) {
      started = true;
      await fillEmpty();
    }
    for (const scene of store.scenes) {
      const fresh = new Set(idsOf(scene.layers).filter((id) => !known.has(id)));
      if (fresh.size === 0) continue;
      fresh.forEach((id) => known.add(id));
      const all = source(scene.layers);
      const pieces = scenePieces(all).filter((p) => fresh.has(p.placement.id));
      const backdrops = sceneBackdrops(all).filter((b) => fresh.has(b.background.id));
      await place(scene.id, pieces, backdrops);
    }
  }

  /** Which pieces of the open scene stand somewhere else in its file. */
  async function readStatus(): Promise<void> {
    const path = await fileOf(store.activeScene.id);
    const text = path ? await read(path) : null;
    const next = new Set<string>();
    if (text !== null) {
      const pieces = scenePieces(source(store.layers));
      matchBlocks(pieces, parseBlocks(text)).forEach((block, i) => {
        const piece = pieces[i];
        if (!block || samePosition(piece, block)) return;
        next.add(`${piece.placement.id}\u0000${piece.path}`);
        next.add(`unit:${unitOf(piece.placement)}`);
      });
    }
    const changed = next.size !== off.size || [...next].some((key) => !off.has(key));
    off = next;
    if (changed) deps.redraw();
  }

  const refresh = (): void => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      void readStatus();
      aim();
    }, 150);
  };

  // ── the caret, and the sprite it picks up ─────────────────────────────────

  /** Tell the game which sprite the caret's `setPosition` places, if any. */
  function aim(): void {
    const open = deps.inCode() ? code.editing : null;
    const at = open?.path.startsWith("js/scenes/")
      ? callAtCaret(parseBlocks(open.view.state.doc.toString()), open.view.state.selection.main.head)
      : null;
    // A backdrop's Graphics has no file behind it, so nothing to pick up.
    const block = at?.block.psdKey ? at.block : null;
    const where = block?.position;
    const scale = block?.scale;
    const ready =
      at?.kind === "scale"
        ? scale && scale.x !== null && scale.y !== null
        : where && where.x !== null && where.y !== null;
    // Found by where the block puts it; a scale is dragged from that corner.
    const message =
      block && ready
        ? {
            source: TARGET,
            texture: textureKey(block.psdKey, block.path),
            mode: at?.kind,
            x: where?.x ?? null,
            y: where?.y ?? null,
            uniform: scale?.uniform ?? true,
          }
        : { source: TARGET, texture: null };
    held = block && ready && at ? { name: block.name, kind: at.kind } : null;
    const key = JSON.stringify(message);
    if (key === posted) return;
    posted = key;
    gameFrame.post(message);
  }

  /** A sprite dragged in the game: its numbers, into the call being held. */
  gameFrame.onDragMessage = (data) => {
    if (data.source === "idlewild-drag-ready") {
      posted = "";
      aim();
      return;
    }
    const open = code.editing;
    const scaling = held?.kind === "scale";
    const x = Number(scaling ? data.sx : data.x);
    const y = Number(scaling ? data.sy : data.y);
    if (!open || !held || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const text = open.view.state.doc.toString();
    const name = held.name;
    const block = parseBlocks(text).find((b) => b.name === name);
    const call = scaling ? block?.scale : block?.position;
    if (!block || !call) return;
    const next = scaling ? withScale(text, block, x, y) : withPosition(text, block, x, y);
    replaceIn(open.view, next, call.argsFrom);
    if (data.phase === "end") void code.save().then(refresh);
  };

  let caretFrame = 0;
  const onSelection = () => {
    if (caretFrame || !code.contains(document.activeElement)) return;
    caretFrame = requestAnimationFrame(() => {
      caretFrame = 0;
      aim();
    });
  };
  const onKey = (event: Event) => {
    if (code.contains(event.target as Node)) refresh();
  };
  const onSaved = () => void placeNew().then(refresh);
  const onScene = () => refresh();
  document.addEventListener("selectionchange", onSelection);
  document.addEventListener("keyup", onKey, true);
  store.addEventListener("saved", onSaved);
  store.addEventListener("scene", onScene);

  return {
    diverged: (placementId, path) => {
      if (path !== undefined) return off.has(`${placementId}\u0000${path}`);
      const placement = store.layers.flatMap((l) => l.placements).find((p) => p.id === placementId);
      return !!placement && off.has(`unit:${unitOf(placement)}`);
    },
    reset: (placementId, path) => {
      void (async () => {
        const file = await fileOf(store.activeScene.id);
        if (!file) return;
        const pieces = scenePieces(source(store.layers));
        const placement = pieces.find((p) => p.placement.id === placementId)?.placement;
        if (!placement) return;
        await edit(file, (text) => {
          const blocks = matchBlocks(pieces, parseBlocks(text));
          // Back to front through the file, so each rewrite leaves the offsets
          // of the ones before it where they were.
          const work = pieces
            .map((piece, i) => ({ piece, block: blocks[i] }))
            .filter(({ piece, block }) =>
              block?.position &&
              unitOf(piece.placement) === unitOf(placement) &&
              (path === undefined || piece.path === path),
            )
            .sort((a, b) => (b.block?.start ?? 0) - (a.block?.start ?? 0));
          return work.reduce(
            (now, { piece, block }) => (block ? withPosition(now, block, piece.x, piece.y) : now),
            text,
          );
        });
        refresh();
      })();
    },
    refresh: () => {
      void placeNew().then(refresh);
    },
    destroy: () => {
      window.clearTimeout(refreshTimer);
      cancelAnimationFrame(caretFrame);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("keyup", onKey, true);
      store.removeEventListener("saved", onSaved);
      store.removeEventListener("scene", onScene);
      gameFrame.onDragMessage = null;
    },
  };
}

/** Every placement and backdrop a scene's layers hold, by id. */
function idsOf(layers: readonly Layer[]): string[] {
  return layers.flatMap((l) => [
    ...l.placements.map((p) => p.id),
    ...(l.backgrounds ?? []).map((b) => b.id),
  ]);
}

function allPlacementIds(store: DocStore): string[] {
  return store.scenes.flatMap((scene) => idsOf(scene.layers));
}

/**
 * Put `next` into an editor as the one change between it and what is there,
 * so the caret and the history move as little as they can. False when there
 * is nothing to change.
 */
function replaceIn(
  view: import("@codemirror/view").EditorView,
  next: string | null,
  caret?: number,
): boolean {
  const text = view.state.doc.toString();
  if (next === null || next === text) return false;
  let from = 0;
  while (from < text.length && from < next.length && text[from] === next[from]) from++;
  let end = 0;
  while (
    end < text.length - from &&
    end < next.length - from &&
    text[text.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  view.dispatch({
    changes: { from, to: text.length - end, insert: next.slice(from, next.length - end) },
    ...(caret !== undefined ? { selection: { anchor: caret } } : {}),
  });
  return true;
}
