/**
 * A written guide with a table of contents: Phaser's concepts, and
 * psd-to-phaser's own docs.
 *
 * Ported from phaser-bench's `concepts-docs.js` and `p2p-docs.js`, which were
 * the same two hundred lines twice over — the same nav tree, the same
 * full-text search, the same fetch-and-render — differing only in where the
 * files are, what is in the tree, and whether MDX component tags have to come
 * off the top. So they are one factory here, called twice.
 *
 * Neither has a cursor mode. There is no expression in a file that means
 * "the page about cameras", so these are read and searched rather than
 * looked up, and the panel hides Automatic while one of them is up.
 *
 * Search is full text, over an index built in the background on load: the
 * files are forty-odd and small, and a title-only search over a set this
 * small answers "tilemap" with nothing at all.
 */

import { esc, renderMarkdown, stripComponents, stripFrontmatter } from "./markdown";
import { DOCS_BASE, type DocsSource, type Topic } from "./types";

const CACHE_MAX = 20;
const MAX_RESULTS = 30;

/** Words too common to say anything about which page is meant. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "is", "it", "be", "as", "do", "by", "if", "no", "not", "are", "was", "with",
  "that", "this", "from", "has", "have", "had", "will", "can", "its", "you",
  "your", "we", "our", "they", "them", "than", "so", "then", "also", "into",
  "about", "been", "each", "may", "all", "any", "some", "when", "what",
  "which", "who", "how", "more", "very", "just", "only", "other",
]);

export interface GuideOptions {
  /** Where the files are, under `public/data/`. */
  dir: string;
  /** The tree, top level first, each with its own children. */
  topics: Topic[];
  /** What the search field says. */
  placeholder: string;
  /** What to say with nothing selected. */
  empty: string;
  /** MDX carries component tags this cannot run, and frontmatter to drop. */
  mdx?: boolean;
}

export function createGuide(options: GuideOptions): DocsSource {
  const flat: Topic[] = [];
  for (const topic of options.topics) {
    flat.push(topic);
    if (topic.children) flat.push(...topic.children);
  }

  const pages = new Map<string, string>();
  let index: Array<{ topic: Topic; words: string[] }> | null = null;
  let indexing = false;

  const fetchPage = async (path: string): Promise<string | null> => {
    const held = pages.get(path);
    if (held) return held;
    try {
      const response = await fetch(`${DOCS_BASE}/${options.dir}/${path}`);
      if (!response.ok) return null;
      let text = await response.text();
      if (options.mdx) text = stripComponents(stripFrontmatter(text));
      if (pages.size >= CACHE_MAX) pages.delete(pages.keys().next().value as string);
      pages.set(path, text);
      return text;
    } catch {
      return null;
    }
  };

  /**
   * Read every page once and keep its words.
   *
   * Started on load and not waited for: a search that arrives before it is
   * finished falls back to titles, which is the same answer a moment early.
   */
  const buildIndex = async (): Promise<void> => {
    if (index || indexing) return;
    indexing = true;
    const built: Array<{ topic: Topic; words: string[] }> = [];
    for (const topic of flat) {
      const text = await fetchPage(topic.path);
      built.push({ topic, words: text ? terms(text) : [] });
    }
    index = built;
    indexing = false;
  };

  return {
    cursorMode: false,

    async load() {
      void buildIndex();
      return true;
    },

    searchPlaceholder: () => options.placeholder,
    emptyHTML: () => `<div class="docs-empty">${esc(options.empty)}</div>`,
    searchEmptyHTML: () => `<div class="docs-empty">${esc(options.placeholder)}</div>`,
    detectAutomatic: () => null,

    search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return `<div class="docs-empty">${esc(options.placeholder)}</div>`;

      const hits = rank(index ?? flat.map((topic) => ({ topic, words: [] })), q);
      if (hits.length === 0) {
        return `<div class="docs-empty">Nothing here about <kbd>${esc(query)}</kbd></div>`;
      }
      return hits
        .map(
          (topic) =>
            `<div class="docs-search-result docs-guide-result" data-path="${esc(topic.path)}">` +
            `<div class="docs-search-result-name">${esc(topic.title)}</div></div>`,
        )
        .join("\n");
    },

    resultAt(target) {
      const hit =
        target instanceof Element ? target.closest(".docs-guide-result") : null;
      if (!(hit instanceof HTMLElement)) return null;
      return hit.dataset.path ? { path: hit.dataset.path } : null;
    },

    navAt(target) {
      const item = target instanceof Element ? target.closest(".docs-nav-item") : null;
      return item instanceof HTMLElement ? item.dataset.path ?? null : null;
    },

    renderNav: (activePath) => renderNav(options.topics, activePath),

    async fetchAndRender(path) {
      const text = await fetchPage(path);
      if (!text) return '<div class="docs-empty">That page could not be read.</div>';
      return renderMarkdown(text);
    },
  };
}

/**
 * The table of contents.
 *
 * A top-level topic is a page in its own right *and* a folder of pages, so
 * its row opens its children as well as loading itself — which is how the
 * source tree reads and there is no second gesture to teach.
 */
export function renderNav(topics: Topic[], activePath: string | null): string {
  const parts = ['<div class="docs-nav-tree">'];
  for (const topic of topics) {
    const active = topic.path === activePath;
    const open =
      active || !!topic.children?.some((child) => child.path === activePath);
    const classes = [
      "docs-nav-item",
      active ? "active" : "",
      topic.children ? "has-children" : "",
      open ? "open" : "",
    ]
      .filter(Boolean)
      .join(" ");

    parts.push(
      `<div class="${classes}" data-path="${esc(topic.path)}">` +
        (topic.children ? '<span class="docs-nav-arrow">▶</span>' : "") +
        `${esc(topic.title)}</div>`,
    );

    if (!topic.children) continue;
    parts.push(`<div class="docs-nav-children${open ? " expanded" : ""}">`);
    for (const child of topic.children) {
      const childClasses =
        "docs-nav-item child" + (child.path === activePath ? " active" : "");
      parts.push(
        `<div class="${childClasses}" data-path="${esc(child.path)}">${esc(child.title)}</div>`,
      );
    }
    parts.push("</div>");
  }
  parts.push("</div>");
  return parts.join("\n");
}

/** Words worth indexing: two characters or more, and not a stop word. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(
    (word) => !STOP_WORDS.has(word),
  );
}

/**
 * Which pages a query means, best first.
 *
 * A title match outweighs everything — somebody typing "cameras" wants the
 * page called Cameras, not the twelve that mention one — and body matches
 * are capped per word so that one page repeating a term cannot bury a page
 * that is actually about it.
 */
export function rank(
  entries: Array<{ topic: Topic; words: string[] }>,
  query: string,
): Topic[] {
  const q = query.trim().toLowerCase();
  const tokens = terms(q);
  const scored: Array<{ topic: Topic; score: number }> = [];

  for (const { topic, words } of entries) {
    const title = topic.title.toLowerCase();
    let score = 0;

    if (title.includes(q)) score += 100;
    else for (const token of tokens) if (title.includes(token)) score += 40;

    for (const token of tokens) {
      let seen = 0;
      for (const word of words) {
        if (word.includes(token)) seen += 1;
        if (seen >= 10) break;
      }
      score += seen;
    }

    if (topic.path.toLowerCase().includes(q)) score += 5;
    if (score > 0) scored.push({ topic, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map((hit) => hit.topic);
}
