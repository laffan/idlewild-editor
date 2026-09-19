/**
 * The editor header.
 *
 * A real row above the canvas rather than chrome floating over it: it spans
 * the window edge to edge and stands the same height as the console bar at
 * the bottom, so the canvas sits between two rules instead of underneath a
 * hovering toolbar.
 *
 * The toggle carries the three things this editor is: **Draw**, the canvas;
 * **Code**, the project's own `game/` tree; **Play**, that code running over
 * the document. Code used to be a menu item that opened a panel, which made it
 * a thing you could be half in — the panel open behind a mode that did not know
 * about it. It is a section now, left to right in the order you work.
 *
 * Publish, Export Assets, Import Assets, Project Options and Page Setup stay in the
 * hamburger's menu. They are destinations rather than modes — you come back
 * from them to where you were — and folding them in leaves the header carrying
 * the project, undo and redo, and the mode it is in. Page Setup is the one
 * that comes and goes: a vanilla project has no scaffolded page for it to
 * describe, so on one it is not on the menu at all.
 *
 * Copy PSD and Paste Image are in there for a different reason: both have a
 * keyboard shortcut and neither has a keyboard on an iPad. They are the two
 * ends of one gesture, so they are listed as a pair and in the order they are
 * used.
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
  /** Import whatever image is on the clipboard, into the middle of the view. */
  onPasteImage: () => void;
  /** Put the selected PSD on the clipboard, so another project can paste it. */
  onCopyPsd: () => void;
  /** Send the site somewhere real — a repository, or a server. */
  onPublish: () => void;
  /** Hand back a file: the site as a zip, the project, or the artwork. */
  onExport: () => void;
  /** Artwork from the filesystem or from another project in this app. */
  onImportAssets: () => void;
  onOptions: () => void;
  /**
   * The HTML page around the game — absent on a project that has no such
   * page.
   *
   * A vanilla scaffold's `index.html` is the author's from the moment it is
   * written: there is no `js/main.js` reading the presentation out of the
   * config and no `styles.css` full of custom properties for it to set, so
   * every setting on that sheet would be a value nothing reads. The item is
   * withheld rather than shown doing nothing — see `header-wiring.ts`, which
   * is where the scaffold is known.
   */
  onPageSetup?: () => void;
}

/** The three sections, in the order the header offers them. */
const MODES: Array<{ value: EditorMode; label: string }> = [
  { value: "draw", label: "Draw" },
  { value: "code", label: "Code" },
  { value: "play", label: "Play" },
];

export class EditorHeader {
  readonly root: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly modeButtons = new Map<EditorMode, HTMLButtonElement>();
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

    const modeToggle = h("div", { class: "mode-toggle" });
    for (const { value, label } of MODES) {
      const button = h("button", {
        class: "mode-btn",
        text: label,
        "aria-pressed": String(value === "draw"),
        onClick: () => callbacks.onMode(value),
      }) as HTMLButtonElement;
      this.modeButtons.set(value, button);
      modeToggle.appendChild(button);
    }

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
      modeToggle,
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
    for (const [value, button] of this.modeButtons) {
      button.setAttribute("aria-pressed", String(value === mode));
    }
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
        // ⌘C and ⌘V do these two, on the machines that have a ⌘ — which an
        // iPad does not, and an iPad is what this editor is mostly used on.
        // Copy first, because the pair reads in the order it is used.
        {
          label: "Copy PSD",
          glyph: ICONS.copy,
          onSelect: callbacks.onCopyPsd,
        },
        {
          label: "Paste Image",
          glyph: ICONS.file,
          onSelect: callbacks.onPasteImage,
        },
        // **Two items, because they are two verbs.** Publish sends the site
        // somewhere real — a repository, a server — and is a destination you
        // set up once and then use. Export hands you a file and is a save
        // dialog. They were one item opening one sheet that asked both
        // questions in the same breath, and the answer to either has nothing
        // to do with the answer to the other.
        { label: "Publish", glyph: ICONS.publish, onSelect: callbacks.onPublish },
        // All three files that leave, under one item: the site as a zip, the
        // project as `.idlewild`, and the artwork on its own. Export Assets
        // used to stand on this menu in its own right, which put two of the
        // three exits in one place and the third somewhere else.
        {
          label: "Export",
          glyph: ICONS.image,
          onSelect: callbacks.onExport,
        },
        // The way artwork gets *in* other than one file at a time through Add
        // Image: several at once, off the filesystem or out of another project
        // in this app.
        {
          label: "Import Assets",
          glyph: ICONS.folder,
          onSelect: callbacks.onImportAssets,
        },
        {
          label: "Project Options",
          glyph: ICONS.sliders,
          onSelect: callbacks.onOptions,
        },
        // Beside it rather than inside it, because they are about two different
        // things: Project Options is how the canvas renders, and this is the
        // HTML page the exported game is embedded in. One reaches the editor's
        // own view; the other only ever shows up in Play and in an export.
        //
        // And absent altogether on a project whose scaffold writes no such
        // page — see `onPageSetup`.
        ...(callbacks.onPageSetup
          ? [
              {
                label: "Page Setup",
                glyph: ICONS.file,
                onSelect: callbacks.onPageSetup,
              },
            ]
          : []),
      ],
      () => {
        this.menu = null;
        this.menuButton.setAttribute("aria-expanded", "false");
      },
    );
  }
}
