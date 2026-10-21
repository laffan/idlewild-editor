/**
 * A PSD to Phaser scene file, read back: which of its lines place what, and
 * where each one says it stands.
 *
 * The scene is the author's, so nothing here assumes the editor wrote it. A
 * **block** is a declaration of the form `placement-code.ts` writes —
 *
 * ```js
 * const tree = this.P2P.place(this, "tree", "tree");
 * tree.setPosition(120, 80);
 * tree.setDepth(3);
 * ```
 *
 * — the `const` line and the run of `tree.` lines under it. That is enough to
 * say which file and layer a block places, where its `setPosition` puts it,
 * where new lines go after the last one, and whether the caret is in one.
 *
 * Blocks are matched to the document's pieces **by file and layer, in order**:
 * the second `place` of `tree`/`tree` in the file is the second tree in the
 * scene's draw order. There is no id in the code to match on, on purpose —
 * the file reads as psd-to-phaser code and nothing else — and the price is
 * that two of one file reordered on the canvas swap which line they answer to.
 */

import type { PlacedPiece } from "./placement-code";

export interface PlaceBlock {
  name: string;
  psdKey: string;
  path: string;
  /** Where the `const` line starts, and where the block's last line ends. */
  start: number;
  end: number;
  indent: string;
  /** The block's `setPosition`, if it has one. */
  position: PositionCall | null;
  /** Its `setScale`, if it has one. */
  scale: ScaleCall | null;
}

export interface PositionCall {
  /** The whole call, `tree.setPosition(…)`. */
  from: number;
  to: number;
  /** Just what is between the parentheses. */
  argsFrom: number;
  argsTo: number;
  /** Null where an argument is not a plain number. */
  x: number | null;
  y: number | null;
}

/** A `setScale(…)`: one argument for both axes, or one each. */
export interface ScaleCall extends PositionCall {
  uniform: boolean;
}

const STRING = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;
const DECLARATION = new RegExp(
  String.raw`(^[ \t]*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*this\.P2P\.place\(\s*this\s*,\s*` +
    STRING +
    String.raw`\s*,\s*` +
    STRING,
  "gm",
);

/** A backdrop's block, `const sky = this.add.graphics()…` — see `backdropCode`. */
const GRAPHICS = new RegExp(
  String.raw`(^[ \t]*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*this\.add\.graphics\(`,
  "gm",
);

/**
 * Every placing block in a file, in the order they are written — a backdrop's
 * Graphics among them, with no file or layer, so new lines go after it and a
 * scene holding only backdrops is not taken for one holding nothing.
 */
export function parseBlocks(text: string): PlaceBlock[] {
  const blocks: PlaceBlock[] = [];
  const add = (match: RegExpMatchArray, psdKey: string, path: string) => {
    const indent = match[1];
    const name = match[2];
    const start = (match.index ?? 0) + indent.length;
    const end = blockEnd(text, start, name);
    blocks.push({
      name,
      psdKey,
      path,
      start,
      end,
      indent,
      position: positionOf(callIn(text, name, "setPosition", start, end)),
      scale: scaleIn(text, name, start, end),
    });
  };
  for (const match of text.matchAll(DECLARATION)) add(match, unquote(match[3]), unquote(match[4]));
  for (const match of text.matchAll(GRAPHICS)) add(match, "", "");
  return blocks.sort((a, b) => a.start - b.start);
}

/** The end of the declaration's line and of every `name.` line under it. */
function blockEnd(text: string, start: number, name: string): number {
  let end = lineEnd(text, start);
  while (end < text.length) {
    const next = lineEnd(text, end + 1);
    if (!text.slice(end + 1, next).trimStart().startsWith(`${name}.`)) break;
    end = next;
  }
  return end;
}

function callIn(
  text: string,
  name: string,
  method: string,
  start: number,
  end: number,
): (PositionCall & { count: number }) | null {
  const call = new RegExp(String.raw`\b${escape(name)}\.${method}\(([^()]*)\)`, "g");
  call.lastIndex = start;
  const match = call.exec(text);
  if (!match || match.index >= end) return null;
  const argsFrom = match.index + match[0].indexOf("(") + 1;
  const parts = match[1].split(",");
  const read = (part: string | undefined) => {
    const value = part === undefined || part.trim() === "" ? NaN : Number(part.trim());
    return Number.isFinite(value) ? value : null;
  };
  return {
    from: match.index,
    to: match.index + match[0].length,
    argsFrom,
    argsTo: argsFrom + match[1].length,
    x: read(parts[0]),
    y: parts.length === 2 ? read(parts[1]) : parts.length === 1 ? read(parts[0]) : null,
    count: parts.length,
  };
}

/** A `setPosition` is two numbers; any other count is not a position. */
function positionOf(call: (PositionCall & { count: number }) | null): PositionCall | null {
  if (!call) return null;
  const { count, ...rest } = call;
  return count === 2 ? rest : { ...rest, x: null, y: null };
}

function scaleIn(text: string, name: string, start: number, end: number): ScaleCall | null {
  const call = callIn(text, name, "setScale", start, end);
  if (!call) return null;
  const { count, ...rest } = call;
  return { ...rest, uniform: count === 1 };
}

/**
 * The call the caret is inside — a block's `setPosition(…)` or its
 * `setScale(…)` — if any.
 */
export function callAtCaret(
  blocks: readonly PlaceBlock[],
  caret: number,
): { block: PlaceBlock; kind: "position" | "scale" } | null {
  for (const block of blocks) {
    if (block.position && caret >= block.position.from && caret <= block.position.to) {
      return { block, kind: "position" };
    }
    if (block.scale && caret >= block.scale.from && caret <= block.scale.to) {
      return { block, kind: "scale" };
    }
  }
  return null;
}

/** The file with a block's `setScale` arguments replaced, one or two as it had. */
export function withScale(text: string, block: PlaceBlock, x: number, y: number): string {
  const call = block.scale;
  if (!call) return text;
  const args = call.uniform ? num(x) : `${num(x)}, ${num(y)}`;
  return text.slice(0, call.argsFrom) + args + text.slice(call.argsTo);
}

/** The block whose `setPosition(…)` the caret is inside, if any. */
export function positionAtCaret(blocks: readonly PlaceBlock[], caret: number): PlaceBlock | null {
  return (
    blocks.find((b) => b.position && caret >= b.position.from && caret <= b.position.to) ??
    null
  );
}

/** The file with a block's `setPosition` arguments replaced. */
export function withPosition(text: string, block: PlaceBlock, x: number, y: number): string {
  const call = block.position;
  if (!call) return text;
  return text.slice(0, call.argsFrom) + `${num(x)}, ${num(y)}` + text.slice(call.argsTo);
}

/**
 * Where lines placing something new go: after the last block, or under the
 * scaffold's `// Place PSDs here.`, or at the top of `create`. Null for a file
 * with none of the three, which is somebody's own and is left alone.
 */
export function appendPoint(text: string, blocks: readonly PlaceBlock[]): { at: number; indent: string } | null {
  const last = [...blocks].sort((a, b) => b.end - a.end)[0];
  if (last) return { at: last.end, indent: last.indent };
  const comment = /^([ \t]*)\/\/ Place PSDs here\.[^\n]*$/m.exec(text);
  if (comment) return { at: comment.index + comment[0].length, indent: comment[1] };
  const create = /^([ \t]*)create\s*\([^)]*\)\s*\{[^\n]*$/m.exec(text);
  if (create) return { at: create.index + create[0].length, indent: `${create[1]}  ` };
  return null;
}

/** The file with `lines` written at a point, each on its own line. */
export function withLines(
  text: string,
  point: { at: number; indent: string },
  lines: readonly string[],
): string {
  const body = lines.map((line) => (line ? point.indent + line : line)).join("\n");
  return `${text.slice(0, point.at)}\n${body}${text.slice(point.at)}`;
}

/** Each piece's block, by file and layer in order, or undefined for none. */
export function matchBlocks(
  pieces: readonly PlacedPiece[],
  blocks: readonly PlaceBlock[],
): Array<PlaceBlock | undefined> {
  const queues = new Map<string, PlaceBlock[]>();
  for (const block of blocks) {
    const key = `${block.psdKey}\u0000${block.path}`;
    const queue = queues.get(key);
    if (queue) queue.push(block);
    else queues.set(key, [block]);
  }
  return pieces.map((piece) => queues.get(`${piece.placement.psdKey}\u0000${piece.path}`)?.shift());
}

/** Whether a block's `setPosition` says where the canvas has the piece. */
export function samePosition(piece: PlacedPiece, block: PlaceBlock): boolean {
  const call = block.position;
  if (!call || call.x === null || call.y === null) return false;
  return Math.abs(call.x - round(piece.x)) < 0.005 && Math.abs(call.y - round(piece.y)) < 0.005;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: number): string {
  return String(round(value));
}

function lineEnd(text: string, from: number): number {
  const at = text.indexOf("\n", from);
  return at < 0 ? text.length : at;
}

function unquote(literal: string): string {
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal) as string;
    } catch {
      return literal.slice(1, -1);
    }
  }
  return literal.slice(1, -1).replace(/\\(.)/g, "$1");
}

function escape(name: string): string {
  return name.replace(/\$/g, "\\$");
}
