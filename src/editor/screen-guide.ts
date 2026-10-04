/**
 * Where the game's screen falls on the editor's canvas: the origin, and the
 * boundary around it.
 *
 * The canvas is effectively infinite and the lattice is recomputed from the
 * camera, so there is nothing on it that says *where* anything is — no edge to
 * hit, no corner to measure from. Two things about the **game** are therefore
 * invisible while you are drawing, and both of them decide what a player sees:
 * world `0, 0`, which is the one fixed point every coordinate in the document
 * is counted from, and how much world fits on the screen the game opens at.
 * Drawing a building at the origin and finding it half off the edge in Play is
 * the ordinary way to learn the second one.
 *
 * So: a red crosshair on the origin, and a dashed red rectangle around the
 * screen the game opens at. Both are in Draw and nowhere else — in Code and
 * Play the canvas is behind a running game, where the real screen is the thing
 * in front of you.
 *
 * **It is a div, not paint**, which is the bargain the minimap's camera frame
 * strikes for the same reasons. A mark drawn into the scene would be baked
 * into the project's thumbnail, which `game/snapshot.ts` takes off the live
 * renderer — a dashed red box across every card on the home screen. It would
 * also have to be re-stroked at `1 / zoom` on every zoom, the way every other
 * overlay on that canvas is, where a CSS hairline is one screen pixel by
 * definition. Two absolutely-positioned elements moved with a transform cost
 * the main thread nothing per frame and the renderer nothing at all.
 *
 * **The size is the row's, not the canvas's.** Play takes both sidebars down,
 * so the game gets the whole of `.editor-main` — measuring the canvas in front
 * of you would draw the boundary at whatever width the sidebars happen to be
 * leaving, which is the one width the game never has. The project's scale mode
 * is `Phaser.Scale.RESIZE` (`templates/common/js/main.js`), so that row *is*
 * the game's viewport: there is no fixed design size to draw instead.
 */

import { h } from "../lib/dom";
import { currentArtboards, describePage, onPageChange, type PlacedArtboard } from "../lib/print";
import { changePage } from "./print-page";
import type { Viewport } from "../drawing";
import type { Presentation } from "../lib/types";

/** A box in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** Where the two marks go, in CSS pixels from the canvas's top-left corner. */
export interface GuideBox {
  /** The world origin on screen. The crosshair is centred here. */
  x: number;
  y: number;
  /** The game's screen at this camera's zoom, centred on that same point. */
  frame: { x: number; y: number; width: number; height: number };
}

/**
 * The two marks, from the camera and the game's own two numbers.
 *
 * The frame is **centred on the origin** rather than hung off one of its
 * corners. A scene has no top-left: cells count in both directions from the
 * origin, a fresh camera centres on it, and Project Options' default zoom
 * scales what the game shows about the middle of its screen. So the honest
 * statement is *this much world, around here* — how much fits, not where the
 * game's camera will be standing, which a character with `startFollow` on it
 * decides a frame after boot.
 *
 * When the camera is at the project's default zoom the two zooms cancel and
 * the box is drawn at `screen` exactly — the game's window, life size, on the
 * canvas you are drawing on.
 */
export function guideBox(
  view: Viewport,
  screen: Size,
  gameZoom: number,
): GuideBox {
  // A zoom of zero or less is a corrupt option rather than a camera, and it
  // would put the frame at an infinite width. 1× is what the game itself
  // falls back to — `config.zoom ?? 1` in the template's `applyCamera`.
  const scale = view.zoom / (gameZoom > 0 ? gameZoom : 1);
  const x = -view.originX * view.zoom;
  const y = -view.originY * view.zoom;
  const width = screen.width * scale;
  const height = screen.height * scale;
  return { x, y, frame: { x: x - width / 2, y: y - height / 2, width, height } };
}

/**
 * Where a print project's sheet falls on the canvas.
 *
 * Not centred, and not scaled by any zoom but the camera's: a page is a fixed
 * rectangle of world — its top-left corner on the origin, one point to the
 * world pixel — and the game that prints it looks at it at 1×. So the dashes
 * are the sheet itself, and the crosshair sits on its corner.
 */
export function pageBox(
  view: Viewport,
  page: Size & { x?: number; y?: number },
): GuideBox {
  const x = -view.originX * view.zoom;
  const y = -view.originY * view.zoom;
  return {
    x,
    y,
    frame: {
      x: ((page.x ?? 0) - view.originX) * view.zoom,
      y: ((page.y ?? 0) - view.originY) * view.zoom,
      width: page.width * view.zoom,
      height: page.height * view.zoom,
    },
  };
}

export interface ScreenGuideConfig {
  /**
   * The row a running game fills — `.editor-main`, from `shell.ts`. Its
   * content box is the game's viewport; see the note at the top of this file
   * for why it is not the canvas's.
   */
  main: HTMLElement;
  /**
   * The zoom the game's camera opens at. Read through rather than handed
   * over: Project Options changes it under a running editor.
   */
  defaultZoom: () => number;
  /**
   * The page around the game — Page Setup. A fixed size makes the game's
   * screen that box, whatever the row is; a margin takes that much off each
   * side of the row. Read through, like the zoom, because Page Setup changes
   * it under a running editor.
   */
  presentation?: () => Presentation;
  /** An artboard's label was tapped rather than dragged. */
  onPickArtboard?: (id: string) => void;
}

/**
 * The game's screen, from the row it would fill and the page around it.
 *
 * A fixed-size game is FIT against its own width and height
 * (`templates/common/js/main.js`), so the world it shows is that box however
 * big the window is. A game filling the window is RESIZE in whatever the
 * margin leaves of the row.
 */
export function gameScreen(row: Size, page?: Presentation): Size {
  if (page?.fixed && page.width > 0 && page.height > 0) {
    return { width: page.width, height: page.height };
  }
  const margin = Math.max(0, page?.margin ?? 0);
  return {
    width: Math.max(1, row.width - margin * 2),
    height: Math.max(1, row.height - margin * 2),
  };
}

export class ScreenGuide {
  readonly root: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly config: ScreenGuideConfig;
  private readonly observer: ResizeObserver;
  /** The game's viewport, kept by the observer rather than measured per frame. */
  private screen: Size | null = null;
  private view: Viewport | null = null;
  /** False once both marks are switched off — see `setMarksVisible`. */
  private showing = true;
  /** Whether the frames themselves are wanted — the Boundary switch. */
  private framesOn = true;
  /** A print project's artboards, one frame each, inside the guide. */
  private readonly boards: HTMLElement;
  /**
   * A print project's labels — each artboard's name and size, and the handle
   * it is dragged by.
   *
   * A layer of their own beside the guide rather than inside it. The guide is
   * a mark that takes no pointer and sits under the ink's sheet, and a handle
   * has to be reachable; so the labels go over the ink — but **under** the
   * tool rail and the floating bars. The layer shares the rail's z-index and
   * is the canvas wrapper's *first* child, so the tie goes to the rail, which
   * comes later: a label dragged into the corner slides under the tools
   * rather than over them.
   */
  private readonly labels: HTMLElement;
  /** The artboard being dragged, and by how many world pixels. */
  private drag: { id: string; dx: number; dy: number } | null = null;
  /** The artboard picked in the Artboards list, drawn a little stronger. */
  private active: string | null = null;
  private readonly stopListening: () => void;

  constructor(config: ScreenGuideConfig) {
    this.config = config;
    this.frame = h("div", { class: "screen-guide-frame" });
    this.cross = h("div", { class: "screen-guide-cross" });
    this.boards = h("div", { class: "screen-guide-boards" });
    this.root = h("div", { class: "screen-guide" }, this.frame, this.boards, this.cross);
    this.labels = h("div", { class: "screen-guide-labels" });
    // The sheet changes from Page Setup, the Artboards list and a label's own
    // drag once it is written: either way, draw what is there now.
    this.stopListening = onPageChange(() => this.draw());

    // The content box, which is what `contentRect` already is: the row pads
    // itself out of the iPad's side safe areas, and a game does not get those.
    this.observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      this.screen = { width: rect.width, height: rect.height };
      this.draw();
    });
    this.observer.observe(config.main);
  }

  /**
   * Which of the two marks are wanted — the Overlays switches, in the left
   * sidebar.
   *
   * A class rather than a `hidden` attribute, because these are the editor's
   * own chrome and the stylesheet is where the rest of what Draw shows and
   * Code hides is already decided. `draw` then has nothing to do at all when
   * both are off, which is worth the line: it runs on every camera move.
   */
  setMarksVisible(frame: boolean, cross: boolean): void {
    this.framesOn = frame;
    this.frame.classList.toggle("hidden", !frame);
    this.boards.classList.toggle("hidden", !frame);
    this.cross.classList.toggle("hidden", !cross);
    this.showing = frame || cross;
    this.draw();
  }

  /** Draw one artboard a little stronger — the one picked in the list. */
  setActive(id: string | null): void {
    this.active = id;
    this.draw();
  }

  /** The camera has moved. Driven from the scene's own viewport pushes. */
  sync(view: Viewport): void {
    this.view = view;
    this.draw();
  }

  /**
   * The default zoom has changed under us — Project Options was just saved.
   *
   * Usually the camera moves with it and the redraw comes for free on the next
   * viewport push. Not always: setting the default to the zoom the camera
   * already happens to be at changes how big the game's screen is without
   * moving anything, and the boundary would keep its old size until the next
   * pan. Changing nothing but pixel art lands here too, and costs one redraw.
   * Page Setup's size and margin land here as well.
   */
  refresh(): void {
    this.draw();
  }

  destroy(): void {
    this.observer.disconnect();
    this.stopListening();
    this.labels.remove();
    this.root.remove();
  }

  /**
   * Drag an artboard by its label. The frame follows the finger at once; the
   * artboard is written when it is let go — one write, not one per move —
   * and lands on whole points.
   */
  private onLabelDown(event: PointerEvent, board: PlacedArtboard, label: HTMLElement): void {
    const view = this.view;
    if (!view) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const zoom = view.zoom || 1;
    label.setPointerCapture(event.pointerId);
    label.classList.add("dragging");
    this.drag = { id: board.id, dx: 0, dy: 0 };

    const move = (e: PointerEvent) => {
      this.drag = {
        id: board.id,
        dx: Math.round((e.clientX - startX) / zoom),
        dy: Math.round((e.clientY - startY) / zoom),
      };
      this.draw();
    };
    const up = () => {
      label.removeEventListener("pointermove", move);
      label.removeEventListener("pointerup", up);
      label.removeEventListener("pointercancel", up);
      label.classList.remove("dragging");
      const moved = this.drag;
      if (moved && (moved.dx !== 0 || moved.dy !== 0)) {
        void changePage({
          artboard: board.id,
          x: board.x + moved.dx,
          y: board.y + moved.dy,
        }).then(() => {
          this.drag = null;
          this.draw();
        });
      } else {
        this.drag = null;
        this.config.onPickArtboard?.(board.id);
      }
    };
    label.addEventListener("pointermove", move);
    label.addEventListener("pointerup", up);
    label.addEventListener("pointercancel", up);
  }

  private draw(): void {
    const view = this.view;
    const screen = this.screen;
    // Nothing to say yet: the observer fires before the first camera push, and
    // a collapsed row has no viewport to describe.
    if (!view || !screen || screen.width <= 0 || screen.height <= 0) return;
    if (!this.showing) {
      this.labels.classList.add("hidden");
      return;
    }

    const boards = currentArtboards().map((board) =>
      this.drag && this.drag.id === board.id
        ? { ...board, x: board.x + this.drag.dx, y: board.y + this.drag.dy }
        : board,
    );
    if (boards.length > 0) {
      this.frame.classList.add("hidden");
      this.drawBoards(view, boards);
      const origin = pageBox(view, boards[0]);
      this.cross.style.transform = `translate(${origin.x}px, ${origin.y}px)`;
      return;
    }

    this.boards.replaceChildren();
    this.labels.replaceChildren();
    this.frame.classList.toggle("hidden", !this.framesOn);
    const box = guideBox(
      view,
      gameScreen(screen, this.config.presentation?.()),
      this.config.defaultZoom(),
    );
    this.cross.style.transform = `translate(${box.x}px, ${box.y}px)`;
    this.frame.style.width = `${box.frame.width}px`;
    this.frame.style.height = `${box.frame.height}px`;
    this.frame.style.transform = `translate(${box.frame.x}px, ${box.frame.y}px)`;
  }

  /** One solid frame and one label per artboard, reusing what is there. */
  private drawBoards(view: Viewport, boards: PlacedArtboard[]): void {
    // Under the rail, once the guide is in the wrapper — see `labels`.
    const wrap = this.root.parentElement;
    if (!this.labels.isConnected && wrap) wrap.prepend(this.labels);
    this.labels.classList.toggle("hidden", !this.framesOn);

    while (this.boards.children.length > boards.length) this.boards.lastElementChild?.remove();
    while (this.labels.children.length > boards.length) this.labels.lastElementChild?.remove();
    for (const [i, board] of boards.entries()) {
      let frame = this.boards.children[i] as HTMLElement | undefined;
      if (!frame) {
        frame = h("div", { class: "screen-guide-frame is-page" });
        this.boards.appendChild(frame);
      }
      let label = this.labels.children[i] as HTMLElement | undefined;
      if (!label) {
        label = h("div", { class: "screen-guide-label", title: "Drag to move the artboard" });
        this.labels.appendChild(label);
      }
      const at = label;
      // Rebound every draw: the artboard behind a slot changes as the list does.
      at.onpointerdown = (event) => {
        const placed = currentArtboards().find((b) => b.id === board.id);
        if (placed) this.onLabelDown(event, placed, at);
      };
      const box = pageBox(view, board).frame;
      const active = boards.length > 1 && board.id === this.active;
      frame.classList.toggle("active", active);
      label.classList.toggle("active", active);
      frame.style.width = `${box.width}px`;
      frame.style.height = `${box.height}px`;
      frame.style.transform = `translate(${box.x}px, ${box.y}px)`;
      label.textContent = `${board.name} · ${describePage(board)}`;
      label.style.transform = `translate(${box.x}px, ${box.y}px)`;
    }
  }
}
