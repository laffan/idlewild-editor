/**
 * One scene file brought into line with its scene: the pass `code-sync.ts`
 * runs every time the document is saved, and as Code opens.
 *
 * In order, on the file's text:
 *
 * 1. **Released.** A linked block whose text is no longer what the editor
 *    wrote was edited by hand, and is released for good — reset is the only
 *    way back. One whose declaration has gone (deleted, or its `const`
 *    renamed) is released too: nothing of it is the editor's any more.
 * 2. **Adopted.** Only once per project, for the blocks a scene file had
 *    before links existed: each is matched to its piece by file, layer and
 *    order, and is linked if it is still nothing but lines the editor writes,
 *    released if not.
 * 3. **Placed.** A piece with no block of the editor's that is new this
 *    session — just placed in Draw — gets one, written after the last block,
 *    and linked. So does a piece whose linked block the editor took out when
 *    it left the document and that has come back (an undo).
 * 4. **Followed.** Every linked block's managed lines are rewritten from the
 *    piece as it is now: position, scale, depth, visibility; a backdrop's
 *    fills. Lines the editor does not write are never touched.
 * 5. **Taken out.** A linked block whose piece has left the document goes
 *    with it, and is remembered, so an undo puts it back.
 *
 * And what is left over is **diverged**: a released block whose managed
 * lines would change if it were linked again — what the sidebar's reset is
 * shown for.
 */

import {
  blockText,
  normalize,
  syncBlock,
  untouchedShape,
  withoutBlock,
  type LinkRecords,
} from "./code-links";
import { declaredNames, partName, type ScenePart } from "./placement-code";
import { appendPoint, parseBlocks, withLines, type PlaceBlock } from "./scene-code";

export interface SceneSyncInput {
  sceneId: string;
  text: string;
  parts: readonly ScenePart[];
  /** Every scene's records; this scene's are changed in place. */
  records: LinkRecords;
  /** Whether a piece is new since the session began — just placed. */
  fresh: (part: ScenePart) => boolean;
  /** Adopt blocks no record names — the first pass a project ever has. */
  adopt: boolean;
}

export interface SceneSync {
  text: string;
  /** Released blocks that no longer say what Draw does, by part key. */
  diverged: Set<string>;
}

export function syncScene(input: SceneSyncInput): SceneSync {
  const { sceneId, parts, records } = input;
  let text = input.text;
  const byKey = new Map(parts.map((part) => [part.key, part]));
  const mine = () =>
    Object.entries(records).filter(([, record]) => record.sceneId === sceneId);
  const find = (name: string): PlaceBlock | undefined =>
    parseBlocks(text).find((block) => block.name === name);

  // 1. Released.
  for (const [, record] of mine()) {
    if (!record.linked || record.removed) continue;
    const block = find(record.name);
    if (!block || normalize(blockText(text, block)) !== record.text) record.linked = false;
  }

  // 2. Adopted.
  const blocks = parseBlocks(text);
  const empty = blocks.length === 0;
  if (input.adopt && !empty) {
    const claimed = new Set(mine().map(([, record]) => record.name));
    const free = blocks.filter((block) => !claimed.has(block.name));
    for (const part of parts) {
      if (records[part.key]) continue;
      const shape = part.piece ? [part.piece.placement.psdKey, part.piece.path] : ["", ""];
      const at = free.findIndex((b) => b.psdKey === shape[0] && b.path === shape[1]);
      if (at < 0) continue;
      const [block] = free.splice(at, 1);
      records[part.key] = {
        sceneId,
        name: block.name,
        text: normalize(blockText(text, block)),
        linked: untouchedShape(text, block),
      };
    }
  }

  // 3. Placed — and put back.
  for (const part of parts) {
    const record = records[part.key];
    const back = record?.removed === true;
    if (record && !back) continue;
    if (!back && !input.fresh(part) && !(input.adopt && empty)) continue;
    const point = appendPoint(text, parseBlocks(text));
    if (!point) continue;
    const taken = declaredNames(text);
    const name = back && !taken.has(record.name) ? record.name : partName(part, taken);
    const lines = part.lines(name);
    text = withLines(text, point, lines);
    records[part.key] = { sceneId, name, text: normalize(lines.join("\n")), linked: true };
  }

  // 4. Followed, and 5. taken out.
  for (const [key, record] of mine()) {
    if (!record.linked || record.removed) continue;
    const block = find(record.name);
    if (!block) continue;
    const part = byKey.get(key);
    if (!part) {
      text = withoutBlock(text, block);
      record.removed = true;
      continue;
    }
    text = syncBlock(text, block, part.lines(record.name));
    const now = find(record.name);
    if (now) record.text = normalize(blockText(text, now));
  }

  // What is left over.
  const diverged = new Set<string>();
  for (const [key, record] of mine()) {
    if (record.linked || record.removed) continue;
    const part = byKey.get(key);
    const block = part && find(record.name);
    if (part && block && syncBlock(text, block, part.lines(record.name)) !== text) diverged.add(key);
  }
  return { text, diverged };
}

/** Link one released block again, with Draw's values written into it. */
export function relink(text: string, part: ScenePart, records: LinkRecords): string {
  const record = records[part.key];
  if (!record) return text;
  const block = parseBlocks(text).find((b) => b.name === record.name);
  if (!block) return text;
  const next = syncBlock(text, block, part.lines(record.name));
  const now = parseBlocks(next).find((b) => b.name === record.name);
  record.linked = true;
  record.removed = false;
  if (now) record.text = normalize(blockText(next, now));
  return next;
}
