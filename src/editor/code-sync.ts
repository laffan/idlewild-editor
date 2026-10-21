/**
 * Keeping a PSD to Phaser project's scene files and its canvas in touch,
 * without either one owning the other.
 *
 * Draw is where artwork is made and the scene file is where the program says
 * where it goes. This is everything that bridges them:
 *
 * - **The editor places, and keeps up, what it places.** Something placed in
 *   Draw — a placement's layers, a backdrop — is written into its scene's
 *   file as it is placed, and that block is **linked**: every save of the
 *   document rewrites its position, scale, depth and visibility from Draw,
 *   whether or not the code has ever been opened. Only that block: a second
 *   `place` of the same layer, dragged in or typed, is the author's from the
 *   start. See `code/code-links.ts` and `code/link-sync.ts`.
 * - **Editing a block by hand releases it.** Its lines are the author's from
 *   then on — to add to, take from or change — and Draw no longer moves it.
 *   Where it then stands somewhere other than Draw has it, Code's sidebar
 *   carries a reset, which writes Draw's values into the lines the editor
 *   writes and links the block again.
 * - **The caret in a `setPosition` or a `setScale` picks the sprite up.** The
 *   running game is told which sprite the call places, and outlines it;
 *   dragging it moves it, or scales it from its top-left corner, writes the
 *   numbers into the call as it goes and saves on release — which, being an
 *   edit, releases the block. See `templates/play/drag-bridge.js`.
 *
 * The links are kept beside `doc.json` (`read_code_links`), not in the code.
 * Every write is saved as it is made, through `code-edit.ts`.
 */

import { gameFiles, projects } from "../lib/ipc";
import * as log from "../lib/log";
import { textureKey } from "../lib/manifest";
import { unitOf } from "../game/unit";
import type { DocStore } from "../lib/doc-store";
import type { Layer, Selection } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import { sceneParts, type PlacementSource } from "../code/placement-code";
import type { LinkRecords } from "../code/code-links";
import { relink, syncScene } from "../code/link-sync";
import { renameKeyInCode, renameLayersInCode } from "../code/rename-refs";
import { parseBlocks, callAtCaret, withPosition, withScale } from "../code/scene-code";
import type { CodePanel } from "./code-panel";
import type { GameFrame } from "./game-frame";
import { renameInCode, type CodeRename } from "./code-renames";
import { createCodeEditor, replaceIn } from "./code-edit";
import { CodeMarks } from "./code-marks";
import type { Viewport } from "../drawing/viewport";

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
  /** The canvas, which carries a mark beside each piece that has gone its own way. */
  canvas: HTMLElement;
  /** Open the code at a line — Code, with the file at it. */
  openCode: (path: string, line: number) => void;
}

export interface CodeSync {
  /** Whether a placed PSD's unit, or one layer of it, was released and has moved off Draw. */
  diverged: (placementId: string, path?: string) => boolean;
  /** Write Draw's values into it, and link it again — a unit, or one layer. */
  reset: (placementId: string, path?: string) => void;
  /** Bring the scene files into line — after anything that changed either side. */
  refresh: () => void;
  /** Open the code where a placed PSD's unit, or one layer of it, is placed. */
  reveal: (placementId: string, path?: string) => void;
  /** The camera moved: the canvas's marks move with it. */
  sync: (view: Viewport) => void;
  /** What is selected on the canvas — the only units a mark is drawn beside. */
  select: (selection: Selection) => void;
  /**
   * A PSD or a layer was renamed: rename it in the code and in the links in
   * one step, so no pass in between reads a renamed block as a hand edit.
   */
  renamed: (rename: CodeRename) => Promise<void>;
  destroy: () => void;
}

const CONFIG = "js/game.config.json";
const TARGET = "idlewild-drag-target";

export function createCodeSync(deps: CodeSyncDeps): CodeSync {
  const { store, code, gameFrame, projectId } = deps;
  // What was in the document when the session began: anything else is new,
  // and placed in the code as it arrives.
  const known = new Set(allIds(store));
  let records: LinkRecords = {};
  let adopt = false;
  let saved = "";
  let off = new Set<string>();
  let posted = "";
  let held: { name: string; kind: "position" | "scale" } | null = null;
  let refreshTimer = 0;
  let selected = new Set<string>();
  let runs: Promise<void> = projects
    .codeLinks(projectId)
    .then((text) => {
      // None at all: a project from before links, whose blocks are adopted.
      adopt = text === null;
      records = text ? (JSON.parse(text) as LinkRecords) : {};
      saved = text ?? "";
    })
    .catch((err) => log.error("Could not read which code the editor keeps:", err));
  const { edit } = createCodeEditor({ projectId, code, gameFrame });
  const marks = new CodeMarks(deps.canvas, (placementId) => reveal(placementId));

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

  /** Bring scene files into line — every scene's, or only the open one's. */
  function run(every: boolean): Promise<void> {
    runs = runs.then(async () => {
      const scenes = every ? store.scenes : [store.activeScene];
      for (const scene of scenes) {
        const path = await fileOf(scene.id);
        if (!path) continue;
        const parts = sceneParts(source(scene.layers));
        let diverged = new Set<string>();
        await edit(path, (text) => {
          const result = syncScene({
            sceneId: scene.id,
            text,
            parts,
            records,
            adopt,
            fresh: (part) => !known.has(part.id),
          });
          diverged = result.diverged;
          return result.text;
        });
        if (scene.id === store.activeScene.id) showDiverged(diverged);
      }
      for (const id of allIds(store)) known.add(id);
      if (every) adopt = false;
      await persist();
    });
    return runs.catch((err) => log.error("Could not bring the code in line with Draw:", err));
  }

  async function persist(): Promise<void> {
    const text = JSON.stringify(records, null, 2);
    if (text === saved) return;
    saved = text;
    await projects.setCodeLinks(projectId, text);
  }

  /** Which units and layers carry a reset in the sidebar. */
  function showDiverged(keys: Set<string>): void {
    const next = new Set<string>();
    for (const part of sceneParts(source(store.layers))) {
      if (!keys.has(part.key) || !part.piece) continue;
      next.add(part.key);
      next.add(`unit:${unitOf(part.piece.placement)}`);
    }
    const changed = next.size !== off.size || [...next].some((key) => !off.has(key));
    off = next;
    if (changed) deps.redraw();
    placeMarks();
  }

  /**
   * A mark beside every selected unit of the open scene that has gone its own
   * way. Only the selected: on every one at once the marks would be noise over
   * the artwork, where the sidebar's row already says it for the rest.
   */
  function placeMarks(): void {
    const units = new Map<string, Array<{ id: string; x: number; y: number; width: number; height: number }>>();
    const picked = new Set<string>();
    for (const layer of store.layers) {
      for (const p of layer.placements) {
        const unit = unitOf(p);
        if (selected.has(p.id)) picked.add(unit);
        if (!off.has(`unit:${unit}`)) continue;
        const held = units.get(unit) ?? [];
        held.push(p);
        units.set(unit, held);
      }
    }
    for (const unit of [...units.keys()]) if (!picked.has(unit)) units.delete(unit);
    marks.set(
      [...units.values()].map((members) => {
        const left = Math.min(...members.map((p) => p.x));
        const top = Math.min(...members.map((p) => p.y));
        const right = Math.max(...members.map((p) => p.x + p.width));
        const bottom = Math.max(...members.map((p) => p.y + p.height));
        return {
          placementId: members[0].id,
          rect: { x: left, y: top, width: right - left, height: bottom - top },
        };
      }),
    );
  }

  /** The editor's block for a unit, or one layer of it: its file and line. */
  async function reveal(placementId: string, path?: string): Promise<void> {
    await runs;
    const parts = sceneParts(source(store.layers));
    const placement = parts.find((p) => p.id === placementId)?.piece?.placement;
    if (!placement) return;
    const part = parts.find(
      (p) =>
        p.piece &&
        records[p.key] &&
        unitOf(p.piece.placement) === unitOf(placement) &&
        (path === undefined || p.piece.path === path),
    );
    const record = part && records[part.key];
    const file = record && (await fileOf(record.sceneId));
    if (!record || !file) return;
    const open = code.editing;
    const text =
      open?.path === file ? open.view.state.doc.toString() : await gameFiles.read(projectId, file);
    const block = parseBlocks(text).find((b) => b.name === record.name);
    if (!block) return;
    deps.openCode(file, text.slice(0, block.start).split("\n").length);
  }

  const refresh = (): void => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      void run(false);
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
  const onSaved = () => void run(true);
  const onScene = () => refresh();
  const onChange = () => placeMarks();
  store.addEventListener("change", onChange);
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
      runs = runs.then(async () => {
        const file = await fileOf(store.activeScene.id);
        if (!file) return;
        const parts = sceneParts(source(store.layers));
        const placement = parts.find((p) => p.id === placementId)?.piece?.placement;
        if (!placement) return;
        const chosen = parts.filter(
          (part) =>
            part.piece &&
            unitOf(part.piece.placement) === unitOf(placement) &&
            (path === undefined || part.piece.path === path),
        );
        await edit(file, (text) => chosen.reduce((now, part) => relink(now, part, records), text));
        await persist();
      });
      refresh();
    },
    refresh: () => {
      void run(true).then(refresh);
    },
    reveal: (placementId, path) => void reveal(placementId, path),
    sync: (view) => marks.sync(view),
    select: (selection) => {
      selected = new Set(
        selection.kind === "placement"
          ? [selection.placementId]
          : selection.kind === "placements"
            ? selection.ids
            : [],
      );
      placeMarks();
    },
    renamed: (rename) => {
      runs = runs.then(async () => {
        await renameInCode({ projectId, code, gameFrame }, rename);
        const change = (text: string) =>
          rename.kind === "psd"
            ? renameKeyInCode(text, rename.from, rename.to, rename.layerNames)
            : renameLayersInCode(text, rename.key, rename.names);
        const next: LinkRecords = {};
        for (const [key, record] of Object.entries(records)) {
          next[rekey(key, rename)] = { ...record, text: change(record.text) };
        }
        records = next;
        await persist();
      });
      return runs;
    },
    destroy: () => {
      window.clearTimeout(refreshTimer);
      cancelAnimationFrame(caretFrame);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("keyup", onKey, true);
      store.removeEventListener("saved", onSaved);
      store.removeEventListener("scene", onScene);
      store.removeEventListener("change", onChange);
      marks.destroy();
      gameFrame.onDragMessage = null;
    },
  };
}

/** A link's key after a rename: a layer's path moves with its name. */
function rekey(key: string, rename: CodeRename): string {
  if (rename.kind !== "layers") return key;
  const [id, path] = key.split("\u0000");
  if (path === undefined) return key;
  return `${id}\u0000${path
    .split("/")
    .map((part) => rename.names.get(part) ?? part)
    .join("/")}`;
}

/** Every placement and backdrop in the document, by id. */
function allIds(store: DocStore): string[] {
  return store.scenes.flatMap((scene) =>
    scene.layers.flatMap((l) => [
      ...l.placements.map((p) => p.id),
      ...(l.backgrounds ?? []).map((b) => b.id),
    ]),
  );
}
