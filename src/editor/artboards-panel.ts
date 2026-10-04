/**
 * A print project's artboards, in the left sidebar above Overlays.
 *
 * A print project used to have one page, the sheet it was made with. It has
 * artboards now — several sheets laid out on the one canvas, the way a drawing
 * app's artboards are — and `ExportForPrint()` captures all of them in one
 * call, each saved as `<name>-<artboard>`. The first artboard is the one the
 * game's screen is the size of and the camera stands on (see
 * `src-tauri/src/print_artboards.rs`); the others are captured by moving the
 * camera onto each in turn.
 *
 * This list is where they are made, picked, changed and taken away:
 *
 * - **a row** is an artboard, named and sized. Tapping it picks it — its frame
 *   on the canvas is drawn stronger — and brings the camera to it;
 * - **the pencil** opens Page Setup for that artboard: its name, its paper and
 *   which way round;
 * - **the cross** removes it, after asking; the last one cannot go;
 * - **Add artboard** puts a copy of the picked one to the right of everything
 *   else, so it never lands on top of a sheet already there.
 *
 * Moving one is done on the canvas, by dragging its label, as before.
 *
 * Folded or open is remembered per install, like the Overlays section below.
 */

import { confirmSheet } from "../lib/sheet";
import { h, ICONS, icon } from "../lib/dom";
import {
  currentArtboards,
  describePage,
  onPageChange,
  type PlacedArtboard,
} from "../lib/print";
import type { ProjectMeta } from "../lib/types";
import { changePage } from "./print-page";
import { openPrintSetup } from "./print-setup";

const STORAGE_KEY = "idlewild.artboards.open";

/** World points between a new artboard and the one to its left. */
export const ARTBOARD_GAP = 72;

export interface ArtboardsHost {
  /** Bring the camera to a point in the world. */
  centreOn: (x: number, y: number) => void;
  /** Tell the canvas which artboard is picked. */
  setActive: (id: string | null) => void;
}

/**
 * Where a new artboard goes: level with the top of the one it copies, a gap
 * to the right of the rightmost edge of any artboard.
 */
export function placeNewArtboard(
  boards: readonly PlacedArtboard[],
  from: PlacedArtboard,
): { x: number; y: number } {
  const right = Math.max(...boards.map((b) => b.x + b.width));
  return { x: Math.round(right + ARTBOARD_GAP), y: Math.round(from.y) };
}

export class ArtboardsPanel {
  readonly root: HTMLElement;
  private readonly meta: ProjectMeta;
  private readonly host: ArtboardsHost;
  private readonly list: HTMLElement;
  private picked: string | null = null;
  private open: boolean;
  private readonly stopListening: () => void;

  constructor(meta: ProjectMeta, host: ArtboardsHost) {
    this.meta = meta;
    this.host = host;
    this.open = readOpen();
    this.list = h("div", { class: "artboards-list" });
    const add = h(
      "button",
      {
        class: "overlays-row artboards-add",
        title: "A copy of the picked artboard, to the right of the rest",
        onClick: () => void this.add(),
      },
      h("span", { class: "artboards-add-icon" }, icon(ICONS.plus, 14)),
      h("span", { class: "overlays-name", text: "Add artboard" }),
    );
    this.root = h(
      "div",
      { class: "overlays artboards" },
      h(
        "button",
        {
          class: "overlays-head",
          title: "The sheets this project prints",
          onClick: () => this.setOpen(!this.open),
        },
        h("span", { class: "overlays-chevron" }, icon(ICONS.chevronDown, 14)),
        h("span", { class: "panel-title m", text: "Artboards" }),
      ),
      h("div", { class: "overlays-body" }, this.list, add),
    );
    this.stopListening = onPageChange(() => this.render());
    this.render();
  }

  destroy(): void {
    this.stopListening();
    this.root.remove();
  }

  /** Pick an artboard — from a row, or its label tapped on the canvas. */
  pick(id: string, centre = true): void {
    const board = currentArtboards().find((b) => b.id === id);
    if (!board) return;
    this.picked = id;
    this.host.setActive(id);
    if (centre) this.host.centreOn(board.x + board.width / 2, board.y + board.height / 2);
    this.render();
  }

  private render(): void {
    this.root.classList.toggle("closed", !this.open);
    const boards = currentArtboards();
    if (this.picked && !boards.some((b) => b.id === this.picked)) {
      this.picked = null;
      this.host.setActive(null);
    }
    this.list.replaceChildren(
      ...boards.map((board) => this.row(board, boards.length > 1)),
    );
  }

  private row(board: PlacedArtboard, removable: boolean): HTMLElement {
    const edit = h(
      "button",
      {
        class: "artboards-action",
        title: `Name and size ${board.name}`,
        "aria-label": `Edit ${board.name}`,
        onClick: (event: Event) => {
          event.stopPropagation();
          openPrintSetup(this.meta, board.id);
        },
      },
      icon(ICONS.pencil, 14),
    );
    const remove = h(
      "button",
      {
        class: "artboards-action",
        title: removable ? `Remove ${board.name}` : "A print project needs one artboard",
        "aria-label": `Remove ${board.name}`,
        disabled: !removable,
        onClick: (event: Event) => {
          event.stopPropagation();
          void this.remove(board);
        },
      },
      icon(ICONS.close, 14),
    );
    return h(
      "div",
      {
        class: `overlays-row artboards-row${board.id === this.picked ? " picked" : ""}`,
        role: "button",
        tabindex: "0",
        title: "Pick it, and go to it",
        onClick: () => this.pick(board.id),
      },
      h(
        "span",
        { class: "artboards-text" },
        h("span", { class: "overlays-name", text: board.name }),
        h("span", { class: "artboards-size", text: describePage(board) }),
      ),
      edit,
      remove,
    );
  }

  private async add(): Promise<void> {
    const boards = currentArtboards();
    if (boards.length === 0) return;
    const from = boards.find((b) => b.id === this.picked) ?? boards[boards.length - 1];
    await changePage({ add: true, artboard: from.id, ...placeNewArtboard(boards, from) });
    // A new artboard goes on the end of the list.
    const added = currentArtboards().at(-1);
    if (added && added.id !== from.id) this.pick(added.id);
  }

  private async remove(board: PlacedArtboard): Promise<void> {
    const sure = await confirmSheet(
      `Remove ${board.name}?`,
      "The artboard goes; nothing drawn on the canvas does.",
      "Remove",
    );
    if (sure) await changePage({ artboard: board.id, remove: true });
  }

  private setOpen(open: boolean): void {
    this.open = open;
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // The fold still works for this session.
    }
    this.render();
  }
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
