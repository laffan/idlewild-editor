/**
 * The code modal's file column: the project's real `game/` tree, and the
 * things you do to it.
 *
 * Split from the modal because it grew a life of its own — creating,
 * renaming, copying, deleting and dragging are five operations with the same
 * shape, and the modal's job is the editor beside them.
 *
 * Dragging uses pointer events rather than HTML5 drag-and-drop, for the same
 * reason the layer panel does: the iPad is a first-class target and
 * `dragstart` never fires for touch. Using them costs the one thing HTML5 drag
 * gives for free, which is the picture under the pointer, so this draws its
 * own: a **ghost** of the row follows the finger, carrying the name being moved
 * and, after an arrow, the folder it would land in.
 *
 * Unlike the layer panel the rows do *not* rearrange as the drag goes — a file
 * tree has one legal drop per row (into that folder, or into the folder holding
 * that file) rather than a position in a list. So the destination is said three
 * ways instead: the row being dragged dims, the destination folder's row lights
 * up — or the whole column does, for the tree's own root — and the ghost names
 * it. None of them is a guess: every one is read from the same `dropTarget`
 * that the release will use.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { gameFiles } from "../lib/ipc";
import type { GameFile } from "../lib/ipc";
import { openMenu } from "../lib/menu";
import { confirmSheet, promptSheet } from "../lib/sheet";
import * as log from "../lib/log";

export interface FileTreeCallbacks {
  /** A file was picked. */
  onOpen: (path: string) => void;
  /** The tree changed under an open file — it may have moved or gone. */
  onMoved: (from: string, to: string) => void;
  onRemoved: (path: string) => void;
}

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 6;

export class FileTree {
  readonly root: HTMLElement;
  /**
   * New File and New Folder, as a row the modal mounts where it likes.
   *
   * They belong to the tree — they create into it, and they read which file
   * is open to decide where — but they are shown in the modal's header rather
   * than above the column, which on an iPad is the difference between two
   * rows of chrome and one.
   */
  readonly controls: HTMLElement;

  private readonly projectId: string;
  private readonly callbacks: FileTreeCallbacks;
  private readonly list: HTMLElement;
  private files: GameFile[] = [];
  private openPath: string | null = null;
  private drag: { path: string; isDir: boolean; release: () => void } | null = null;
  /** The row under the pointer while a drag is on — see `beginDrag`. */
  private ghost: HTMLElement | null = null;
  private ghostTarget: HTMLElement | null = null;

  constructor(projectId: string, callbacks: FileTreeCallbacks) {
    this.projectId = projectId;
    this.callbacks = callbacks;

    this.list = h("div", { class: "code-files scroll" });
    this.controls = h(
      "div",
      { class: "code-new-row" },
      h(
        "button",
        {
          class: "code-new",
          title: "New file",
          onClick: () => void this.create(false),
        },
        icon(ICONS.file, 14),
        h("span", { text: "New File" }),
      ),
      h(
        "button",
        {
          class: "code-new",
          title: "New folder",
          onClick: () => void this.create(true),
        },
        icon(ICONS.folder, 14),
        h("span", { text: "New Folder" }),
      ),
    );
    this.root = h("div", { class: "code-column" }, this.list);
  }

  /** Which file the editor is showing, so the row can say so. */
  setOpen(path: string | null): void {
    this.openPath = path;
    this.render();
  }

  async reload(): Promise<GameFile[]> {
    try {
      this.files = await gameFiles.list(this.projectId);
    } catch (err) {
      log.error("Could not list project files:", err);
      this.files = [];
    }
    this.render();
    return this.files;
  }

  destroy(): void {
    // Through `endDrag`, because a ghost lives on `document.body`: the column
    // going away would otherwise leave it on screen with nothing holding it.
    if (this.drag) this.endDrag();
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    clear(this.list);
    for (const file of this.files) this.list.appendChild(this.row(file));
  }

  private row(file: GameFile): HTMLElement {
    const depth = file.path.split("/").length - 1;
    const name = basename(file.path);
    const classes = ["code-file"];
    if (file.isDir) classes.push("dir");
    if (file.path === this.openPath) classes.push("active");

    const row = h(
      "div",
      {
        class: classes.join(" "),
        dataset: { path: file.path, dir: String(file.isDir) },
        style: { paddingLeft: `${12 + depth * 14}px` },
        onPointerDown: (event: PointerEvent) => this.beginDrag(event, file),
        onClick: () => {
          if (!file.isDir) this.callbacks.onOpen(file.path);
        },
      },
      icon(file.isDir ? ICONS.folder : ICONS.file, 14),
      h("span", { class: "code-file-name", text: name }),
    );

    row.appendChild(
      h(
        "button",
        {
          class: "code-file-menu",
          title: `Options for ${name}`,
          "aria-label": `Options for ${name}`,
          "aria-haspopup": "menu",
          onPointerDown: (event: Event) => event.stopPropagation(),
          onClick: (event: Event) => {
            event.stopPropagation();
            this.openRowMenu(event.currentTarget as HTMLElement, file);
          },
        },
        icon(ICONS.menu, 14),
      ),
    );
    return row;
  }

  private openRowMenu(anchor: HTMLElement, file: GameFile): void {
    openMenu(anchor, [
      {
        label: "Rename…",
        glyph: ICONS.rename,
        onSelect: () => void this.rename(file),
      },
      {
        label: "Duplicate",
        glyph: ICONS.copy,
        onSelect: () => void this.duplicate(file),
      },
      {
        label: "Delete",
        glyph: ICONS.trash,
        onSelect: () => void this.remove(file),
      },
    ]);
  }

  // ── operations ────────────────────────────────────────────────────────────

  /** New files land beside whatever is open, which is where you want them. */
  private async create(isDir: boolean): Promise<void> {
    const parent = this.openPath ? dirname(this.openPath) : "";
    const suggested = isDir ? "new-folder" : "new-file.js";
    const name = await promptSheet({
      title: isDir ? "New folder" : "New file",
      label: "Path inside game/",
      value: parent ? `${parent}/${suggested}` : suggested,
      light: false,
    });
    if (!name) return;

    try {
      if (isDir) await gameFiles.createDir(this.projectId, name);
      else await gameFiles.createFile(this.projectId, name);
      await this.reload();
      if (!isDir) this.callbacks.onOpen(name);
    } catch (err) {
      log.error(`Could not create ${name}:`, err);
    }
  }

  private async rename(file: GameFile): Promise<void> {
    const next = await promptSheet({
      title: `Rename ${basename(file.path)}`,
      label: "Path inside game/",
      value: file.path,
      confirmLabel: "Rename",
      light: false,
    });
    if (!next || next === file.path) return;
    try {
      await gameFiles.move(this.projectId, file.path, next);
      await this.reload();
      this.callbacks.onMoved(file.path, next);
    } catch (err) {
      log.error(`Could not rename ${file.path}:`, err);
    }
  }

  private async duplicate(file: GameFile): Promise<void> {
    try {
      const copy = await gameFiles.copy(this.projectId, file.path);
      await this.reload();
      log.info(`Copied ${file.path} to ${copy}`);
    } catch (err) {
      log.error(`Could not copy ${file.path}:`, err);
    }
  }

  private async remove(file: GameFile): Promise<void> {
    const what = file.isDir ? "the folder and everything in it" : "the file";
    const sure = await confirmSheet(
      `Delete ${basename(file.path)}?`,
      `${file.path} — ${what} goes for good.`,
      "Delete",
      false,
    );
    if (!sure) return;
    try {
      await gameFiles.remove(this.projectId, file.path);
      await this.reload();
      this.callbacks.onRemoved(file.path);
    } catch (err) {
      log.error(`Could not delete ${file.path}:`, err);
    }
  }

  // ── dragging ──────────────────────────────────────────────────────────────

  /**
   * Follow the gesture on `window`, as the layer panel does: a re-render mid
   * drag takes the row out of the document, and pointer capture goes with it.
   */
  private beginDrag(event: PointerEvent, file: GameFile): void {
    if (this.drag) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let armed = false;

    const onMove = (moved: PointerEvent) => {
      if (moved.pointerId !== event.pointerId) return;
      if (
        !armed &&
        Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      // A press that never travels is a click, so the drag only starts once
      // the pointer has actually gone somewhere.
      if (!armed) {
        armed = true;
        this.list.classList.add("dragging");
        rowFor(this.list, file.path)?.classList.add("dragged");
        this.showGhost(file);
      }
      moved.preventDefault();
      const target = this.dropTarget(moved.clientX, moved.clientY);
      this.highlight(target);
      this.moveGhost(moved.clientX, moved.clientY, target);
    };

    const onUp = (ended: PointerEvent) => {
      if (ended.pointerId !== event.pointerId) return;
      const target = armed ? this.dropTarget(ended.clientX, ended.clientY) : null;
      this.endDrag();
      if (target !== null) void this.moveInto(file, target);
    };

    const release = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    this.drag = { path: file.path, isDir: file.isDir, release };
  }

  private endDrag(): void {
    this.drag?.release();
    this.drag = null;
    this.list.classList.remove("dragging", "drop-root");
    for (const el of this.list.querySelectorAll(".dragged, .drop-into")) {
      el.classList.remove("dragged", "drop-into");
    }
    this.ghost?.remove();
    this.ghost = null;
    this.ghostTarget = null;
  }

  /**
   * The picture that follows the pointer.
   *
   * On `document.body` rather than inside the column, because the column
   * scrolls and clips and a ghost that disappeared at its edge would be worse
   * than none. Inert to pointers, or it would be the thing under the finger
   * and `dropTarget` would never see a row.
   */
  private showGhost(file: GameFile): void {
    // Not the uppercase micro-label the rest of the chrome uses: this is a
    // path, and a path that reads JS/SHARED is a path you would not type.
    this.ghostTarget = h("span", { class: "code-ghost-target" });
    this.ghost = h(
      "div",
      { class: "code-drag-ghost" },
      icon(file.isDir ? ICONS.folder : ICONS.file, 14),
      h("span", { class: "code-ghost-name", text: basename(file.path) }),
      this.ghostTarget,
    );
    document.body.appendChild(this.ghost);
  }

  /**
   * Move it, and say where the drop would go.
   *
   * Below and right of the pointer, so on a touchscreen the name is not under
   * the finger holding it. The destination is the same answer the release will
   * use: a folder's path, the root, or nothing at all outside the column —
   * which is a drag that would be cancelled, and says so.
   */
  private moveGhost(x: number, y: number, target: string | null): void {
    if (!this.ghost || !this.ghostTarget) return;
    this.ghost.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
    this.ghostTarget.textContent =
      target === null ? "release to cancel" : `→ ${target || "game/"}`;
    this.ghost.classList.toggle("outside", target === null);
  }

  /**
   * The folder under the pointer, as a path — `""` for the tree's own root.
   * Null when the pointer is outside the column, which cancels the drop.
   *
   * A file under the pointer means its folder: dropping *onto* a file is
   * how everyone expects to say "next to this one".
   */
  private dropTarget(clientX: number, clientY: number): string | null {
    const box = this.root.getBoundingClientRect();
    if (
      clientX < box.left ||
      clientX > box.right ||
      clientY < box.top ||
      clientY > box.bottom
    ) {
      return null;
    }

    for (const el of this.list.children) {
      if (!(el instanceof HTMLElement)) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const path = el.dataset.path ?? "";
      return el.dataset.dir === "true" ? path : dirname(path);
    }
    // Past the last row: the root.
    return "";
  }

  private highlight(target: string | null): void {
    for (const el of this.list.querySelectorAll(".drop-into")) {
      el.classList.remove("drop-into");
    }
    if (target) rowFor(this.list, target)?.classList.add("drop-into");
    this.list.classList.toggle("drop-root", target === "");
  }

  private async moveInto(file: GameFile, folder: string): Promise<void> {
    const name = basename(file.path);
    const to = folder ? `${folder}/${name}` : name;
    if (to === file.path) return;
    // Rust refuses this too, but saying it here explains the no-op rather
    // than logging an error for a gesture that was merely pointless.
    if (file.isDir && `${folder}/`.startsWith(`${file.path}/`)) {
      log.warn(`${file.path} cannot go inside itself`);
      return;
    }

    try {
      await gameFiles.move(this.projectId, file.path, to);
      await this.reload();
      this.callbacks.onMoved(file.path, to);
    } catch (err) {
      log.error(`Could not move ${file.path}:`, err);
    }
  }
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function rowFor(list: HTMLElement, path: string): HTMLElement | null {
  for (const el of list.children) {
    if (el instanceof HTMLElement && el.dataset.path === path) return el;
  }
  return null;
}
