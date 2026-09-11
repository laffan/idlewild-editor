/**
 * Which lines of a project file the editor owns, and which are the user's.
 *
 * The editor writes code into a project and the user edits that same code.
 * Without a rule, the two fight: the editor rewrites a function and takes a
 * hand-made change with it, or it stops rewriting and the code stops matching
 * the canvas. The rule here is that ownership is **per line**, not per file
 * and not per function.
 *
 * A scaffolded file marks its editor-owned runs with a pair of comments:
 *
 * ```js
 * // idlewild:begin placeDocument
 * placeDocument() { … }
 * // idlewild:end placeDocument
 * ```
 *
 * Inside that range, a line is the editor's if it is *still one of the lines
 * the scaffold wrote* — matched against the pristine template by a longest
 * common subsequence. Anything else between the markers was typed by the
 * user and stays theirs. So you can drop a `console.log` in the middle of
 * `placeDocument`, and that one line is yours to edit and delete while the
 * lines around it stay locked. The markers themselves are the editor's, which
 * is what stops the block being dissolved from the inside.
 *
 * A *generated* file has no markers because it has no room for comments and
 * nothing in it was written by hand: the whole file is the editor's, and
 * editing it would only be overwritten on the next save.
 *
 * Nothing here touches CodeMirror — `managed-view.ts` turns these answers
 * into decorations and a read-only filter, and this half is a pure function
 * of two strings so it can be tested as one.
 */

/** Files the editor writes end to end. Editing one is not a conversation. */
const GENERATED = new Set(["js/game.config.json"]);

const MARKER = /^\s*\/\/\s*idlewild:(begin|end)\s+([A-Za-z0-9_-]+)\s*$/;

/** Beyond this many lines a block is marked owned line-for-line instead of
 *  diffed — the quadratic table is not worth it, and no scaffold is this big. */
const DIFF_LIMIT = 600;

export interface ManagedBlock {
  id: string;
  /** 1-based and inclusive, counting the two marker lines. */
  from: number;
  to: number;
  /** Whether the scaffold still has a block of this id to put back. */
  resettable: boolean;
}

export interface Managed {
  /** True when the whole file is the editor's — see `GENERATED`. */
  generated: boolean;
  blocks: ManagedBlock[];
  /** 1-based line numbers the editor owns. */
  owned: Set<number>;
  /**
   * Blocks the scaffold has that this file does not.
   *
   * A project's `game/` tree is its own copy, so a template that gains a
   * block — as `WorldScene.js` did when the exported game learned to stack a
   * PSD the right way up — can never reach a project made before it. Reset
   * cannot help: there is nothing there to put back. So they are named here,
   * and `addMissingBlocks` puts them in.
   */
  missing: string[];
}

export function isGenerated(path: string): boolean {
  return GENERATED.has(path);
}

/**
 * Work out what the editor owns in `current`.
 *
 * `canonical` is the file as the scaffold wrote it, or null when the backend
 * has nothing to compare against — a file the user made, or one this
 * template does not write. With no canonical text there is nothing to call
 * editor-owned, so everything is the user's and no block offers a Reset.
 */
export function analyse(
  path: string,
  current: string,
  canonical: string | null,
): Managed {
  const lines = current.split("\n");

  if (isGenerated(path)) {
    const owned = new Set<number>();
    for (let i = 1; i <= lines.length; i++) owned.add(i);
    return {
      generated: true,
      owned,
      missing: [],
      blocks: [
        { id: path, from: 1, to: lines.length, resettable: canonical !== null },
      ],
    };
  }

  const here = findBlocks(lines);
  if (!canonical) {
    return {
      generated: false,
      owned: new Set(),
      missing: [],
      blocks: here.map((block) => ({ ...block, resettable: false })),
    };
  }

  const theirs = new Map(
    findBlocks(canonical.split("\n")).map((block) => [block.id, block]),
  );
  const canonicalLines = canonical.split("\n");
  const owned = new Set<number>();
  const blocks: ManagedBlock[] = [];

  for (const block of here) {
    const match = theirs.get(block.id);
    blocks.push({ ...block, resettable: match !== undefined });
    if (!match) continue;

    // The markers are the editor's whatever the diff says: they are the
    // block, and a block that can be unmarked from inside is not a block.
    owned.add(block.from);
    owned.add(block.to);

    const mine = lines.slice(block.from, block.to - 1);
    const pristine = canonicalLines.slice(match.from, match.to - 1);
    for (const offset of common(mine, pristine)) {
      owned.add(block.from + 1 + offset);
    }
  }

  const held = new Set(here.map((block) => block.id));
  const missing = [...theirs.keys()].filter((id) => !held.has(id));
  return { generated: false, owned, blocks, missing };
}

/**
 * Put the scaffold's blocks that this file lacks into it, and hand back the
 * whole file.
 *
 * Each lands where the scaffold has it *relative to the blocks this file
 * already has* — after the nearest one before it, or before the nearest one
 * after — so an added helper turns up beside the code that calls it rather
 * than at the end of the file. Returns null when there is nothing to add.
 */
export function addMissingBlocks(
  current: string,
  canonical: string,
): string | null {
  const canonicalBlocks = findBlocks(canonical.split("\n"));
  const canonicalLines = canonical.split("\n");
  let lines = current.split("\n");

  const absent = canonicalBlocks.filter(
    (block) => !findBlocks(lines).some((b) => b.id === block.id),
  );
  if (absent.length === 0) return null;

  // Front to back, so each insertion can see the ones already made and a run
  // of neighbouring blocks arrives in the order the scaffold has them.
  for (const block of absent) {
    const at = insertionFor(lines, canonicalBlocks, block);
    const text = canonicalLines.slice(block.from - 1, block.to);
    lines = [...lines.slice(0, at), "", ...text, ...lines.slice(at)];
  }
  return lines.join("\n");
}

/** The 0-based line to insert one absent block at. */
function insertionFor(
  lines: string[],
  canonicalBlocks: Array<Omit<ManagedBlock, "resettable">>,
  block: Omit<ManagedBlock, "resettable">,
): number {
  const here = findBlocks(lines);
  const at = canonicalBlocks.findIndex((b) => b.id === block.id);

  for (let i = at - 1; i >= 0; i--) {
    const before = here.find((b) => b.id === canonicalBlocks[i].id);
    if (before) return before.to;
  }
  for (let i = at + 1; i < canonicalBlocks.length; i++) {
    const after = here.find((b) => b.id === canonicalBlocks[i].id);
    if (after) return after.from - 1;
  }
  return lines.length;
}

/**
 * Put one block back the way the scaffold wrote it, and hand back the whole
 * file. Returns null when there is nothing to put back.
 *
 * A generated file resets wholesale, because it *is* one block — and for that
 * file the backend's "pristine" form is the document as it stands now rather
 * than the empty one a new project scaffolds with, so Reset there means
 * regenerate.
 */
export function resetBlock(
  path: string,
  current: string,
  canonical: string,
  id: string,
): string | null {
  if (isGenerated(path)) return canonical;

  const mine = findBlocks(current.split("\n")).find((b) => b.id === id);
  const theirs = findBlocks(canonical.split("\n")).find((b) => b.id === id);
  if (!mine || !theirs) return null;

  const lines = current.split("\n");
  const replacement = canonical.split("\n").slice(theirs.from - 1, theirs.to);
  return [
    ...lines.slice(0, mine.from - 1),
    ...replacement,
    ...lines.slice(mine.to),
  ].join("\n");
}

/**
 * The marked ranges in a list of lines.
 *
 * A begin with no end is not a block: an unclosed marker would otherwise lock
 * the whole rest of the file, which is the worst way to fail. Nesting is not a
 * thing — a begin inside an open block is ignored, so an id that appears twice
 * gives one block rather than an ambiguity.
 */
function findBlocks(lines: string[]): Array<Omit<ManagedBlock, "resettable">> {
  const blocks: Array<Omit<ManagedBlock, "resettable">> = [];
  let open: { id: string; from: number } | null = null;

  lines.forEach((line, index) => {
    const marker = MARKER.exec(line);
    if (!marker) return;
    const [, kind, id] = marker;
    if (kind === "begin") {
      if (!open) open = { id, from: index + 1 };
      return;
    }
    if (open && open.id === id) {
      blocks.push({ id, from: open.from, to: index + 1 });
      open = null;
    }
  });

  return blocks;
}

/**
 * The indices in `mine` that are part of a longest common subsequence with
 * `pristine` — the lines still there from the scaffold.
 *
 * A subsequence rather than a line-for-line comparison because that is the
 * whole point: inserting a line must not disown every line after it.
 */
function common(mine: string[], pristine: string[]): number[] {
  if (mine.length > DIFF_LIMIT || pristine.length > DIFF_LIMIT) {
    const kept: number[] = [];
    for (let i = 0; i < mine.length; i++) {
      if (mine[i] === pristine[i]) kept.push(i);
    }
    return kept;
  }

  const rows = mine.length;
  const cols = pristine.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] =
        mine[i] === pristine[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const kept: number[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (mine[i] === pristine[j]) {
      kept.push(i);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return kept;
}
