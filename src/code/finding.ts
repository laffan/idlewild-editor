/**
 * The two Finds, and the one thing they have to say to each other.
 *
 * ⌘F searches the file that is open and floats over it; ⇧⌘F searches every
 * file in `game/` and stands over the column of files. They are two panels
 * because they answer two questions, and they are in one module because
 * everything that is true of both is here: which keystroke opens which, that
 * ⇧⌘F carries over whatever ⌘F was looking for, and that closing either one
 * puts the caret back in the file.
 *
 * Split out of `code-modal.ts` for the 700-line rule, and it is a clean cut:
 * the modal hands over two slots in its layout and a way to reach the editor,
 * and gets back a keystroke handler. Nothing here knows about saving, the
 * reference, managed blocks or where the panel sits.
 *
 * **The shortcut is handled twice on purpose.** CodeMirror's content is
 * `contenteditable`, so a keystroke in the editor goes to its keymap first and
 * never reaches a document-level listener that stands down for text fields —
 * see `editor/shortcuts.ts`. The keymap entries are in `editor-state.ts`;
 * `handleShortcut` is for everywhere else in the panel, and `defaultPrevented`
 * is what stops the two from both firing when an event bubbles out of the
 * editor.
 */

import type { EditorView } from "@codemirror/view";
import { FindInFiles } from "./find-in-files";
import { FindPanel } from "./find-panel";

export interface FindingOptions {
  projectId: string;
  /**
   * The editor to search, asked for rather than held: the modal destroys its
   * view when the open file goes away.
   */
  view: () => EditorView | null;
  /** Open a file with a cross-file match selected. */
  openAt: (path: string, line: number, column: number, length: number) => void;
  /** Results are standing where the tree was, or are not. */
  setSearching: (searching: boolean) => void;
  /**
   * Make sure the file column is up.
   *
   * The cross-file answers appear *in* that column, so opening the search with
   * it folded away would look like the search did nothing.
   */
  showFiles: () => void;
}

export class Finding {
  /** The floating box. Goes in the editor's own column, over the text. */
  readonly overlay: HTMLElement;
  /** The strip. Goes at the top of the file column, over the list. */
  readonly strip: HTMLElement;
  private readonly inFile: FindPanel;
  private readonly acrossFiles: FindInFiles;
  private readonly options: FindingOptions;

  constructor(options: FindingOptions) {
    this.options = options;
    this.inFile = new FindPanel({
      view: options.view,
      onClose: () => this.closeInFile(),
    });
    this.acrossFiles = new FindInFiles({
      projectId: options.projectId,
      onOpen: options.openAt,
      onSearching: options.setSearching,
      onClose: () => this.closeAcrossFiles(),
    });
    this.overlay = this.inFile.root;
    this.strip = this.acrossFiles.root;
  }

  /**
   * ⌘F.
   *
   * Nothing happens with no file open: there is nothing to search, and a box
   * answering "no matches" for a file that is not there says the wrong thing.
   */
  openInFile(): void {
    if (!this.options.view()) return;
    this.inFile.open();
  }

  /** ⇧⌘F, carrying the term over so nobody types it twice. */
  openAcrossFiles(): void {
    this.options.showFiles();
    this.acrossFiles.open(this.inFile.query || undefined);
  }

  /** The open file changed under the floating box, or went away. */
  refresh(): void {
    this.inFile.refresh();
  }

  /** The file is gone, so the box that searches it has nothing to search. */
  closeForFile(): void {
    this.inFile.close();
  }

  /** ⌘F and ⇧⌘F from everywhere in the panel that is not the editor. */
  handleShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey) return;
    // Control stands in for ⌘ as it does everywhere else in this editor, so a
    // keyboard without a Command key is not locked out.
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.key.toLowerCase() !== "f") return;
    event.preventDefault();
    if (event.shiftKey) this.openAcrossFiles();
    else this.openInFile();
  }

  destroy(): void {
    this.inFile.destroy();
    this.acrossFiles.destroy();
  }

  private closeInFile(): void {
    this.inFile.close();
    this.options.view()?.focus();
  }

  private closeAcrossFiles(): void {
    this.acrossFiles.close();
    this.options.view()?.focus();
  }
}
