/**
 * The Code modal: the file column and editor column of Phaser Bench, in a
 * dockable modal over the canvas.
 *
 * This pass ships the dock, the file tree and a working CodeMirror 6 editor
 * over the project's real `game/` tree. Phaser Bench's Phaser-aware
 * autocomplete and its live preview reload are the next increment; the spec
 * asks only for a dockable modal for now.
 *
 * Where it sits is a choice of three — a row above the console, a column to
 * the right of the canvas, or the whole shell — and the row of buttons in its
 * head is how it is made. Which of them is in force is the editor shell's
 * business, because it is a fact about the shell's layout, so a placement is
 * reported rather than acted on here. See `editor/code-panel.ts`.
 *
 * Docs opens a region of its own on a divider: the Phaser reference, MDN's,
 * and the two written guides, following the caret where they can. It is
 * ported from phaser-bench, where it sits under the editor — the question
 * "what does this method take?" arrives while you are typing the method — and
 * here it takes whichever side the panel has room for. See `placeDocs`.
 *
 * Some of these lines are the editor's. A scaffolded file marks the runs it
 * maintains, and `managed-blocks.ts` works out line by line which of them are
 * still the editor's after everything that has been typed around them: those
 * are shown in their own colour, refuse to be edited, and carry a Reset that
 * puts the block back. The generated config is the whole-file case of the
 * same idea, and it is re-read whenever the document is saved so that what is
 * on screen is what the running game reads.
 */

import { EditorView } from "@codemirror/view";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { clear, h, ICONS, icon } from "../lib/dom";
import { gameFiles } from "../lib/ipc";
import * as log from "../lib/log";
import { FileTree } from "./file-tree";
import { DocsPanel } from "./docs/panel";
import { fileState } from "./editor-state";
import { addMissingBlocks, isGenerated, resetBlock } from "./managed-blocks";
import { managedEdit } from "./managed-view";
import { createResizer, type Resizer } from "../editor/resizer";

/**
 * Where the panel sits in the shell.
 *
 * `bottom` is a row between the canvas and the console; `right` is a column
 * beside it; `full` covers the shell, header included. Acted on by
 * `editor/code-panel.ts` — what it means here is which button is lit, which
 * class the panel carries, and which side the reference takes.
 */
export type CodePlacement = "bottom" | "right" | "full";

/** The three, in the order the head offers them. */
const PLACEMENTS: Array<{ value: CodePlacement; label: string; title: string }> = [
  { value: "bottom", label: "Bottom", title: "Dock above the console" },
  { value: "right", label: "Right", title: "Dock to the right of the canvas" },
  { value: "full", label: "Full", title: "Cover the editor" },
];

export class CodeModal {
  readonly root: HTMLElement;
  private readonly projectId: string;
  private readonly tree: FileTree;
  private readonly filename: HTMLElement;
  private readonly dirtyFlag: HTMLElement;
  /** Why an edit did not take, or what a Reset just did. Clears itself. */
  private readonly note: HTMLElement;
  /** The template has blocks this file lacks, and an offer to put them in. */
  private readonly repair: HTMLElement;
  private readonly editorHost: HTMLElement;
  private view: EditorView | null = null;
  private openPath: string | null = null;
  private dirty = false;
  /** Null until the shell has placed it, which it does as soon as it is up. */
  private placement: CodePlacement | null = null;
  private readonly placementButtons = new Map<CodePlacement, HTMLButtonElement>();
  private readonly docsButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly onPlacementChange: (placement: CodePlacement) => void;
  /** A file was written. The shell restarts a running game against it. */
  private readonly onSaved: (path: string) => void;
  /**
   * Told when what undo and redo would do here has moved, so the header's own
   * pair can follow. Set by `editor/code-panel.ts`; the pair in this modal's
   * footer is updated from the same place — see `historyMoved`.
   */
  onHistoryChange: () => void = () => {};
  /** Which open is the current one — see `openFile`. */
  private openToken = 0;
  private noteTimer: number | null = null;
  private readonly filesResizer: Resizer;
  private readonly docs = new DocsPanel();
  /** Rebuilt on every move: the axis differs between the two sides. */
  private docsResizer: Resizer | null = null;
  /** Which side the reference is on, or null before it has been placed. */
  private docsSide: "right" | "bottom" | null = null;
  private docsOpen = false;
  /** The panel and the row inside it: what a placement moves the docs between. */
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly filesButton: HTMLButtonElement;
  private filesShown = true;

  constructor(
    projectId: string,
    onClose: () => void,
    onPlacementChange: (placement: CodePlacement) => void,
    onSaved: (path: string) => void = () => {},
  ) {
    this.projectId = projectId;
    this.onPlacementChange = onPlacementChange;
    this.onSaved = onSaved;
    this.tree = new FileTree(projectId, {
      onOpen: (path) => void this.openFile(path),
      onMoved: (from, to) => {
        // The editor is showing a file that just changed name or folder.
        if (this.openPath !== from) return;
        this.openPath = to;
        this.filename.textContent = to;
        this.tree.setOpen(to);
      },
      onRemoved: (path) => {
        if (this.openPath !== path) return;
        this.closeFile();
      },
    });
    // The file column takes a divider like the editor's other sidebars, and
    // remembers its width the same way.
    this.filesResizer = createResizer({
      target: this.tree.root,
      axis: "width",
      edge: "end",
      min: 150,
      max: 560,
      storageKey: "codeFilesWidth",
    });

    // The reference is placed rather than nailed down — see `placeDocs`, which
    // the first `setPlacement` calls. It starts closed either way.
    this.docs.root.hidden = true;

    this.filename = h("div", { class: "code-filename m", text: "No file open" });
    this.dirtyFlag = h("div", { class: "code-dirty m" });
    this.note = h("div", { class: "code-note m" });
    this.repair = h("div", { class: "code-repair hidden" });
    this.editorHost = h("div", { class: "code-editor" });

    this.docsButton = h(
      "button",
      {
        class: "code-pin-btn",
        title: "Phaser, JavaScript and psd-to-phaser reference",
        "aria-pressed": "false",
        onClick: () => this.setDocsOpen(!this.docsOpen),
      },
      icon(ICONS.book, 15),
      h("span", { text: "Docs" }),
    ) as HTMLButtonElement;

    // The file column's own switch, beside the path it is showing: on a column
    // dock the tree and the editor are fighting over 420 px, and the tree is
    // the half you only need between files.
    this.filesButton = h(
      "button",
      {
        class: "code-files-btn",
        title: "Hide the file browser",
        "aria-label": "Toggle the file browser",
        "aria-pressed": "true",
        onClick: () => this.setFilesShown(!this.filesShown),
      },
      icon(ICONS.sidebar, 15),
    ) as HTMLButtonElement;

    // Three buttons rather than one toggle: there is no natural pair here, and
    // a control that cycled through three places would be a guessing game.
    const dockGroup = h("div", { class: "code-dock" }, icon(ICONS.pin, 15));
    for (const { value, label, title } of PLACEMENTS) {
      const button = h("button", {
        class: "code-dock-btn",
        type: "button",
        title,
        text: label,
        "aria-pressed": "false",
        onClick: () => this.setPlacement(value),
      }) as HTMLButtonElement;
      this.placementButtons.set(value, button);
      dockGroup.appendChild(button);
    }

    // A pair of its own beside Save, as well as the two in the header. The
    // header's are out of reach whenever the panel is placed over the whole
    // shell, and on an iPad with no keyboard those are the only way to undo. `mousedown` is swallowed so pressing one does not take the
    // caret out of the editor it is about.
    const keepFocus = (event: Event) => event.preventDefault();
    this.undoButton = h(
      "button",
      {
        class: "code-history",
        title: "Undo (⌘Z)",
        "aria-label": "Undo",
        disabled: "",
        onMouseDown: keepFocus,
        onClick: () => {
          this.undo();
          this.historyMoved();
        },
      },
      icon(ICONS.undo, 15),
    ) as HTMLButtonElement;
    this.redoButton = h(
      "button",
      {
        class: "code-history",
        title: "Redo (⇧⌘Z)",
        "aria-label": "Redo",
        disabled: "",
        onMouseDown: keepFocus,
        onClick: () => {
          this.redo();
          this.historyMoved();
        },
      },
      icon(ICONS.redo, 15),
    ) as HTMLButtonElement;

    const panel = h(
      "div",
      { class: "code-panel", onClick: (e: Event) => e.stopPropagation() },
      h(
        "div",
        { class: "code-head" },
        // Where the word "Code" and the project name used to sit, and then New
        // File and New Folder: those belong over the column they create into,
        // so they have gone there and the reference takes the left of the head.
        this.docsButton,
        h(
          "div",
          { class: "code-head-right" },
          dockGroup,
          h(
            "button",
            { class: "icon-btn", title: "Close", onClick: onClose },
            icon(ICONS.close, 16),
          ),
        ),
      ),
      (this.body = h(
        "div",
        { class: "code-body" },
        this.tree.root,
        this.filesResizer.handle,
        h(
          "div",
          { class: "code-main" },
          h(
            "div",
            { class: "code-bar" },
            this.filesButton,
            this.filename,
            this.dirtyFlag,
            this.note,
          ),
          this.repair,
          this.editorHost,
          h(
            "div",
            { class: "code-foot" },
            h("button", {
              class: "btn btn-primary",
              text: "Save",
              onClick: () => void this.save(),
            }),
            h("div", { class: "m", text: "⌘S" }),
            h("div", { class: "code-foot-spacer" }),
            this.undoButton,
            this.redoButton,
          ),
        ),
      )),
    );
    this.panel = panel;

    this.root = h("div", { class: "code-backdrop" }, panel);
    this.filesResizer.restore();
    void this.reloadFiles();
  }

  /**
   * CodeMirror's own history, which the editor has always had over ⌘Z and
   * which the header's two buttons reach into when the caret is in here.
   *
   * A history per open file rather than one across the modal: `openFile`
   * builds a fresh `EditorState`, and undoing back past the file you are
   * looking at into edits made in another one is not a thing to want.
   */
  undo(): boolean {
    return this.view ? undo(this.view) : false;
  }

  redo(): boolean {
    return this.view ? redo(this.view) : false;
  }

  get canUndo(): boolean {
    return !!this.view && undoDepth(this.view.state) > 0;
  }

  get canRedo(): boolean {
    return !!this.view && redoDepth(this.view.state) > 0;
  }

  /** Whether an element is inside this modal — see `editor/history.ts`. */
  contains(node: Node | null): boolean {
    return !!node && this.root.contains(node);
  }

  /**
   * The open file's history has moved. Both pairs of buttons follow: this
   * modal's own, and — through the shell — the two in the header.
   */
  private historyMoved(): void {
    this.undoButton.disabled = !this.canUndo;
    this.redoButton.disabled = !this.canRedo;
    this.onHistoryChange();
  }

  /**
   * Put the panel somewhere: a row above the console, a column either side of
   * the canvas, or over the whole shell.
   *
   * The classes are what the stylesheet reads — `docked` for the three that are
   * part of the layout, and the direction for which edge each takes. Moving it
   * in the DOM, and the inline size its divider writes, are the shell's.
   */
  setPlacement(placement: CodePlacement): void {
    if (placement === this.placement) return;
    this.placement = placement;
    this.root.classList.toggle("docked", placement !== "full");
    for (const side of ["right", "bottom"] as const) {
      this.root.classList.toggle(`dock-${side}`, placement === side);
    }
    for (const [value, button] of this.placementButtons) {
      button.setAttribute("aria-pressed", String(value === placement));
    }
    this.placeDocs();
    this.onPlacementChange(placement);
  }

  /**
   * Which side the reference takes, which follows the panel's own shape.
   *
   * **Beside the editor** when the panel is wide — the bottom dock and the
   * full-screen one — because a reference page is a column of prose and the
   * bottom dock has no height to spare for one. **Under it** when the panel is
   * itself a column beside the canvas: there is no width to give away there,
   * and under the editor is where phaser-bench had it and where the question
   * "what does this method take?" wants it.
   *
   * Each side is a divider on a different axis, so each remembers its own
   * size and the inline size the other one wrote has to come off first.
   */
  private placeDocs(): void {
    const side = this.placement === "right" ? "bottom" : "right";
    if (side === this.docsSide) return;
    this.docsSide = side;

    this.docsResizer?.destroy();
    this.docs.root.style.removeProperty("width");
    this.docs.root.style.removeProperty("height");
    this.docs.root.classList.toggle("docs-right", side === "right");

    const right = side === "right";
    this.docsResizer = createResizer({
      target: this.docs.root,
      axis: right ? "width" : "height",
      edge: "start",
      min: right ? 240 : 120,
      max: right ? 900 : 620,
      storageKey: right ? "codeDocsWidth" : "codeDocsHeight",
    });
    this.docsResizer.handle.hidden = !this.docsOpen;
    // Appended: the row the reference goes beside — or under — is the last
    // thing in either container already.
    (right ? this.body : this.panel).append(
      this.docsResizer.handle,
      this.docs.root,
    );
    this.docsResizer.restore();
  }

  /**
   * Show or hide the file column.
   *
   * The divider goes with it: a handle left behind is a three-pixel strip that
   * resizes something nobody can see.
   */
  setFilesShown(shown: boolean): void {
    this.filesShown = shown;
    this.root.classList.toggle("files-hidden", !shown);
    this.filesResizer.handle.hidden = !shown;
    this.filesButton.setAttribute("aria-pressed", String(shown));
    this.filesButton.title = shown ? "Hide the file browser" : "Show the file browser";
  }

  /**
   * Open a file and put the caret on one of its lines.
   *
   * What the console's level chip does: a `console.log` in the project's own
   * code knows where it was written, and the shortest way to say so is to
   * show it. The line is centred and selected, so the active-line highlight
   * lands on it rather than leaving you to count rows.
   */
  async openAt(path: string, line: number): Promise<void> {
    if (this.openPath !== path) await this.openFile(path);
    const view = this.view;
    if (!view || this.openPath !== path) return;
    const info = view.state.doc.line(
      Math.max(1, Math.min(view.state.doc.lines, line)),
    );
    view.dispatch({
      selection: { anchor: info.from, head: info.to },
      effects: EditorView.scrollIntoView(info.from, { y: "center" }),
    });
    view.focus();
  }

  /** Show or hide the reference along the bottom. */
  setDocsOpen(open: boolean): void {
    if (open === this.docsOpen) return;
    this.docsOpen = open;
    this.docs.root.hidden = !open;
    if (this.docsResizer) this.docsResizer.handle.hidden = !open;
    this.docsButton.setAttribute("aria-pressed", String(open));
    // Opening it with the caret already somewhere should answer for where the
    // caret already is, rather than waiting for the next keystroke.
    if (open) this.reportCursor();
  }

  private async reloadFiles(): Promise<void> {
    const files = await this.tree.reload();
    // Something asked for a file while the tree was loading — a console line
    // opening the place it was written, which is a better answer than the
    // one this would have picked.
    if (this.openToken > 0) return;
    const first = files.find((f) => !f.isDir && f.path.endsWith("WorldScene.js"));
    if (first) void this.openFile(first.path);
  }

  /** The open file went away under us. */
  private closeFile(): void {
    this.openPath = null;
    this.filename.textContent = "No file open";
    this.setDirty(false);
    this.view?.destroy();
    this.view = null;
    this.tree.setOpen(null);
    this.historyMoved();
  }

  private async openFile(path: string): Promise<void> {
    if (this.dirty && this.openPath) await this.save();
    // Two round trips stand between a click on a file and that file being on
    // screen, and a second click during them would otherwise land first and
    // be overwritten by the first click's answer.
    const token = ++this.openToken;

    let content = "";
    try {
      content = await gameFiles.read(this.projectId, path);
    } catch (err) {
      log.error(`Could not open ${path}:`, err);
      return;
    }
    const canonical = await this.readTemplate(path);
    if (token !== this.openToken) return;

    this.openPath = path;
    this.filename.textContent = path;
    this.setDirty(false);
    this.setNote(
      isGenerated(path)
        ? "The editor writes this file. It follows the canvas."
        : "",
      0,
    );
    this.tree.setOpen(path);

    const state = fileState({
      path,
      content,
      canonical,
      onSave: () => void this.save(),
      onReset: (blockId) => void this.reset(blockId),
      onRefused: () =>
        this.setNote("These lines are the editor's — Reset puts them back."),
      onMissing: (ids) => this.offerMissing(path, ids),
      onEdit: () => {
        this.setDirty(true);
        this.historyMoved();
      },
      onCursor: () => this.reportCursor(),
    });

    if (this.view) {
      this.view.setState(state);
    } else {
      this.view = new EditorView({ state, parent: this.editorHost });
    }
    // A new file is a new language as far as the reference is concerned, even
    // before the caret has moved in it — and a new file is an empty history,
    // which the buttons above have to be told about.
    this.reportCursor();
    this.historyMoved();
  }

  /**
   * The open file as the scaffold wrote it.
   *
   * A file the template does not write — one the user made, or the other
   * genre's helper — answers with an error, and null is the right answer to
   * carry: nothing in it is the editor's, so nothing in it is locked.
   */
  private async readTemplate(path: string): Promise<string | null> {
    try {
      return await gameFiles.template(this.projectId, path);
    } catch {
      return null;
    }
  }

  /**
   * Put one managed block back, and save.
   *
   * Saved rather than left dirty because a Reset is a repair: the reason to
   * press it is that the running game is broken, and a repair you then have
   * to remember to save is half a repair. The write goes through the same
   * `save`, so a game that is up restarts on it.
   */
  private async reset(blockId: string): Promise<void> {
    const path = this.openPath;
    if (!this.view || !path) return;
    // Re-read rather than trust what was loaded with the file: the generated
    // config's pristine form is the document as it stands, and the document
    // moves while the modal is open.
    const canonical = await this.readTemplate(path);
    if (!canonical) {
      this.setNote("There is no scaffold for this file to go back to.");
      return;
    }

    const next = resetBlock(path, this.view.state.doc.toString(), canonical, blockId);
    if (next === null) {
      this.setNote(`Could not find ${blockId} to reset.`);
      return;
    }
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: next },
      annotations: managedEdit.of(true),
    });
    this.setDirty(true);
    await this.save();
    this.setNote(`${blockId} is back the way the editor wrote it.`);
  }

  /**
   * Re-read the open file if the editor is the one writing it.
   *
   * Called when the document has been saved, which is when Rust rewrites
   * `game.config.json` behind it. Only generated files: anything else on
   * screen may be half-typed, and replacing it under the caret would be the
   * editor taking the file back.
   */
  async refreshGenerated(): Promise<void> {
    const path = this.openPath;
    if (!this.view || !path || !isGenerated(path)) return;
    let content = "";
    try {
      content = await gameFiles.read(this.projectId, path);
    } catch {
      return;
    }
    if (content === this.view.state.doc.toString()) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: content },
      annotations: managedEdit.of(true),
    });
    this.setDirty(false);
  }

  /**
   * The template has blocks this file has never had.
   *
   * A project's `game/` tree is its own copy, so a block the scaffold gains
   * afterwards can never reach it — and Reset cannot help, because there is
   * nothing there to put back. That is not hypothetical: `WorldScene.js`
   * gained `drawOrder` and `applyDepth` when the exported game learned to
   * stack a PSD the right way up, and without this a project made before that
   * would have drawn every multi-layer file upside down for good.
   *
   * An offer rather than an edit: it is the user's file, and code appearing
   * in it unasked is the fight this whole mechanism exists to avoid.
   */
  private offerMissing(path: string, ids: readonly string[]): void {
    if (this.openPath !== path) return;
    clear(this.repair);
    this.repair.classList.toggle("hidden", ids.length === 0);
    if (ids.length === 0) return;

    this.repair.append(
      h("span", {
        text:
          `This file is missing ${ids.length} ` +
          `${ids.length === 1 ? "block" : "blocks"} the editor maintains: ` +
          `${ids.join(", ")}.`,
      }),
      h("button", {
        class: "code-repair-btn",
        type: "button",
        text: "Add them",
        onClick: () => void this.addMissing(),
      }),
    );
  }

  /** Put the missing blocks in, and save. */
  private async addMissing(): Promise<void> {
    const path = this.openPath;
    if (!this.view || !path) return;
    const canonical = await this.readTemplate(path);
    if (!canonical) return;

    const next = addMissingBlocks(this.view.state.doc.toString(), canonical);
    if (next === null) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: next },
      annotations: managedEdit.of(true),
    });
    this.setDirty(true);
    await this.save();
    this.setNote("Added the blocks this file was missing.");
  }

  /** A line in the file bar, gone again after a moment. */
  private setNote(text: string, clearAfterMs = 4000): void {
    this.note.textContent = text;
    if (this.noteTimer !== null) window.clearTimeout(this.noteTimer);
    this.noteTimer = null;
    if (!text || clearAfterMs <= 0) return;
    this.noteTimer = window.setTimeout(() => {
      this.note.textContent = "";
      this.noteTimer = null;
    }, clearAfterMs);
  }

  /**
   * Tell the docs panel where the caret is.
   *
   * Sent whether or not the panel is open: the web reference's button carries
   * the language of the file being edited, and it should be right by the time
   * anyone looks at it rather than one keystroke later.
   */
  private reportCursor(): void {
    if (!this.view) return;
    const head = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(head);
    this.docs.onCursor(line.text, head - line.from, this.openPath);
  }

  private setDirty(dirty: boolean): void {
    this.dirty = dirty;
    this.dirtyFlag.textContent = dirty ? "Unsaved" : "";
  }

  async save(): Promise<void> {
    if (!this.view || !this.openPath || !this.dirty) return;
    const path = this.openPath;
    try {
      await gameFiles.write(this.projectId, path, this.view.state.doc.toString());
      this.setDirty(false);
      log.info(`Saved ${path}`);
      // The shell's business, not this modal's: if the project is playing,
      // this is the point at which it restarts on the new code.
      this.onSaved(path);
    } catch (err) {
      log.error(`Could not save ${path}:`, err);
    }
  }

  destroy(): void {
    if (this.noteTimer !== null) window.clearTimeout(this.noteTimer);
    this.filesResizer.destroy();
    this.docsResizer?.destroy();
    this.docs.destroy();
    this.tree.destroy();
    this.view?.destroy();
    this.root.remove();
  }
}
