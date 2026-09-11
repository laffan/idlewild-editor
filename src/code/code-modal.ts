/**
 * The Code modal: the file column and editor column of Phaser Bench, in a
 * dockable modal over the canvas.
 *
 * This pass ships the dock, the file tree and a working CodeMirror 6 editor
 * over the project's real `game/` tree. Phaser Bench's Phaser-aware
 * autocomplete and its live preview reload are the next increment; the spec
 * asks only for a dockable modal for now.
 *
 * Unpinned it covers the whole shell — a code editor wants the room, and the
 * canvas underneath is not what you are looking at while you are in it. Pin
 * is how you get both at once: it becomes a full-width row above the console,
 * resizable on the same divider, and the canvas keeps whatever is left. Where
 * it lives in the DOM is the editor shell's business, so pinning is reported
 * rather than acted on here.
 *
 * Docs opens a fourth region along the bottom, on a divider of its own: the
 * Phaser reference, MDN's, and the two written guides, following the caret
 * where they can. It is ported from phaser-bench, where it sits under the
 * editor for the same reason — the question "what does this method take?"
 * arrives while you are typing the method. See `docs/panel.ts`.
 *
 * Some of these lines are the editor's. A scaffolded file marks the runs it
 * maintains, and `managed-blocks.ts` works out line by line which of them are
 * still the editor's after everything that has been typed around them: those
 * are shown in their own colour, refuse to be edited, and carry a Reset that
 * puts the block back. The generated config is the whole-file case of the
 * same idea, and it is re-read whenever the document is saved so that what is
 * on screen is what the running game reads.
 */

import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html as htmlLang } from "@codemirror/lang-html";
import { css as cssLang } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { clear, h, ICONS, icon } from "../lib/dom";
import { gameFiles } from "../lib/ipc";
import * as log from "../lib/log";
import { FileTree } from "./file-tree";
import { DocsPanel } from "./docs/panel";
import { addMissingBlocks, isGenerated, resetBlock } from "./managed-blocks";
import { managedEdit, managedExtension } from "./managed-view";
import { createResizer, type Resizer } from "../editor/resizer";

const languageCompartment = new Compartment();

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
  private pinned = false;
  private readonly pinButton: HTMLButtonElement;
  private readonly docsButton: HTMLButtonElement;
  private readonly onPinChange: (pinned: boolean) => void;
  /** A file was written. The shell restarts a running game against it. */
  private readonly onSaved: (path: string) => void;
  /** Which open is the current one — see `openFile`. */
  private openToken = 0;
  private noteTimer: number | null = null;
  private readonly filesResizer: Resizer;
  private readonly docs = new DocsPanel();
  private readonly docsResizer: Resizer;
  private docsOpen = false;

  constructor(
    projectId: string,
    onClose: () => void,
    onPinChange: (pinned: boolean) => void,
    onSaved: (path: string) => void = () => {},
  ) {
    this.projectId = projectId;
    this.onPinChange = onPinChange;
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

    // The docs panel is a row of the modal like the console is a row of the
    // shell, and takes its height the same way — on a divider, remembered.
    this.docsResizer = createResizer({
      target: this.docs.root,
      axis: "height",
      edge: "start",
      min: 120,
      max: 620,
      storageKey: "codeDocsHeight",
    });
    this.docsResizer.handle.hidden = true;
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

    this.pinButton = h(
      "button",
      {
        class: "code-pin-btn",
        title: "Dock above the console",
        "aria-pressed": "false",
        onClick: () => this.setPinned(!this.pinned),
      },
      icon(ICONS.pin, 15),
      h("span", { text: "Pin" }),
    );

    const panel = h(
      "div",
      { class: "code-panel", onClick: (e: Event) => e.stopPropagation() },
      h(
        "div",
        { class: "code-head" },
        // Where the word "Code" and the project name used to sit. Neither
        // said anything the user did not already know — they opened this
        // modal from that project a moment ago — and the header is the one
        // full-width row in here, so it goes to the two actions the file
        // column needs and cannot fit above itself on an iPad.
        this.tree.controls,
        h(
          "div",
          { class: "code-head-right" },
          this.docsButton,
          this.pinButton,
          h(
            "button",
            { class: "icon-btn", title: "Close", onClick: onClose },
            icon(ICONS.close, 16),
          ),
        ),
      ),
      h(
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
          ),
        ),
      ),
      this.docsResizer.handle,
      this.docs.root,
    );

    this.root = h("div", { class: "code-backdrop" }, panel);
    this.filesResizer.restore();
    this.docsResizer.restore();
    void this.reloadFiles();
  }

  /** Dock it above the console, or float it back over the canvas. */
  setPinned(pinned: boolean): void {
    if (pinned === this.pinned) return;
    this.pinned = pinned;
    this.root.classList.toggle("docked", pinned);
    // Docked, the divider writes an inline height on this element. Floating,
    // the panel is `position: absolute; inset: 0` — and an absolutely
    // positioned box given top, bottom *and* a height is over-constrained, so
    // the browser drops `bottom` and the panel hangs from the top of the
    // shell at whatever height it was docked at. Unpinning therefore has to
    // take the docked height off again, or it does not look unpinned.
    if (!pinned) this.root.style.removeProperty("height");
    this.pinButton.setAttribute("aria-pressed", String(pinned));
    this.pinButton.title = pinned
      ? "Float over the canvas"
      : "Dock above the console";
    this.onPinChange(pinned);
  }

  get isPinned(): boolean {
    return this.pinned;
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
    this.docsResizer.handle.hidden = !open;
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

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void this.save();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        languageCompartment.of(languageFor(path)),
        oneDark,
        managedExtension({
          path,
          canonical,
          onReset: (blockId) => void this.reset(blockId),
          onRefused: () =>
            this.setNote("These lines are the editor's — Reset puts them back."),
          onMissing: (ids) => this.offerMissing(path, ids),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.setDirty(true);
          // Automatic mode is the docs panel following the caret, so it wants
          // every move of it — and a typed character moves it too.
          if (update.docChanged || update.selectionSet) this.reportCursor();
        }),
        EditorView.theme({
          "&": { height: "100%" },
          // The design system's code face, not CodeMirror's default stack.
          ".cm-content, .cm-gutters": {
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
          },
        }),
      ],
    });

    if (this.view) {
      this.view.setState(state);
    } else {
      this.view = new EditorView({ state, parent: this.editorHost });
    }
    // A new file is a new language as far as the reference is concerned, even
    // before the caret has moved in it.
    this.reportCursor();
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
    this.docsResizer.destroy();
    this.docs.destroy();
    this.tree.destroy();
    this.view?.destroy();
    this.root.remove();
  }
}

function languageFor(path: string) {
  if (path.endsWith(".html")) return htmlLang();
  if (path.endsWith(".css")) return cssLang();
  return javascript();
}
