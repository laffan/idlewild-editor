/**
 * The code panel's one bar of chrome, over the file it is about.
 *
 * There were three. A **head** across the whole panel carried the three
 * placement buttons, the reference and Close; this **file bar** carried the
 * column's switch and the open file's name; a **footer** under the editor
 * carried Save, the words "⌘S" and a pair of history buttons. Sixty, forty-four
 * and fifty-six pixels — a hundred and sixty of the window spent on nine
 * controls, in a section whose whole subject is a file taller than the screen,
 * on a device where the screen is not large to begin with.
 *
 * It is one row now, and it reads left to right as two groups. What is on the
 * left is about the **file** under it: the column's switch, the path, whether
 * it is saved, and whatever the editor last had to say about an edit. What is
 * right-aligned is about the **panel**: where it sits, the reference, and the
 * way out. That is the same sentence the head and this bar were saying
 * between them, in one row instead of two.
 *
 * The footer is simply gone. Nothing on it did anything the keyboard does not
 * — ⌘S, ⌘Z and ⇧⌘Z — and the two jobs Save was quietly doing are done without
 * it: the modal writes a dirty file when another is opened in it and when the
 * section is left, and the editor's own header carries a history pair that
 * follows the caret into here.
 *
 * Split out of `code-modal.ts` because that file is at its line limit and this
 * is the part of it that is furniture rather than editing — it holds no
 * document state, reports every press, and is told what to show.
 */

import { h, ICONS, icon } from "../lib/dom";
import { openMenu } from "../lib/menu";
import type { CodePlacement } from "./code-modal";

/** The three, in the order the pin's menu offers them. */
export const PLACEMENTS: Array<{
  value: CodePlacement;
  label: string;
  hint: string;
}> = [
  { value: "bottom", label: "Bottom", hint: "above the console" },
  { value: "right", label: "Right", hint: "beside the canvas" },
  { value: "full", label: "Full", hint: "over the editor" },
];

export interface CodeBarCallbacks {
  /** The file column's switch. */
  onToggleFiles: () => void;
  /** A place picked from the pin's menu. */
  onPlacement: (placement: CodePlacement) => void;
  /** The reference, shown or hidden. */
  onToggleDocs: () => void;
  /** The way out, which is the shell's business — see `CodePanel`. */
  onClose: () => void;
}

export class CodeBar {
  readonly root: HTMLElement;
  /** The open file's path, as two spans: the folders, then the name. */
  private readonly filename: HTMLElement;
  private readonly pathDir: HTMLElement;
  private readonly pathName: HTMLElement;
  private readonly dirtyFlag: HTMLElement;
  /** Why an edit did not take, or what a Reset just did. Clears itself. */
  private readonly note: HTMLElement;
  private readonly filesButton: HTMLButtonElement;
  /** The pin, which opens the three. Its tooltip says which is in force. */
  private readonly pinButton: HTMLButtonElement;
  private readonly docsButton: HTMLButtonElement;
  private noteTimer: number | null = null;
  private placement: CodePlacement | null = null;

  constructor(callbacks: CodeBarCallbacks) {
    // Two spans rather than one string, so a path can be cut where cutting it
    // costs least. See `setFilename`.
    this.pathDir = h("span", { class: "code-path-dir" });
    this.pathName = h("span", { class: "code-path-name" });
    this.filename = h(
      "div",
      { class: "code-filename m" },
      this.pathDir,
      this.pathName,
    );
    this.dirtyFlag = h("div", { class: "code-dirty m" });
    this.note = h("div", { class: "code-note m" });

    // The file column's own switch, beside the path it is showing: on a column
    // dock the tree and the editor are fighting over 420 px, and the tree is
    // the half you only need between files.
    this.filesButton = h(
      "button",
      {
        class: "code-bar-btn",
        title: "Hide the file browser",
        "aria-label": "Toggle the file browser",
        "aria-pressed": "true",
        onClick: callbacks.onToggleFiles,
      },
      icon(ICONS.sidebar, 15),
    ) as HTMLButtonElement;

    // One pin opening a menu, where there were three labelled buttons in a row
    // with a pin glyph in front of them. Three is still the right number of
    // places and a control that cycled through them would be a guessing game —
    // but a menu is not a cycle, it says all three at once, and it costs the
    // bar a single 32px button instead of most of its width.
    this.pinButton = h(
      "button",
      {
        class: "code-bar-btn",
        type: "button",
        "aria-label": "Where this panel sits",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onClick: () => this.openPinMenu(callbacks.onPlacement),
      },
      icon(ICONS.pin, 15),
    ) as HTMLButtonElement;

    // The word "Docs" went with the bar it was on. The book is the reference
    // everywhere else in this editor, the button lights when the panel is up,
    // and the sentence it used to sit beside is on its tooltip.
    this.docsButton = h(
      "button",
      {
        class: "code-bar-btn",
        title: "Phaser, JavaScript and psd-to-phaser reference",
        "aria-label": "Reference",
        "aria-pressed": "false",
        onClick: callbacks.onToggleDocs,
      },
      icon(ICONS.book, 15),
    ) as HTMLButtonElement;

    this.root = h(
      "div",
      { class: "code-bar" },
      this.filesButton,
      this.filename,
      this.dirtyFlag,
      this.note,
      h(
        "div",
        { class: "code-bar-right" },
        this.pinButton,
        this.docsButton,
        h(
          "button",
          {
            class: "code-bar-btn",
            title: "Close",
            "aria-label": "Close",
            onClick: callbacks.onClose,
          },
          icon(ICONS.close, 16),
        ),
      ),
    );

    this.setFilename(null);
  }

  /**
   * Put the open file's path in the bar, split where it can be cut.
   *
   * The folders and the filename are separate spans because only one of them
   * can be given away: `js/prefabs/character.js` in a 260px column has to lose
   * something, and losing the end of it would leave the bar naming a folder.
   * The whole path is on the title either way.
   */
  setFilename(path: string | null): void {
    this.filename.title = path ?? "";
    if (!path) {
      this.pathDir.textContent = "";
      this.pathName.textContent = "No file open";
      return;
    }
    const cut = path.lastIndexOf("/");
    this.pathDir.textContent = cut < 0 ? "" : path.slice(0, cut + 1);
    this.pathName.textContent = cut < 0 ? path : path.slice(cut + 1);
  }

  /** Whether the open file has edits that are not on disk yet. */
  setDirty(dirty: boolean): void {
    this.dirtyFlag.textContent = dirty ? "Unsaved" : "";
  }

  /** A line in the bar, gone again after a moment. */
  setNote(text: string, clearAfterMs = 4000): void {
    this.note.textContent = text;
    if (this.noteTimer !== null) window.clearTimeout(this.noteTimer);
    this.noteTimer = null;
    if (!text || clearAfterMs <= 0) return;
    this.noteTimer = window.setTimeout(() => {
      this.note.textContent = "";
      this.noteTimer = null;
    }, clearAfterMs);
  }

  setFilesShown(shown: boolean): void {
    this.filesButton.setAttribute("aria-pressed", String(shown));
    this.filesButton.title = shown ? "Hide the file browser" : "Show the file browser";
  }

  setDocsOpen(open: boolean): void {
    this.docsButton.setAttribute("aria-pressed", String(open));
  }

  /** Which place is in force, which is the pin's whole tooltip. */
  setPlacement(placement: CodePlacement): void {
    this.placement = placement;
    const named = PLACEMENTS.find((p) => p.value === placement);
    this.pinButton.title = `This panel: ${named?.label ?? placement}`;
  }

  destroy(): void {
    if (this.noteTimer !== null) window.clearTimeout(this.noteTimer);
  }

  /**
   * The three places, under the pin.
   *
   * The one in force is ticked rather than left out: a menu that drops the
   * current item is a menu whose rows move as you use it, and where the panel
   * is now is the first thing anybody opening this wants to read.
   */
  private openPinMenu(onPlacement: (placement: CodePlacement) => void): void {
    this.pinButton.setAttribute("aria-expanded", "true");
    openMenu(
      this.pinButton,
      PLACEMENTS.map(({ value, label, hint }) => ({
        label:
          value === this.placement ? `${label} — ${hint} ✓` : `${label} — ${hint}`,
        onSelect: () => onPlacement(value),
      })),
      () => this.pinButton.setAttribute("aria-expanded", "false"),
    );
  }
}
