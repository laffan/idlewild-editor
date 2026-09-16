/**
 * Find, in the file that is open: ⌘F, and the small window it puts up.
 *
 * **A floating box over the editor, not a bar above it.** The code panel is
 * already a row of chrome over a file that is taller than the screen, in a
 * section whose whole subject is that file — a fifth dock would cost every
 * placement another forty pixels for something that is up for as long as it
 * takes to type six characters. So it floats in the top right corner of the
 * editor, over the text rather than in front of it, and it goes away on
 * Escape. Nothing under it moves while it is there, which is also what makes
 * it safe to open with the caret mid-word.
 *
 * It owns no document state. Every scan reads the view it is given at the
 * moment it runs, so a file opened underneath it is simply the next thing it
 * searches — `refresh` is how the modal says so — and a panel whose editor has
 * gone away answers "no matches" rather than holding a dead view.
 *
 * What the keyboard does in here:
 *
 * | | |
 * |---|---|
 * | Enter | the next match, wrapping |
 * | ⇧Enter | the one before, wrapping |
 * | Escape | close, and put the caret back in the file |
 *
 * Wrapping rather than stopping is the right answer for a box you opened with
 * the caret halfway down a file: the matches above the caret are matches, and
 * a Find that refuses to go round makes you scroll to the top to see them.
 */

import { EditorView } from "@codemirror/view";
import { h, ICONS, icon } from "../lib/dom";
import { findMatches, MAX_MATCHES, setMatches, type Match } from "./find-matches";

export interface FindPanelOptions {
  /**
   * The editor to search, asked for rather than held: the modal rebuilds its
   * view when a file is closed, and a panel holding the old one would search
   * a document nobody is looking at.
   */
  view: () => EditorView | null;
  /** Escape, or the close button. The modal takes the focus back. */
  onClose: () => void;
}

export class FindPanel {
  readonly root: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly options: FindPanelOptions;
  private matches: Match[] = [];
  /** Which match is in hand, or -1 when there are none. */
  private current = -1;
  private caseSensitive = false;
  private shown = false;

  constructor(options: FindPanelOptions) {
    this.options = options;

    this.field = h("input", {
      class: "code-find-field",
      type: "text",
      placeholder: "Find in this file",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      "aria-label": "Find in this file",
      onInput: () => this.search(true),
      onKeyDown: (event: KeyboardEvent) => this.onKey(event),
    }) as HTMLInputElement;

    this.count = h("span", { class: "code-find-count m", text: "" });

    // Case is a switch rather than a second box, and it re-runs the search as
    // it is flipped: the reason to reach for it is that the answers you are
    // looking at are the wrong ones.
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

    this.root = h(
      "div",
      {
        class: "code-find hidden",
        role: "search",
        // A click in here is a click in the panel, not on the canvas behind
        // it, and a press must not travel to the editor underneath.
        onPointerDown: (event: Event) => event.stopPropagation(),
      },
      icon(ICONS.search, 14),
      this.field,
      this.count,
      this.caseButton,
      this.step("Previous match", ICONS.chevronUp, -1),
      this.step("Next match", ICONS.chevronDown, 1),
      h(
        "button",
        {
          class: "code-find-btn",
          type: "button",
          title: "Close",
          "aria-label": "Close find",
          onClick: () => this.options.onClose(),
        },
        icon(ICONS.close, 14),
      ),
    );
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /** What is in the box, so ⇧⌘F can carry the term over to the other Find. */
  get query(): string {
    return this.field.value;
  }

  /**
   * Put it up, seeded from whatever is selected.
   *
   * A selection is nearly always the thing you want to look for — you have
   * just double-clicked a name and pressed ⌘F — and re-typing it is the one
   * step a Find can take out of the way for free. The field's text is selected
   * either way, so typing over a seeded query costs nothing.
   */
  open(): void {
    this.shown = true;
    this.root.classList.remove("hidden");
    const seed = this.selectedWord();
    if (seed) this.field.value = seed;
    this.field.focus();
    this.field.select();
    this.search(false);
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.add("hidden");
    this.clearMarks();
  }

  /** The file under it changed. Re-run, or do nothing if it is not up. */
  refresh(): void {
    if (this.shown) this.search(false);
  }

  destroy(): void {
    this.clearMarks();
  }

  // ── searching ─────────────────────────────────────────────────────────────

  /**
   * Scan, mark and count.
   *
   * `jump` is what separates typing from everything else: a keystroke should
   * carry you to the first match at or after the caret, so the file follows
   * what you are typing, while re-running after a file change or a case flip
   * should leave the view where it is.
   */
  private search(jump: boolean): void {
    const view = this.options.view();
    const query = this.field.value;
    if (!view || !query) {
      this.matches = [];
      this.current = -1;
      this.clearMarks();
      this.count.textContent = "";
      this.root.classList.remove("no-matches");
      return;
    }

    this.matches = findMatches(view.state.doc.toString(), query, this.caseSensitive);
    this.current = this.matches.length ? this.nearest(view) : -1;
    this.paint(view);
    if (jump && this.current >= 0) this.reveal(view);
  }

  /** The first match at or after the caret, wrapping to the first. */
  private nearest(view: EditorView): number {
    const head = view.state.selection.main.from;
    const at = this.matches.findIndex((match) => match.from >= head);
    return at === -1 ? 0 : at;
  }

  /** Next or previous, wrapping in both directions. */
  private step(title: string, glyph: string | readonly string[], delta: 1 | -1): HTMLElement {
    return h(
      "button",
      {
        class: "code-find-btn",
        type: "button",
        title,
        "aria-label": title,
        onClick: () => this.go(delta),
      },
      icon(glyph, 14),
    );
  }

  private go(delta: 1 | -1): void {
    const view = this.options.view();
    if (!view || !this.matches.length) return;
    const count = this.matches.length;
    this.current = (this.current + delta + count) % count;
    this.paint(view);
    this.reveal(view);
  }

  /**
   * Select the match in hand and bring it into view.
   *
   * Selected rather than merely scrolled to, so Escape leaves the caret on
   * what you were looking for: closing the panel and typing should carry on
   * from the answer rather than from wherever the file was before.
   */
  private reveal(view: EditorView): void {
    const match = this.matches[this.current];
    if (!match) return;
    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: "center" }),
    });
  }

  private paint(view: EditorView): void {
    view.dispatch({
      effects: setMatches.of({ ranges: this.matches, current: this.current }),
    });
    const total =
      this.matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : `${this.matches.length}`;
    this.count.textContent = this.matches.length
      ? `${this.current + 1} / ${total}`
      : "No matches";
    this.root.classList.toggle("no-matches", !this.matches.length);
  }

  private clearMarks(): void {
    this.options
      .view()
      ?.dispatch({ effects: setMatches.of({ ranges: [], current: -1 }) });
  }

  private toggleCase(): void {
    this.caseSensitive = !this.caseSensitive;
    this.caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
    this.search(false);
    this.field.focus();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.options.onClose();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    this.go(event.shiftKey ? -1 : 1);
  }

  /**
   * What the editor has selected, if it is one line's worth.
   *
   * A multi-line selection is not a search term — it is a block somebody was
   * about to move — and seeding the box with it would put a paragraph in a
   * field two hundred pixels wide.
   */
  private selectedWord(): string | null {
    const view = this.options.view();
    if (!view) return null;
    const range = view.state.selection.main;
    if (range.empty) return null;
    const text = view.state.sliceDoc(range.from, range.to);
    return text.includes("\n") || text.length > 120 ? null : text;
  }
}
