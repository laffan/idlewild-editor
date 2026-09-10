/**
 * The Code modal: the file column and editor column of Phaser Bench, in a
 * dockable modal over the canvas.
 *
 * This pass ships the dock, the file tree and a working CodeMirror 6 editor
 * over the project's real `game/` tree. Phaser Bench's Phaser-aware
 * autocomplete and its live preview reload are the next increment; the spec
 * asks only for a dockable modal for now.
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
import type { GameFile } from "../lib/ipc";
import * as log from "../lib/log";

const languageCompartment = new Compartment();

export class CodeModal {
  readonly root: HTMLElement;
  private readonly projectId: string;
  private readonly fileList: HTMLElement;
  private readonly filename: HTMLElement;
  private readonly dirtyFlag: HTMLElement;
  private readonly editorHost: HTMLElement;
  private view: EditorView | null = null;
  private openPath: string | null = null;
  private dirty = false;
  private pin: "left" | "right" = "right";

  constructor(projectId: string, projectName: string, onClose: () => void) {
    this.projectId = projectId;
    this.fileList = h("div", { class: "code-files scroll" });
    this.filename = h("div", { class: "code-filename m", text: "No file open" });
    this.dirtyFlag = h("div", { class: "code-dirty m" });
    this.editorHost = h("div", { class: "code-editor" });

    const panel = h(
      "div",
      { class: "code-panel", onClick: (e: Event) => e.stopPropagation() },
      h(
        "div",
        { class: "code-head" },
        h("div", { class: "code-title", text: "Code" }),
        h("div", { class: "code-project m", text: projectName }),
        h(
          "div",
          { class: "code-head-right" },
          h("div", { class: "m", text: "Pin" }),
          h(
            "div",
            { class: "code-pin" },
            pinButton("left", () => this.setPin("left")),
            pinButton("right", () => this.setPin("right")),
          ),
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
        this.fileList,
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
    );

    this.root = h("div", { class: "code-backdrop pin-right" }, panel);
    void this.reloadFiles();
  }

  private setPin(side: "left" | "right"): void {
    this.pin = side;
    this.root.classList.toggle("pin-left", side === "left");
    this.root.classList.toggle("pin-right", side === "right");
  }

  get pinnedTo(): "left" | "right" {
    return this.pin;
  }

  private async reloadFiles(): Promise<void> {
    let files: GameFile[] = [];
    try {
      files = await gameFiles.list(this.projectId);
    } catch (err) {
      log.error("Could not list project files:", err);
      return;
    }

    clear(this.fileList);
    for (const file of files) {
      const depth = file.path.split("/").length - 1;
      const name = file.path.split("/").pop() ?? file.path;
      this.fileList.appendChild(
        h(
          "div",
          {
            class: file.isDir ? "code-file dir" : "code-file",
            style: { paddingLeft: `${16 + depth * 14}px` },
            onClick: () => {
              if (!file.isDir) void this.openFile(file.path);
            },
          },
          icon(file.isDir ? ICONS.folder : ICONS.file, 14),
          h("span", { text: name }),
        ),
      );
    }

    const first = files.find((f) => !f.isDir && f.path.endsWith("WorldScene.js"));
    if (first) void this.openFile(first.path);
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

    for (const el of this.fileList.querySelectorAll(".code-file")) {
      el.classList.toggle("active", el.textContent?.trim() === path.split("/").pop());
    }

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
        }),
        EditorView.theme({ "&": { height: "100%" } }),
      ],
    });

    if (this.view) {
      this.view.setState(state);
    } else {
      this.view = new EditorView({ state, parent: this.editorHost });
    }
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
    this.view?.destroy();
    this.root.remove();
  }
}

function pinButton(side: "left" | "right", onClick: () => void): HTMLElement {
  const left = side === "left";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  for (const [x, dim] of [
    [3, left],
    [13, !left],
  ] as Array<[number, boolean]>) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", "4");
    rect.setAttribute("width", "8");
    rect.setAttribute("height", "16");
    if (!dim) rect.setAttribute("stroke-opacity", "0.4");
    svg.appendChild(rect);
  }
  return h(
    "button",
    { class: "code-pin-btn", title: `Pin ${side}`, onClick },
    svg,
  );
}

function languageFor(path: string) {
  if (path.endsWith(".html")) return htmlLang();
  if (path.endsWith(".css")) return cssLang();
  return javascript();
}
