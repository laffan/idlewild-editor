/**
 * MDN's web reference, as the docs panel reads it.
 *
 * Ported from phaser-bench's `web-docs.js`. `web-docs-index.json` is a
 * generated index over the markdown in `public/data/web-docs/`: a title, a
 * one-line description, a path and a page type per page, plus three maps from
 * the thing you would type to the page about it. The pages themselves are
 * fetched only when one is opened, because there are nearly three thousand of
 * them.
 *
 * **It follows the file being edited.** A caret in `index.html` asks about
 * HTML elements, one in `styles.css` about CSS properties, one in a `.js`
 * about JavaScript — so the source's own button changes its label as the
 * editor moves between them. Asking the CSS reference about `<canvas>` would
 * be a worse answer than none.
 */

import { esc, renderMarkdown } from "./markdown";
import { DOCS_BASE, type Detected, type DocsSource } from "./types";

/** One page, as the generated index carries it. */
interface WebEntry {
  /** title */
  t: string;
  /** description */
  d: string;
  /** path under `web-docs/` */
  p: string;
  /** language */
  l: Lang;
  /** MDN page type */
  y: string;
}

interface WebIndex {
  entries: WebEntry[];
  autoCSS: Record<string, number>;
  autoHTML: Record<string, number>;
  autoJS: Record<string, number>;
}

export type Lang = "javascript" | "css" | "html";

const LABELS: Record<Lang, string> = {
  javascript: "JavaScript",
  css: "CSS",
  html: "HTML",
};

/** How the topic browser groups a language's pages, in the order shown. */
const CATEGORIES: Record<Lang, Array<{ label: string; types: string[] }>> = {
  javascript: [
    { label: "Built-in objects", types: ["javascript-class", "javascript-namespace"] },
    { label: "Operators", types: ["javascript-operator"] },
    { label: "Statements", types: ["javascript-statement"] },
    { label: "Functions", types: ["javascript-function", "javascript-global-property"] },
    { label: "Errors", types: ["javascript-error"] },
    { label: "Guides", types: ["guide"] },
  ],
  css: [
    { label: "Properties", types: ["css-property", "css-shorthand-property"] },
    {
      label: "Selectors",
      types: ["css-selector", "css-pseudo-class", "css-pseudo-element", "css-combinator"],
    },
    { label: "At-rules", types: ["css-at-rule", "css-at-rule-descriptor"] },
    { label: "Functions", types: ["css-function"] },
    { label: "Types and keywords", types: ["css-type", "css-keyword", "css-media-feature"] },
    { label: "Guides", types: ["guide", "how-to"] },
  ],
  html: [
    { label: "Elements", types: ["html-element"] },
    { label: "Attributes", types: ["html-attribute", "html-attribute-value"] },
    { label: "Guides", types: ["guide", "how-to"] },
  ],
};

/** Classes whose methods win when two share a name — `map`, `filter`, `get`. */
const PREFERRED = [
  "Array", "Object", "String", "Promise", "Map", "Set", "Number", "Date",
  "RegExp", "JSON", "Math",
];

const MAX_RESULTS = 30;
const CACHE_MAX = 50;

let index: WebIndex | null = null;
let byLang: Partial<Record<Lang, WebEntry[]>> = {};
let methods: Record<string, string> | null = null;
let browsers: Partial<Record<Lang, string>> = {};
const pages = new Map<string, string>();

let lang: Lang = "javascript";

/** The language a path is written in, or null for anything else. */
export function langFromFile(filePath: string | null): Lang | null {
  if (!filePath) return null;
  if (filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) return "html";
  return null;
}

/** Point the reference at a language. True when that was a change. */
export function setLang(next: Lang): boolean {
  if (next === lang) return false;
  lang = next;
  return true;
}

/** What the source's own button says: JS, CSS, HTML. */
export function buttonLabel(): string {
  return lang === "javascript" ? "JS" : lang.toUpperCase();
}

export const webDocs: DocsSource = {
  cursorMode: true,

  async load() {
    if (index) return true;
    try {
      const response = await fetch(`${DOCS_BASE}/web-docs-index.json`);
      if (response.ok) index = (await response.json()) as WebIndex;
    } catch {
      index = null;
    }
    if (!index) return false;
    buildMethodMap(index);
    for (const key of ["javascript", "css", "html"] as Lang[]) {
      byLang[key] = index.entries.filter((entry) => entry.l === key);
    }
    return true;
  },

  searchPlaceholder: () => `Search the ${LABELS[lang]} reference…`,
  // Both empty states are the topic browser: with three thousand pages, the
  // useful thing to say is what kinds of page there are.
  emptyHTML: () => browser(),
  searchEmptyHTML: () => browser(),

  detectAutomatic(lineText, col, filePath): Detected | null {
    if (!index || !filePath) return null;
    const detected = langFromFile(filePath);
    if (!detected) return null;
    if (detected === "javascript") return detectJS(lineText, col);
    if (detected === "css") return detectCSS(lineText, col);
    return detectHTML(lineText, col);
  },

  search(query) {
    const entries = byLang[lang];
    if (!entries) return notLoaded();
    const q = query.trim().toLowerCase();
    if (!q) return browser();

    const hits: WebEntry[] = [];
    for (const entry of entries) {
      if (!`${entry.t} ${entry.d}`.toLowerCase().includes(q)) continue;
      hits.push(entry);
      if (hits.length >= MAX_RESULTS) break;
    }
    if (hits.length === 0) {
      return `<div class="docs-empty">No results for <kbd>${esc(q)}</kbd></div>`;
    }
    return hits
      .map(
        (entry) =>
          `<div class="docs-search-result web-doc-result" data-path="${esc(entry.p)}">` +
          `<div class="docs-search-result-name">${badge(entry.l)}${esc(entry.t)}</div>` +
          (entry.d ? `<div class="docs-search-result-desc">${esc(entry.d)}</div>` : "") +
          "</div>",
      )
      .join("\n");
  },

  resultAt(target) {
    const hit = target instanceof Element ? target.closest(".web-doc-result") : null;
    if (!(hit instanceof HTMLElement)) return null;
    return hit.dataset.path ? { path: hit.dataset.path } : null;
  },

  async fetchAndRender(path) {
    const markdown = await fetchPage(path);
    if (!markdown) {
      return '<div class="docs-empty">That page could not be read.</div>';
    }
    // MDN's own licence travels with what it wrote.
    return `${renderMarkdown(markdown)}<div class="docs-credit">From MDN Web Docs, CC BY-SA 2.5</div>`;
  },
};

function notLoaded(): string {
  return (
    '<div class="docs-empty">The web reference is not here. It is vendored into ' +
    "<kbd>public/data/web-docs/</kbd>.</div>"
  );
}

function badge(of: Lang): string {
  return `<span class="web-doc-badge web-doc-badge-${of}">${of === "javascript" ? "JS" : of.toUpperCase()}</span> `;
}

// ── What the caret is on ────────────────────────────────────────────────────

function summary(entry: WebEntry): string {
  return (
    '<div class="web-doc-summary">' +
    `<div class="docs-signature">${esc(entry.t)}</div>` +
    (entry.d ? `<div class="docs-desc">${esc(entry.d)}</div>` : "") +
    '<div class="web-doc-loading">Reading the full page…</div>' +
    "</div>"
  );
}

function found(map: Record<string, number>, key: string, kind: string): Detected | null {
  if (!index || map[key] === undefined) return null;
  const entry = index.entries[map[key]];
  return { html: summary(entry), key: `${kind}:${key}`, path: entry.p };
}

/**
 * JavaScript, in three passes.
 *
 * A capitalised dotted expression is a built-in and its member — `Array.from`
 * — and is tried whole before its head. A bare `.method` is an instance
 * method on something this cannot know the type of, which is what
 * `buildMethodMap` is for: it answers `map` with `Array.prototype.map`,
 * preferring the classes people mean when a name is shared.
 */
function detectJS(lineText: string, col: number): Detected | null {
  if (!index) return null;
  const before = lineText.slice(0, col);
  const suffix = lineText.slice(col).match(/^([\w$]*)/)?.[1] ?? "";

  const chain = before.match(/\b([A-Z][a-zA-Z]*(?:\.[a-zA-Z_$][\w$]*)*)$/);
  if (chain) {
    const whole = chain[1] + suffix;
    return (
      found(index.autoJS, whole, "js") ??
      found(index.autoJS, chain[1], "js") ??
      found(index.autoJS, whole.split(".")[0], "js") ??
      dotted()
    );
  }
  return dotted();

  function dotted(): Detected | null {
    const match = before.match(/\.([a-zA-Z_$][\w$]*)$/);
    if (match && index) {
      const name = match[1] + suffix;
      const hit =
        found(index.autoJS, name, "js") ??
        (methods?.[name] ? found(index.autoJS, methods[name], "js") : null);
      if (hit) return hit;
    }
    const word = before.match(/\b([A-Z][a-zA-Z_$][\w$]*)$/);
    return word && index ? found(index.autoJS, word[1] + suffix, "js") : null;
  }
}

function detectCSS(lineText: string, col: number): Detected | null {
  if (!index) return null;
  const before = lineText.slice(0, col);
  const suffix = lineText.slice(col).match(/^([\w-]*)/)?.[1] ?? "";

  const property = before.match(/([\w-]+)\s*:\s*$/) ?? before.match(/([\w-]+)$/);
  if (property) {
    const hit =
      found(index.autoCSS, property[1] + suffix, "css") ??
      found(index.autoCSS, property[1], "css");
    if (hit) return hit;
  }
  // A caret in a *value* still means the property it belongs to.
  const inValue = before.match(/([\w-]+)\s*:\s*[\w-]*$/);
  return inValue ? found(index.autoCSS, inValue[1], "css") : null;
}

function detectHTML(lineText: string, col: number): Detected | null {
  if (!index) return null;
  const before = lineText.slice(0, col);
  const suffix = lineText.slice(col).match(/^([\w-]*)/)?.[1] ?? "";

  const tag = before.match(/<\/?([\w-]+)\s*$/) ?? before.match(/<\/?([\w-]+)$/);
  if (tag) {
    const hit =
      found(index.autoHTML, tag[1] + suffix, "html") ??
      found(index.autoHTML, tag[1], "html");
    if (hit) return hit;
  }
  const attribute = before.match(/\s([\w-]+)\s*=?\s*$/) ?? before.match(/([\w-]+)$/);
  return attribute ? found(index.autoHTML, attribute[1], "html") : null;
}

/**
 * Bare method names to the page about them.
 *
 * `Array.prototype.map` and `Map.prototype.get` both end in a name somebody
 * might type after a dot, so a shared name goes to whichever class is more
 * likely to be meant rather than to whichever the index listed first.
 */
function buildMethodMap(loaded: WebIndex): void {
  methods = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(loaded.autoJS)) {
    const dot = key.lastIndexOf(".");
    if (dot < 0) continue;
    const name = key.slice(dot + 1);
    if (!name || name.endsWith("()")) continue;

    const owner = key.slice(0, dot).split(".")[0];
    const held = methods[name];
    if (!held) {
      methods[name] = key;
      continue;
    }
    const heldRank = PREFERRED.indexOf(held.split(".")[0]);
    const ownerRank = PREFERRED.indexOf(owner);
    if (ownerRank >= 0 && (heldRank < 0 || ownerRank < heldRank)) methods[name] = key;
  }
}

// ── The topic browser ───────────────────────────────────────────────────────

function browser(): string {
  const cached = browsers[lang];
  if (cached) return cached;
  const entries = byLang[lang];
  if (!entries) return notLoaded();

  const groups = CATEGORIES[lang];
  const sections = new Map<string, WebEntry[]>(groups.map((g) => [g.label, []]));
  for (const entry of entries) {
    const group = groups.find((g) => g.types.includes(entry.y));
    if (group) sections.get(group.label)?.push(entry);
  }

  const parts = ['<div class="docs-browser">'];
  for (const [label, list] of sections) {
    if (list.length === 0) continue;
    parts.push('<div class="docs-browser-section">');
    parts.push(`<div class="docs-browser-title">${esc(label)}</div>`);
    parts.push('<div class="docs-browser-items">');
    for (const entry of [...list].sort((a, b) => a.t.localeCompare(b.t))) {
      parts.push(
        `<div class="docs-browser-item web-doc-result" data-path="${esc(entry.p)}">` +
          `${esc(entry.t)}</div>`,
      );
    }
    parts.push("</div></div>");
  }
  parts.push("</div>");

  browsers[lang] = parts.join("\n");
  return browsers[lang] as string;
}

async function fetchPage(path: string): Promise<string | null> {
  const held = pages.get(path);
  if (held) return held;
  try {
    const response = await fetch(`${DOCS_BASE}/web-docs/${path}`);
    if (!response.ok) return null;
    const text = await response.text();
    if (pages.size >= CACHE_MAX) pages.delete(pages.keys().next().value as string);
    pages.set(path, text);
    return text;
  } catch {
    return null;
  }
}

/** Test seam: forget everything loaded, so a suite can load its own index. */
export function resetWebDocs(): void {
  index = null;
  byLang = {};
  methods = null;
  browsers = {};
  pages.clear();
  lang = "javascript";
}
