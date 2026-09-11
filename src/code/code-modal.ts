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
 */

import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html as htmlLang } from "@codemirror/lang-html";
import { css as cssLang } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { h, ICONS, icon } from "../lib/dom";
import { gameFiles } from "../lib/ipc";
import * as log from "../lib/log";
import { FileTree } from "./file-tree";
import { DocsPanel } from "./docs/panel";
import { createResizer, type Resizer } from "../editor/resizer";

const languageCompartment = new Compartment();

export class CodeModal {
  readonly root: HTMLElement;
  private readonly projectId: string;
  private readonly tree: FileTree;
  private readonly filename: HTMLElement;
  private readonly dirtyFlag: HTMLElement;
  private readonly editorHost: HTMLElement;
  private view: EditorView | null = null;
  private openPath: string | null = null;
  private dirty = false;
  private pinned = false;
  private readonly pinButton: HTMLButtonElement;
  private readonly docsButton: HTMLButtonElement;
  private readonly onPinChange: (pinned: boolean) => void;
  private readonly filesResizer: Resizer;
  private readonly docs = new DocsPanel();
  private readonly docsResizer: Resizer;
  private docsOpen = false;

  constructor(
    projectId: string,
    onClose: () => void,
    onPinChange: (pinned: boolean) => void,
  ) {
    this.projectId = projectId;
    this.onPinChange = onPinChange;
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
          h("div", { class: "code-bar" }, this.filename, this.dirtyFlag),
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

    let content = "";
    try {
      content = await gameFiles.read(this.projectId, path);
    } catch (err) {
      log.error(`Could not open ${path}:`, err);
      return;
    }

    this.openPath = path;
    this.filename.textContent = path;
    this.setDirty(false);
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
    try {
      await gameFiles.write(
        this.projectId,
        this.openPath,
        this.view.state.doc.toString(),
      );
      this.setDirty(false);
      log.info(`Saved ${this.openPath}`);
    } catch (err) {
      log.error(`Could not save ${this.openPath}:`, err);
    }
  }

  destroy(): void {
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
