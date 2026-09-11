/**
 * The Phaser API, as the docs panel reads it.
 *
 * Ported from phaser-bench's `phaser-docs.js`. `phaser-docs.json` is JSDoc
 * pulled out of Phaser's own source and keyed by the expressions people
 * actually type — `this.add.`, `this.physics.add.`, `Phaser.Math.` — rather
 * than by class path, because what the caret is sitting in is an expression.
 *
 * The prefixes are matched longest-first, or `this.input.` would answer for
 * `this.input.keyboard.` and the wrong class would come up.
 */

import {
  renderClass,
  renderEmpty,
  renderHits,
  renderMember,
  type ApiDocs,
  type ApiHit,
} from "./api-render";
import { DOCS_BASE, type Detected, type DocsSource } from "./types";

const PREFIXES = [
  "this.physics.add.",
  "this.input.keyboard.",
  "this.cameras.main.",
  "this.tweens.",
  "this.scene.",
  "this.sound.",
  "this.anims.",
  "this.input.",
  "this.time.",
  "this.load.",
  "this.add.",
  "this.",
  "Phaser.Math.",
  "Phaser.Scale.",
  "Phaser.",
];

const MAX_RESULTS = 30;
const SEARCH_EMPTY = '<div class="docs-empty">Type to search the Phaser API.</div>';

let docs: ApiDocs | null = null;

export const phaserApi: DocsSource = {
  cursorMode: true,

  async load() {
    if (docs) return true;
    try {
      const response = await fetch(`${DOCS_BASE}/phaser-docs.json`);
      if (response.ok) docs = (await response.json()) as ApiDocs;
    } catch {
      docs = null;
    }
    return !!docs;
  },

  searchPlaceholder: () => "Search the Phaser API…",
  emptyHTML: () => renderEmpty(),
  searchEmptyHTML: () => SEARCH_EMPTY,

  /**
   * Only JavaScript files have Phaser in them, and a caret in `index.html`
   * asking about `this.add` would be answering a question nobody asked.
   */
  detectAutomatic(lineText, col, filePath): Detected | null {
    if (!filePath?.endsWith(".js")) return null;
    const lookup = lookupAt(lineText, col);
    if (!lookup) return null;
    return {
      key: `${lookup.prefix}:${lookup.member}`,
      html: render(lookup.prefix, lookup.member),
    };
  },

  search(query) {
    if (!docs) return notLoaded();
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_EMPTY;

    const hits: ApiHit[] = [];
    for (const [prefix, section] of Object.entries(docs)) {
      for (const [name, entry] of Object.entries(section.members)) {
        const shown = prefix === "gameobject" ? "." : prefix;
        if (!`${shown}${name} ${entry.desc ?? ""}`.toLowerCase().includes(q)) continue;
        hits.push({ prefix: shown, member: name, entry, className: section.className });
        if (hits.length >= MAX_RESULTS) break;
      }
      if (hits.length >= MAX_RESULTS) break;
    }
    return renderHits(hits, q);
  },

  resultAt(target) {
    const hit =
      target instanceof Element ? target.closest(".docs-search-result") : null;
    if (!(hit instanceof HTMLElement) || !docs) return null;

    const { prefix, member } = hit.dataset;
    if (!prefix || !member) return null;
    const section = docs[prefix === "." ? "gameobject" : prefix];
    if (!section?.members[member]) return null;
    return {
      html: renderMember(prefix, member, section.members[member], section.className),
    };
  },
};

function notLoaded(): string {
  return (
    '<div class="docs-empty">The Phaser reference is not here. It is vendored ' +
    `into <kbd>public/data/phaser-docs.json</kbd>.</div>`
  );
}

function render(prefix: string, member: string): string {
  if (!docs) return notLoaded();
  const section = docs[prefix];
  if (!section) return renderEmpty();
  if (member && section.members[member]) {
    return renderMember(prefix, member, section.members[member], section.className);
  }
  return renderClass(prefix, section);
}

/**
 * What expression the caret is in.
 *
 * The word under the caret is both halves of it — text before plus the rest
 * of the word after — so `setSc|ale` looks up `setScale` rather than
 * `setSc`. Where the caret has moved past a prefix's own member onto a
 * chained call, the trailing `.method` wins: in `this.clouds.setScale`,
 * `this.` matches but the caret is on a method of whatever `clouds` is, and
 * the generic game-object member is the better answer.
 */
export function lookupAt(
  lineText: string,
  col: number,
): { prefix: string; member: string } | null {
  const before = lineText.slice(0, col);
  const suffix = lineText.slice(col).match(/^([\w$]*)/)?.[1] ?? "";
  const dotted = before.match(/\.([a-zA-Z_$][\w$]*)$/);

  for (const prefix of PREFIXES) {
    const at = before.lastIndexOf(prefix);
    if (at < 0) continue;

    const member =
      lineText.slice(at + prefix.length).match(/^([a-zA-Z_$][\w$]*)/)?.[1] ?? "";
    const memberEnd = at + prefix.length + member.length;
    if (col > memberEnd && dotted) {
      return { prefix: "gameobject", member: dotted[1] + suffix };
    }
    return { prefix, member };
  }

  if (dotted) return { prefix: "gameobject", member: dotted[1] + suffix };
  return null;
}
