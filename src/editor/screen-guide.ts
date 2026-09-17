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
import type { Viewport } from "../drawing";

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

  constructor(config: ScreenGuideConfig) {
    this.config = config;
    this.frame = h("div", { class: "screen-guide-frame" });
    this.cross = h("div", { class: "screen-guide-cross" });
    this.root = h("div", { class: "screen-guide" }, this.frame, this.cross);

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
   */
  refresh(): void {
    this.draw();
  }

  destroy(): void {
    this.observer.disconnect();
    this.root.remove();
  }

  private draw(): void {
    const view = this.view;
    const screen = this.screen;
    // Nothing to say yet: the observer fires before the first camera push, and
    // a collapsed row has no viewport to describe.
    if (!view || !screen || screen.width <= 0 || screen.height <= 0) return;

    const box = guideBox(view, screen, this.config.defaultZoom());
    this.cross.style.transform = `translate(${box.x}px, ${box.y}px)`;
    this.frame.style.width = `${box.frame.width}px`;
    this.frame.style.height = `${box.frame.height}px`;
    this.frame.style.transform = `translate(${box.frame.x}px, ${box.frame.y}px)`;
  }
}
