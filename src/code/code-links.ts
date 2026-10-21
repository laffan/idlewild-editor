/**
 * Which blocks of a scene file the editor still answers for.
 *
 * The editor writes one block per piece of artwork — a placement's layer, or
 * a backdrop — when it is first placed (see `editor/code-sync.ts`), and that
 * block is **linked**: as long as its text is exactly what the editor last
 * wrote, the editor keeps it following Draw — position, scale, depth,
 * visibility — whether or not the code has been opened. The moment its text
 * is anything else, it was edited by hand and is **released**: from then on
 * every line of it is the author's, and the editor only says, in the
 * sidebar, that it no longer stands where Draw has it. Reset writes Draw's
 * values back into the lines the editor owns and links it again.
 *
 * Only the block the editor placed is ever linked. A second `place` of the
 * same layer — dragged in from the sidebar, or typed — is the author's from
 * the start, which is why a link is a record kept beside the code (by scene,
 * and by the `const` name it declares) rather than anything the code says
 * about itself.
 */

import type { PlaceBlock } from "./scene-code";

/** One linked — or released — block, by the piece it places. */
export interface LinkRecord {
  sceneId: string;
  /** The `const` the block declares, which is how it is found again. */
  name: string;
  /** What the editor last wrote, normalised — see `normalize`. */
  text: string;
  linked: boolean;
  /** The piece left the document and the editor took its block out. */
  removed?: boolean;
}

export type LinkRecords = Record<string, LinkRecord>;

/**
 * The methods whose lines the editor writes and keeps: everything else in a
 * block is somebody's own and survives a reset. A backdrop's are its fills.
 */
const MANAGED = new Set([
  "setPosition",
  "setScale",
  "setDepth",
  "setVisible",
  "fillStyle",
  "fillGradientStyle",
  "fillRect",
]);

/** A block's text with each line's indent taken off, for comparing. */
export function normalize(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

/** The block's own text, out of the file. */
export function blockText(text: string, block: PlaceBlock): string {
  return text.slice(block.start, block.end);
}

/** Which method a block's line calls on the block's name, or "decl" for its first. */
function methodOf(line: string, name: string, first: boolean): string {
  if (first) return "decl";
  const match = new RegExp(String.raw`^${name.replace(/\$/g, "\\$")}\.(\w+)\(`).exec(line.trim());
  return match ? match[1] : "";
}

/**
 * The file with a block's managed lines rewritten from `generated` — the
 * lines the editor would write for the piece now, under the block's name —
 * and every other line of the block left where it was. A managed line the
 * piece no longer needs (a scale back at 1) goes; one it newly needs goes in
 * after the block's last managed line.
 */
export function syncBlock(text: string, block: PlaceBlock, generated: readonly string[]): string {
  const want = new Map<string, string>();
  generated.forEach((line, i) => want.set(methodOf(line, block.name, i === 0), line));
  const lines = blockText(text, block).split("\n");
  const out: string[] = [];
  const used = new Set<string>();
  let lastManaged = 0;
  lines.forEach((line, i) => {
    const method = methodOf(line, block.name, i === 0);
    if (method !== "decl" && !MANAGED.has(method)) {
      out.push(line);
      return;
    }
    const next = want.get(method);
    if (next === undefined) return;
    used.add(method);
    out.push((i === 0 ? "" : block.indent) + next);
    lastManaged = out.length;
  });
  const missing = generated.filter((line, i) => !used.has(methodOf(line, block.name, i === 0)));
  out.splice(lastManaged, 0, ...missing.map((line) => block.indent + line));
  return text.slice(0, block.start) + out.join("\n") + text.slice(block.end);
}

/** Whether a block is still nothing but lines the editor writes. */
export function untouchedShape(text: string, block: PlaceBlock): boolean {
  return blockText(text, block)
    .split("\n")
    .every((line, i) => {
      const method = methodOf(line, block.name, i === 0);
      return method === "decl" || MANAGED.has(method);
    });
}

/** The file with a block's lines taken out, and the line break before them. */
export function withoutBlock(text: string, block: PlaceBlock): string {
  const from = text.lastIndexOf("\n", block.start - 1);
  return text.slice(0, from < 0 ? block.start : from) + text.slice(block.end);
}
