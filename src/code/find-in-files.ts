/**
 * Find across every file in `game/` — ⇧⌘F, at the top of the file column.
 *
 * **Where it is, is the point.** The in-file Find floats over the text because
 * its answers are in the text. This one's answers are files, and the column of
 * files is already there — so it is a strip at the top of that column and its
 * results stand in the column's own body, where a row you click behaves like
 * every other row in it: it opens a file. A second floating window listing
 * files, over a panel that has a list of files down its left edge, would be the
 * same list twice.
 *
 * The tree goes down while results are up (`FileTree.setSearching`). In a 170px
 * column dock there is not room for both, and the two are the same kind of
 * thing — a way to reach a file — so showing one at a time is not a loss. The
 * tree comes back when the box is emptied or closed.
 *
 * **The search itself is Rust's.** One call per query rather than a read per
 * file; see `game_search.rs`. What is here is the typing, the debounce that
 * keeps a keystroke from being a round trip, and the token that drops an answer
 * to a question nobody is asking any more.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { gameFiles, type FileMatch } from "../lib/ipc";
import * as log from "../lib/log";

/**
 * How long a keystroke waits before it becomes a search.
 *
 * Long enough that typing `character` is one search rather than nine, short
 * enough that it still feels like it is answering as you type.
 */
const DEBOUNCE_MS = 180;

export interface FindInFilesOptions {
  projectId: string;
  /** A result was clicked: open that file with the match selected. */
  onOpen: (path: string, line: number, column: number, length: number) => void;
  /** Whether results are standing where the tree was. */
  onSearching: (searching: boolean) => void;
  /** Escape, or the close button. */
  onClose: () => void;
}

export class FindInFiles {
  readonly root: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly results: HTMLElement;
  private readonly options: FindInFilesOptions;
  private caseSensitive = false;
  private shown = false;
  private timer: number | null = null;
  /** Which search is the current one — a slower answer must not land last. */
  private token = 0;

  constructor(options: FindInFilesOptions) {
    this.options = options;

    this.field = h("input", {
      class: "code-find-field",
      type: "text",
      placeholder: "Find in all files",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      "aria-label": "Find in all files",
      onInput: () => this.schedule(),
      onKeyDown: (event: KeyboardEvent) => this.onKey(event),
    }) as HTMLInputElement;

    this.count = h("div", { class: "code-find-count m", text: "" });

    this.caseButton = h(
      "button",
      {
        class: "code-find-btn code-find-case",
        type: "button",
        title: "Match case",
        "aria-label": "Match case",
        "aria-pressed": "false",
        onClick: () => this.toggleCase(),
      },
      h("span", { text: "Aa" }),
    ) as HTMLButtonElement;

    this.results = h("div", { class: "code-find-results scroll" });

    this.root = h(
      "div",
      { class: "code-find-files hidden" },
      h(
        "div",
        { class: "code-find-bar" },
        icon(ICONS.search, 14),
        this.field,
        this.caseButton,
        h(
          "button",
          {
            class: "code-find-btn",
            type: "button",
            title: "Close",
            "aria-label": "Close find in files",
            onClick: () => this.options.onClose(),
          },
          icon(ICONS.close, 14),
        ),
      ),
      this.count,
      this.results,
    );
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /**
   * Put the strip up, optionally carrying a term over from the in-file Find.
   *
   * Going from "find it here" to "find it everywhere" is one keystroke, and
   * re-typing what you had just typed is the step that makes people not
   * bother.
   */
  open(seed?: string): void {
    this.shown = true;
    this.root.classList.remove("hidden");
    if (seed) this.field.value = seed;
    this.field.focus();
    this.field.select();
    if (this.field.value) this.run();
    else this.options.onSearching(false);
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.add("hidden");
    this.cancel();
    this.options.onSearching(false);
  }

  /** What is in the box, for the other Find to carry the other way. */
  get query(): string {
    return this.field.value;
  }

  destroy(): void {
    this.cancel();
  }

  // ── searching ─────────────────────────────────────────────────────────────

  private cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    // Nothing in flight counts any more: a late answer must not repaint a
    // list the box has moved on from.
    this.token++;
  }

  private schedule(): void {
    this.cancel();
    if (!this.field.value) {
      this.render(null);
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    const query = this.field.value;
    if (!query) {
      this.render(null);
      return;
    }
    const token = ++this.token;
    this.count.textContent = "Searching…";
    this.options.onSearching(true);
    try {
      const found = await gameFiles.search(
        this.options.projectId,
        query,
        this.caseSensitive,
      );
      if (token !== this.token) return;
      this.render(found);
    } catch (err) {
      if (token !== this.token) return;
      log.error("Could not search the project:", err);
      this.render({ matches: [], truncated: false, files: 0 });
    }
  }

  private toggleCase(): void {
    this.caseSensitive = !this.caseSensitive;
    this.caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
    this.field.focus();
    if (this.field.value) void this.run();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.options.onClose();
      return;
    }
    if (event.key !== "Enter") return;
    // Enter searches now rather than waiting out the debounce — the one thing
    // it can usefully mean in a box that is already answering as you type.
    event.preventDefault();
    this.cancel();
    void this.run();
  }

  // ── the list ──────────────────────────────────────────────────────────────

  /**
   * Draw the answers, grouped by file.
   *
   * A file's name once with its lines under it, rather than the path repeated
   * down every row: in a column this narrow the path is most of the row, and
   * the thing that makes a result readable is which file it is in followed by
   * what the line says.
   *
   * `null` is the empty box rather than a search that found nothing — the tree
   * comes back, and nothing is said about a question that was never asked.
   */
  private render(found: { matches: FileMatch[]; truncated: boolean; files: number } | null): void {
    clear(this.results);
    if (!found) {
      this.count.textContent = "";
      this.options.onSearching(false);
      return;
    }

    this.options.onSearching(true);
    if (!found.matches.length) {
      this.count.textContent = `No matches in ${found.files} ${plural(found.files, "file")}`;
      return;
    }

    const groups = groupByFile(found.matches);
    const files = groups.length;
    const total = found.matches.length;
    this.count.textContent = found.truncated
      ? `First ${total} matches in ${files} ${plural(files, "file")}`
      : `${total} ${plural(total, "match", "matches")} in ${files} ${plural(files, "file")}`;

    for (const group of groups) {
      this.results.appendChild(fileHeading(group.path));
      for (const match of group.matches) {
        this.results.appendChild(
          h(
            "button",
            {
              class: "code-find-hit",
              title: `${group.path}:${match.line}`,
              onClick: () =>
                this.options.onOpen(
                  match.path,
                  match.line,
                  match.column,
                  match.length,
                ),
            },
            h("span", { class: "code-find-line m", text: String(match.line) }),
            // The leading indent is cut: every line in a nested block would
            // otherwise start a third of the way across a column this narrow.
            h("span", { class: "code-find-text", text: match.text.trimStart() }),
          ),
        );
      }
    }
  }
}

/** The matches of one file, in the order they were found. */
function groupByFile(matches: readonly FileMatch[]): Array<{
  path: string;
  matches: FileMatch[];
}> {
  const out: Array<{ path: string; matches: FileMatch[] }> = [];
  for (const match of matches) {
    const last = out[out.length - 1];
    if (last && last.path === match.path) last.matches.push(match);
    else out.push({ path: match.path, matches: [match] });
  }
  return out;
}

/** A file's row: the folders dimmed, the name not — as the code bar does it. */
function fileHeading(path: string): HTMLElement {
  const cut = path.lastIndexOf("/");
  return h(
    "div",
    { class: "code-find-file", title: path },
    icon(ICONS.file, 12),
    h("span", { class: "code-find-dir m", text: cut < 0 ? "" : path.slice(0, cut + 1) }),
    h("span", { class: "code-find-name", text: cut < 0 ? path : path.slice(cut + 1) }),
  );
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
