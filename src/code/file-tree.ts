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

/**
 * Which folders are shut, remembered per install.
 *
 * Paths rather than ids, and not scoped to a project: `js/shared` means the
 * same thing in every project this editor makes, and a tree that reopens
 * everything each time you leave Code mode — which now takes the panel down —
 * would be a tree nobody bothers to fold.
 */
const COLLAPSED_KEY = "idlewild.code.collapsed";

export class FileTree {
  readonly root: HTMLElement;
  private readonly projectId: string;
  private readonly callbacks: FileTreeCallbacks;
  private readonly list: HTMLElement;
  private files: GameFile[] = [];
  private openPath: string | null = null;
  private drag: { path: string; isDir: boolean; release: () => void } | null = null;
  /** The folders that are shut. Read once, written on every fold. */
  private readonly collapsed = readCollapsed();
  /** The row under the pointer while a drag is on — see `beginDrag`. */
  private ghost: HTMLElement | null = null;
  private ghostTarget: HTMLElement | null = null;

  constructor(projectId: string, callbacks: FileTreeCallbacks) {
    this.projectId = projectId;
    this.callbacks = callbacks;

    this.list = h("div", { class: "code-files scroll" });
    // New File and New Folder, over the column they create into. They read
    // which file is open to decide where, so they belong to the tree — and
    // they used to sit in the modal's head, which put them a long way from
    // the thing they make.
    const controls = h(
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
    this.root = h("div", { class: "code-column" }, controls, this.list);
  }

  /**
   * Which file the editor is showing, so the row can say so — and so the
   * folders above it are open. A file opened from a console line is a file
   * nobody navigated to, and it should still be findable in the column.
   */
  setOpen(path: string | null): void {
    this.openPath = path;
    if (path) this.reveal(path);
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
    for (const file of this.files) {
      if (this.hidden(file.path)) continue;
      this.list.appendChild(this.row(file));
    }
  }

  /** Whether some folder above this path is shut. */
  private hidden(path: string): boolean {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (this.collapsed.has(parts.slice(0, i).join("/"))) return true;
    }
    return false;
  }

  /** Whether a folder has anything in it, which decides whether it folds. */
  private holds(path: string): boolean {
    return this.files.some((file) => file.path.startsWith(`${path}/`));
  }

  /**
   * Fold a folder, or unfold it.
   *
   * The rows under it are simply not rendered — the list is flat and sorted,
   * so "inside" is a prefix — and the choice is remembered per install.
   */
  private toggleFolder(path: string): void {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    writeCollapsed(this.collapsed);
    this.render();
  }

  /** Open every folder above a path, so the row is there to be seen. */
  private reveal(path: string): void {
    const parts = path.split("/");
    let changed = false;
    for (let i = 1; i < parts.length; i++) {
      changed = this.collapsed.delete(parts.slice(0, i).join("/")) || changed;
    }
    if (changed) writeCollapsed(this.collapsed);
  }

  private row(file: GameFile): HTMLElement {
    const depth = file.path.split("/").length - 1;
    const name = basename(file.path);
    const folds = file.isDir && this.holds(file.path);
    const shut = this.collapsed.has(file.path);
    const classes = ["code-file"];
    if (file.isDir) classes.push("dir");
    if (file.path === this.openPath) classes.push("active");
    if (folds && shut) classes.push("shut");

    const row = h(
      "div",
      {
        class: classes.join(" "),
        dataset: { path: file.path, dir: String(file.isDir) },
        style: { paddingLeft: `${12 + depth * 14}px` },
        onPointerDown: (event: PointerEvent) => this.beginDrag(event, file),
        onClick: () => {
          if (file.isDir) {
            if (folds) this.toggleFolder(file.path);
          } else {
            this.callbacks.onOpen(file.path);
          }
        },
      },
      // A chevron only where there is something to fold: an empty folder that
      // offered one would be a control that does nothing.
      folds
        ? icon(shut ? ICONS.chevronRight : ICONS.chevronDown, 12)
        : h("span", { class: "code-file-gap" }),
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
      this.reveal(name);
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
      // Dropping into a folder that is shut would otherwise look like the file
      // going nowhere — so the destination opens to show where it went.
      if (folder) this.collapsed.delete(folder);
      this.reveal(to);
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

/**
 * The shut folders, as they were left.
 *
 * A per-viewer convenience like every other layout memory in this editor, so
 * localStorage rather than the document — and a bad read is simply "nothing is
 * folded", which is the state the tree has always opened in.
 */
function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((path): path is string => typeof path === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(paths: Set<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...paths]));
  } catch {
    // Private browsing, or a quota. It still folds for this session.
  }
}
