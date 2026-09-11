/**
 * The docs panel: four references under one toggle, along the bottom of the
 * code modal.
 *
 * Ported from phaser-bench's `docs.js`, which had it as a panel under the
 * editor there too. Two toggles decide what it shows.
 *
 * **Which reference.** Concepts is Phaser's prose; API is Phaser's own
 * JSDoc; JS/CSS/HTML is MDN's reference, following whichever file is open;
 * P2P is psd-to-phaser's docs, which in phaser-bench appeared only for
 * sketches that used the plugin and here is always there — every Idlewild
 * project is a psd-to-phaser project.
 *
 * **Automatic or Search.** Automatic follows the caret: put it on
 * `this.add.sprite` and the page for it appears, which is the whole reason
 * the panel is attached to an editor rather than sitting in a browser tab.
 * The two written guides have nothing to look up from a caret, so Automatic
 * is hidden while one of them is showing and the nav column takes its place.
 *
 * The content is set with `innerHTML` because every reference renders to an
 * HTML string — see the note at the top of `markdown.ts` about why that is
 * safe here.
 */

import { h } from "../../lib/dom";
import { createGuide } from "./guide";
import { phaserApi } from "./phaser-api";
import { P2P_TOPICS, PHASER_CONCEPTS } from "./topics";
import { buttonLabel, langFromFile, setLang, webDocs } from "./web";
import type { DocsSource } from "./types";

type SourceId = "concepts" | "api" | "web" | "p2p";
type Mode = "auto" | "search";

const concepts = createGuide({
  dir: "phaser-concepts",
  topics: PHASER_CONCEPTS,
  placeholder: "Search Phaser concepts…",
  empty: "Pick a concept from the list, or search.",
});

const p2p = createGuide({
  dir: "p2p-docs",
  topics: P2P_TOPICS,
  placeholder: "Search the psd-to-phaser docs…",
  empty: "Pick a page from the list, or search.",
  mdx: true,
});

const SOURCES: Record<SourceId, DocsSource> = {
  concepts,
  api: phaserApi,
  web: webDocs,
  p2p,
};

export class DocsPanel {
  readonly root: HTMLElement;

  private source: SourceId = "api";
  private mode: Mode = "auto";
  /** The last lookup rendered, so a caret moving inside a word does nothing. */
  private lastKey = "";
  private filePath: string | null = null;
  private openPath: string | null = null;

  private readonly content = h("div", { class: "docs-content" });
  private readonly nav = h("div", { class: "docs-nav" });
  private readonly search: HTMLInputElement;
  private readonly modeButtons: Record<Mode, HTMLButtonElement>;
  private readonly sourceButtons: Record<SourceId, HTMLButtonElement>;

  constructor() {
    this.search = h("input", {
      class: "docs-search",
      type: "text",
      placeholder: "Search…",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    }) as HTMLInputElement;
    this.search.hidden = true;
    this.search.addEventListener("input", () => this.runSearch());
    this.search.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") this.setMode("auto");
      // The editor's own shortcuts have no business in a search field.
      event.stopPropagation();
    });

    this.sourceButtons = {
      concepts: this.toggle("Concepts", () => this.setSource("concepts")),
      api: this.toggle("API", () => this.setSource("api")),
      web: this.toggle(buttonLabel(), () => this.setSource("web")),
      p2p: this.toggle("P2P", () => this.setSource("p2p")),
    };
    this.modeButtons = {
      auto: this.toggle("Automatic", () => this.setMode("auto"), "docs-mode"),
      search: this.toggle("Search", () => this.setMode("search"), "docs-mode"),
    };

    this.nav.hidden = true;
    this.nav.addEventListener("click", (event: Event) => {
      const path = this.current().navAt?.(event.target);
      if (path) void this.open(path);
    });
    this.content.addEventListener("click", (event: Event) => this.onContentClick(event));

    this.root = h(
      "div",
      { class: "docs-panel" },
      h(
        "div",
        { class: "docs-head" },
        h("div", { class: "docs-toggle" }, ...Object.values(this.sourceButtons)),
        h("div", { class: "docs-toggle docs-modes" }, ...Object.values(this.modeButtons)),
        this.search,
      ),
      h("div", { class: "docs-body" }, this.nav, this.content),
    );

    this.paintToggles();
    this.content.innerHTML = this.current().emptyHTML(this.filePath);
    void Promise.all(Object.values(SOURCES).map((source) => source.load())).then(() => {
      // The reference the panel opened on may have had nothing to say until
      // its index arrived; ask it again now that it does.
      if (this.mode === "auto" && !this.lastKey) {
        this.content.innerHTML = this.current().emptyHTML(this.filePath);
      }
    });
  }

  /**
   * The caret moved, or a different file was opened.
   *
   * Called even while the panel is hidden, because the web reference's button
   * carries the language of the open file and should be right before it is
   * looked at.
   */
  onCursor(lineText: string, col: number, filePath: string | null): void {
    this.filePath = filePath;
    this.followFile(filePath);
    if (this.mode !== "auto") return;

    const found = this.current().detectAutomatic(lineText, col, filePath);
    if (!found) {
      if (this.lastKey === "") return;
      this.lastKey = "";
      this.content.innerHTML = this.current().emptyHTML(filePath);
      return;
    }
    if (found.key === this.lastKey) return;
    this.lastKey = found.key;
    this.show(found.html);

    // The web reference answers with a summary first and fetches the page
    // behind it, because a page is a hundred kilobytes and a caret moves.
    if (found.path) void this.swapIn(found.path, found.key);
  }

  destroy(): void {
    this.root.remove();
  }

  // ── The two toggles ───────────────────────────────────────────────────────

  private setSource(next: SourceId): void {
    if (this.source === next) return;
    this.source = next;
    this.lastKey = "";
    this.paintToggles();
    this.renderNav();
    this.search.placeholder = this.current().searchPlaceholder();

    // A guide has nothing to look up from a caret, so it is read or searched.
    if (!this.current().cursorMode && this.mode === "auto") {
      this.setMode("search");
      return;
    }
    this.refresh();
  }

  private setMode(next: Mode): void {
    this.mode = next;
    this.paintToggles();
    this.search.hidden = next !== "search";
    if (next === "search") {
      this.search.focus();
    } else {
      this.search.value = "";
      this.lastKey = "";
    }
    this.refresh();
  }

  private paintToggles(): void {
    for (const [id, button] of Object.entries(this.sourceButtons)) {
      button.classList.toggle("active", id === this.source);
    }
    for (const [id, button] of Object.entries(this.modeButtons)) {
      button.classList.toggle("active", id === this.mode);
    }
    this.modeButtons.auto.hidden = !this.current().cursorMode;
  }

  private refresh(): void {
    if (this.mode === "search") {
      this.show(
        this.search.value
          ? this.current().search(this.search.value)
          : this.current().searchEmptyHTML(),
      );
    } else {
      this.show(this.current().emptyHTML(this.filePath));
    }
  }

  // ── Content ───────────────────────────────────────────────────────────────

  private current(): DocsSource {
    return SOURCES[this.source];
  }

  private runSearch(): void {
    this.show(this.current().search(this.search.value));
  }

  private show(html: string): void {
    this.content.innerHTML = html;
    this.content.scrollTop = 0;
  }

  private onContentClick(event: Event): void {
    // A link to a heading scrolls this panel rather than leaving it.
    const anchor =
      event.target instanceof Element
        ? event.target.closest("a.docs-internal-link")
        : null;
    if (anchor) {
      event.preventDefault();
      const id = anchor.getAttribute("href")?.slice(1) ?? "";
      this.content.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    const hit = this.current().resultAt(event.target);
    if (!hit) return;
    if (hit.html) this.show(hit.html);
    else if (hit.path) void this.open(hit.path);
  }

  /** Open a document by path, from the nav column or a search result. */
  private async open(path: string): Promise<void> {
    const source = this.current();
    if (!source.fetchAndRender) return;
    this.openPath = path;
    this.renderNav();
    this.show('<div class="web-doc-loading">Reading…</div>');
    this.show(await source.fetchAndRender(path));
  }

  /** Replace a summary with the full page, if the caret has not moved on. */
  private async swapIn(path: string, guard: string): Promise<void> {
    const source = this.current();
    if (!source.fetchAndRender) return;
    const html = await source.fetchAndRender(path);
    if (this.lastKey === guard) this.show(html);
  }

  private renderNav(): void {
    const render = this.current().renderNav;
    this.nav.hidden = !render;
    this.root.classList.toggle("has-nav", !!render);
    if (render) this.nav.innerHTML = render(this.openPath);
  }

  /**
   * Keep the web reference pointed at the language being edited.
   *
   * Its button is the only one in the row whose label changes, which is how
   * the panel says that JS, CSS and HTML are one source rather than three.
   */
  private followFile(filePath: string | null): void {
    const lang = langFromFile(filePath);
    if (!lang) return;
    const changed = setLang(lang);
    this.sourceButtons.web.textContent = buttonLabel();
    if (!changed || this.source !== "web") return;
    this.lastKey = "";
    this.search.placeholder = this.current().searchPlaceholder();
    this.refresh();
  }

  private toggle(
    label: string,
    onClick: () => void,
    className = "docs-source",
  ): HTMLButtonElement {
    return h("button", { class: className, text: label, onClick }) as HTMLButtonElement;
  }
}
