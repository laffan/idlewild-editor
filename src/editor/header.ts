/**
 * The editor header.
 *
 * A real row above the canvas rather than chrome floating over it: it spans
 * the window edge to edge and stands the same height as the console bar at
 * the bottom, so the canvas sits between two rules instead of underneath a
 * hovering toolbar.
 *
 * Code, Publish and Project Options live in the hamburger's menu. They are
 * destinations rather than tools — nothing about them is per-stroke — and
 * folding them in leaves the header carrying only the project, undo and redo,
 * and the Edit/Play mode it is in.
 *
 * Undo and redo sit next to that toggle rather than in the menu because they
 * are the two buttons an iPad needs most: ⌘Z wants a keyboard, and the device
 * this editor is mostly used on does not have one attached. Which history
 * they address — the document's or the code editor's — is `editor/history.ts`
 * business; the header only says whether either has anything to go back to.
 */

import { h, ICONS, icon } from "../lib/dom";
import { openMenu, type MenuHandle } from "../lib/menu";
import type { EditorMode } from "../lib/types";

export interface HeaderCallbacks {
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onMode: (mode: EditorMode) => void;
  onCode: () => void;
  /** Import whatever image is on the clipboard, into the middle of the view. */
  onPasteImage: () => void;
  onPublish: () => void;
  onOptions: () => void;
}

export class EditorHeader {
  readonly root: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly editButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private menu: MenuHandle | null = null;

  constructor(
    projectName: string,
    gridLabel: string,
    callbacks: HeaderCallbacks,
  ) {
    // `mousedown` is swallowed so the press does not move focus: which
    // history these two act on follows what was last focused, and a button
    // that stole the focus on the way down would always answer "the header".
    const keepFocus = (event: Event) => event.preventDefault();
    this.undoButton = h(
      "button",
      {
        class: "header-history",
        title: "Undo (⌘Z)",
        "aria-label": "Undo",
        disabled: "",
        onMouseDown: keepFocus,
        onClick: () => callbacks.onUndo(),
      },
      icon(ICONS.undo, 17),
    ) as HTMLButtonElement;
    this.redoButton = h(
      "button",
      {
        class: "header-history",
        title: "Redo (⇧⌘Z)",
        "aria-label": "Redo",
        disabled: "",
        onMouseDown: keepFocus,
        onClick: () => callbacks.onRedo(),
      },
      icon(ICONS.redo, 17),
    ) as HTMLButtonElement;

    this.editButton = h("button", {
      class: "mode-btn",
      text: "Edit",
      "aria-pressed": "true",
      onClick: () => callbacks.onMode("edit"),
    });
    this.playButton = h("button", {
      class: "mode-btn",
      text: "Play",
      "aria-pressed": "false",
      onClick: () => callbacks.onMode("play"),
    });

    this.menuButton = h(
      "button",
      {
        class: "header-menu",
        title: "Menu",
        "aria-label": "Menu",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onClick: () => this.toggleMenu(callbacks),
      },
      icon(ICONS.menu, 18),
    );

    this.root = h(
      "header",
      { class: "editor-header" },
      h(
        "button",
        { class: "icon-btn", title: "All projects", onClick: callbacks.onBack },
        icon(ICONS.chevronLeft, 17),
      ),
      h("div", { class: "header-name", text: projectName }),
      h("div", { class: "header-grid m", text: gridLabel }),
      h("div", { class: "header-spacer" }),
      h("div", { class: "header-history-pair" }, this.undoButton, this.redoButton),
      h("div", { class: "mode-toggle" }, this.editButton, this.playButton),
      this.menuButton,
    );
  }

  /**
   * Whether either button has anything to do, and what it would go back to.
   *
   * `what` names the surface the press would reach — "the canvas" or the open
   * file — because with the code panel pinned both are on screen at once and
   * a button that silently addressed the other one would be a trap.
   */
  setHistory(canUndo: boolean, canRedo: boolean, what: string): void {
    this.undoButton.disabled = !canUndo;
    this.redoButton.disabled = !canRedo;
    this.undoButton.title = `Undo in ${what} (⌘Z)`;
    this.redoButton.title = `Redo in ${what} (⇧⌘Z)`;
  }

  setMode(mode: EditorMode): void {
    this.editButton.setAttribute("aria-pressed", String(mode === "edit"));
    this.playButton.setAttribute("aria-pressed", String(mode === "play"));
  }

  /** The menu outlives the header's own DOM, so leaving tears it down. */
  destroy(): void {
    this.menu?.close();
  }

  private toggleMenu(callbacks: HeaderCallbacks): void {
    if (this.menu) {
      this.menu.close();
      return;
    }

    this.menuButton.setAttribute("aria-expanded", "true");
    this.menu = openMenu(
      this.menuButton,
      [
        { label: "Code", glyph: ICONS.code, onSelect: callbacks.onCode },
        // ⌘V does this too, on the machines that have a ⌘ — which an iPad
        // does not, and an iPad is what this editor is mostly used on.
        {
          label: "Paste Image",
          glyph: ICONS.file,
          onSelect: callbacks.onPasteImage,
        },
        { label: "Publish", glyph: ICONS.publish, onSelect: callbacks.onPublish },
        {
          label: "Project Options",
          glyph: ICONS.sliders,
          onSelect: callbacks.onOptions,
        },
      ],
      () => {
        this.menu = null;
        this.menuButton.setAttribute("aria-expanded", "false");
      },
    );
  }
}
