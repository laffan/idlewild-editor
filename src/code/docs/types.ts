/**
 * What every docs source has to be able to answer.
 *
 * Four sources sit behind one panel — the Phaser API, MDN's web reference,
 * Phaser's concept guides and psd-to-phaser's own docs — and the panel knows
 * none of them apart. It asks the same six questions of whichever is
 * selected, which is what keeps the toggle a toggle rather than four
 * different panels sharing a box.
 *
 * Everything here returns HTML as a string. The content is vendored markdown
 * and generated JSON rather than anything a user typed, and `markdown.ts`
 * escapes the text it renders and emits only its own tags — see the note
 * there.
 */

/** What a cursor landed on, ready to show. */
export interface Detected {
  html: string;
  /** Identity of the lookup, so the same one is not rendered twice running. */
  key: string;
  /** A document to fetch and swap in behind the summary, where there is one. */
  path?: string;
}

/** One entry in a source's navigation tree. */
export interface Topic {
  title: string;
  path: string;
  children?: Topic[];
}

export interface DocsSource {
  /** Load whatever index this source needs. */
  load: () => Promise<boolean>;
  /** The placeholder for the search field while this source is up. */
  searchPlaceholder: () => string;
  /** What to show in Automatic mode with nothing under the cursor. */
  emptyHTML: (filePath: string | null) => string;
  /** What to show in Search mode with an empty field. */
  searchEmptyHTML: () => string;
  /** What the cursor is on, or null. Sources without a cursor mode say null. */
  detectAutomatic: (
    lineText: string,
    col: number,
    filePath: string | null,
  ) => Detected | null;
  /** Results for a query, as HTML. */
  search: (query: string) => string;
  /**
   * A click landed in the content area. Sources answer with whatever it
   * means to them: a document path to fetch, HTML to show, or null.
   */
  resultAt: (target: EventTarget | null) => { path?: string; html?: string } | null;
  /** Fetch and render a document by path. */
  fetchAndRender?: (path: string) => Promise<string>;

  // ── The sources that have a navigation column ──────────────────────────
  /** The nav tree, with `activePath` marked. Absent where there is no nav. */
  renderNav?: (activePath: string | null) => string;
  /** A click in the nav column, as a document path. */
  navAt?: (target: EventTarget | null) => string | null;
  /** Automatic mode is hidden for a source that has no cursor lookup. */
  readonly cursorMode: boolean;
}

/** Where the vendored docs live once Vite has copied `public/` into place. */
export const DOCS_BASE = "/data";
