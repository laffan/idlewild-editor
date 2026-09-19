/**
 * The tile palette: a PSD on a tile layer, cut into spaces you can pick from.
 *
 * It takes the inspector sidebar while a tile layer is what the panel is
 * about, and that is the whole arrangement — the relationship Tiled has
 * between its palette and its tools, which is the one this feature is
 * modelled on. What is picked here is what the tools put down; nothing else
 * passes between them.
 *
 * **A palette tile is a canvas tile.** The picture is drawn at the size a
 * space is on the grid, times the zoom, rather than stretched to whatever
 * width the sidebar happens to be. The first version did stretch it, and the
 * result was a palette whose tiles were some arbitrary size that matched
 * nothing — picking up a 16px tile and seeing it three times life-size tells
 * you nothing about what is going to land. A tileset wider than the column
 * therefore *overflows*, which is correct and is why the box scrolls.
 *
 * **It zooms on its own.** A palette starts at the canvas's zoom, because
 * that is what "the same size as a normal tile" means at the moment you look
 * at it — and from then on it is yours: pinch it, wheel it, or use the two
 * buttons. The same distinction a collider draws between a guess and an
 * answer, and the guess only holds until somebody gives one.
 *
 * **The picture is divided on the project's own grid boundaries**, which is
 * what makes a space here a space on the ground — see `addTileset`. The lines
 * drawn over it are rectangles even on an isometric project, because
 * rectangles are how the image is actually cut: a diamond is what the
 * *ground* looks like, and drawing one here would say the artwork outside it
 * is not part of the tile.
 *
 * **The selection is a rectangle**, for the reason `TileStamp` gives: a stamp
 * has to have a shape, and an L-shaped one would have to decide what the
 * missing corner does to the ground under it.
 *
 * The picture is loaded over the asset server rather than out of Phaser. It
 * is an `<img>` in a panel, not a texture in a scene, and the server is
 * already how psd-to-phaser reads the same file — see
 * `Docs/shell-and-runtime.md` for why there is one.
 */

import { h } from "../lib/dom";
import { tileGrid } from "../lib/tiled/gid";
import type { TiledTileset } from "../lib/tiled/types";
import type { TileStamp } from "../lib/tile-layers";

/** How far a palette can be zoomed, whatever the canvas is doing. */
export const PALETTE_ZOOM = { min: 0.25, max: 8 };

/** What one press of the `−` or `+` button does. */
const ZOOM_STEP = 1.25;

/**
 * What is picked, and who is listening.
 *
 * Held by the shell rather than by the panel, because the panel is rebuilt on
 * every document change and a pick that did not survive one would be a pick
 * lost the first time anybody put a tile down. Held by the shell rather than
 * by the document for the opposite reason: it is the state of a *tool*, like
 * the pencil's size or the colour the picker last settled on, and nothing in
 * a saved project should record which tile somebody had in hand.
 *
 * One pick for the project rather than one per layer. A tileset belongs to
 * the document — see `GameDoc.tilesets` — so a run picked while one layer was
 * open is still exactly as meaningful on the next.
 *
 * The **zoom** is here for the same reason and with one extra rule: it is
 * per tileset, because two palettes in one sidebar are two pictures and there
 * is no reason a comfortable size for one is a comfortable size for the
 * other. Until somebody sets one it is not stored at all, which is what lets
 * it keep following the canvas.
 */
export class TileSelection extends EventTarget {
  private held: TileStamp | null = null;
  private readonly zooms = new Map<number, number>();

  get stamp(): TileStamp | null {
    return this.held;
  }

  set stamp(next: TileStamp | null) {
    this.held = next;
    this.dispatchEvent(new CustomEvent("change"));
  }

  /**
   * How big one palette tile is drawn, against a space on the grid.
   *
   * `canvas` is the camera's own zoom, and it is the answer until somebody
   * gives a different one — see the note at the top.
   */
  zoom(firstgid: number, canvas: number): number {
    return this.zooms.get(firstgid) ?? clampZoom(canvas);
  }

  setZoom(firstgid: number, zoom: number): void {
    this.zooms.set(firstgid, clampZoom(zoom));
    this.dispatchEvent(new CustomEvent("change"));
  }

  /** Give the palette back to the canvas's zoom. */
  resetZoom(firstgid: number): void {
    this.zooms.delete(firstgid);
    this.dispatchEvent(new CustomEvent("change"));
  }
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.max(PALETTE_ZOOM.min, Math.min(PALETTE_ZOOM.max, zoom));
}

export interface PaletteOptions {
  tileset: TiledTileset;
  /** The asset server's base URL for this project — see `lib/ipc.ts`. */
  assetBase: string;
  selection: TileSelection;
  /** A space on the grid, in world pixels — what one tile is drawn at. */
  cell: number;
  /** The camera's zoom, which is where a palette's own starts. */
  canvasZoom: number;
  /** Told when this palette takes a run, so the panel's summary can follow. */
  onPick?: (stamp: TileStamp) => void;
}

/**
 * One tileset, as a picture with a lattice over it, in a box that scrolls.
 *
 * Three elements: the box that clips and scrolls, the sheet that is the
 * picture's real size at the current zoom, and the picture. The lattice and
 * the highlight are laid out as percentages of the sheet, so a zoom changes
 * one number — the sheet's width — and everything follows it without
 * anything being measured again.
 */
export function tilePalette(options: PaletteOptions): HTMLElement {
  const { tileset, selection } = options;
  const { columns, rows } = tileGrid(
    tileset.imagewidth,
    tileset.imageheight,
    tileset.tilewidth,
    tileset.tileheight,
    tileset.spacing,
    tileset.margin,
  );

  const picture = h("img", {
    class: "tile-palette-img",
    src: `${options.assetBase}/${tileset.image}`,
    alt: `${tileset.name}, ${columns} by ${rows} tiles`,
    draggable: "false",
  }) as HTMLImageElement;

  // The lattice is drawn with two repeating gradients rather than one element
  // per space: a tileset is often hundreds of tiles, and hundreds of divs in
  // a panel that is rebuilt on every document change is a panel that stutters.
  const lattice = h("div", { class: "tile-palette-grid" });
  const step = (n: number) => `${100 / Math.max(1, n)}%`;
  lattice.style.backgroundSize = `${step(columns)} ${step(rows)}`;

  const marker = h("div", { class: "tile-palette-pick" });
  const sheet = h("div", { class: "tile-palette-sheet" }, picture, lattice, marker);
  const box = h(
    "div",
    { class: "tile-palette", dataset: { firstgid: String(tileset.firstgid) } },
    sheet,
  );

  /**
   * The sheet at the current zoom.
   *
   * One tileset tile of `tilewidth` source pixels is one space of ground, so
   * it is drawn at `cell × zoom` — which is exactly the number of screen
   * pixels the same tile occupies on the canvas. The picture then follows the
   * sheet at a hundred per cent, and the lattice and the highlight follow it
   * as percentages, so this is the only place a pixel is ever written.
   */
  const size = (): void => {
    const zoom = selection.zoom(tileset.firstgid, options.canvasZoom);
    const across = tileset.tilewidth > 0 ? tileset.imagewidth / tileset.tilewidth : 1;
    sheet.style.width = `${Math.max(1, Math.round(across * options.cell * zoom))}px`;
  };

  const show = (): void => {
    size();
    const held = selection.stamp;
    const mine = held && held.firstgid === tileset.firstgid;
    marker.hidden = !mine;
    if (!held || !mine) return;
    marker.style.left = `${(held.col / columns) * 100}%`;
    marker.style.top = `${(held.row / rows) * 100}%`;
    marker.style.width = `${(held.cols / columns) * 100}%`;
    marker.style.height = `${(held.rows / rows) * 100}%`;
  };

  /** Which space of the palette a pointer is over, clamped to the picture. */
  const cellAt = (event: PointerEvent): { col: number; row: number } => {
    const bounds = sheet.getBoundingClientRect();
    const col = Math.floor(((event.clientX - bounds.left) / bounds.width) * columns);
    const row = Math.floor(((event.clientY - bounds.top) / bounds.height) * rows);
    return {
      col: Math.max(0, Math.min(columns - 1, col)),
      row: Math.max(0, Math.min(rows - 1, row)),
    };
  };

  if (columns > 0 && rows > 0) {
    bindPicking(box, cellAt, (from, to) => {
      const stamp: TileStamp = {
        firstgid: tileset.firstgid,
        col: Math.min(from.col, to.col),
        row: Math.min(from.row, to.row),
        cols: Math.abs(to.col - from.col) + 1,
        rows: Math.abs(to.row - from.row) + 1,
      };
      selection.stamp = stamp;
      options.onPick?.(stamp);
      announce();
    });
    bindZooming(box, tileset.firstgid, selection, () => options.canvasZoom, show);
  }

  // Every palette on screen re-reads when any of them is picked from, so the
  // one that *had* the run lets go of it. Each listens on its own element and
  // the announcement goes out to each in turn, which is deliberate: a
  // listener on the frame dies when the panel that holds it is thrown away,
  // and this panel is rebuilt on every document change. A subscription to
  // `TileSelection` would need taking off again, and the render that forgot
  // would leak one per rebuild for the life of the session.
  box.addEventListener(PICKED, show);
  show();
  return box;
}

/** The event every palette on screen re-reads on. See `tilePalette`. */
const PICKED = "tiles-picked";

function announce(): void {
  for (const el of document.querySelectorAll(".tile-palette")) {
    el.dispatchEvent(new CustomEvent(PICKED));
  }
}

/**
 * The drag that takes a run.
 *
 * Pointer capture rather than window listeners, because the palette is inside
 * a scrolling panel and a drag that left the picture would otherwise be a
 * drag the panel took for a scroll. `touch-action: none` on the box is the
 * other half of that and lives in the stylesheet — which is also why the two
 * ways to move around a palette that is bigger than its box are a scrollbar
 * and a second finger, below.
 */
function bindPicking(
  box: HTMLElement,
  cellAt: (event: PointerEvent) => { col: number; row: number },
  pick: (
    from: { col: number; row: number },
    to: { col: number; row: number },
  ) => void,
): void {
  let from: { col: number; row: number } | null = null;

  box.addEventListener("pointerdown", (event: PointerEvent) => {
    // A second finger is a pinch rather than a selection — see `bindZooming`.
    if (event.isPrimary === false) return;
    event.preventDefault();
    from = cellAt(event);
    box.setPointerCapture(event.pointerId);
    pick(from, from);
  });
  box.addEventListener("pointermove", (event: PointerEvent) => {
    if (!from || event.isPrimary === false) return;
    pick(from, cellAt(event));
  });
  const end = (event: PointerEvent): void => {
    if (!from) return;
    from = null;
    if (box.hasPointerCapture(event.pointerId)) {
      box.releasePointerCapture(event.pointerId);
    }
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
}

/**
 * Two fingers, and the wheel.
 *
 * A palette is a picture you point at, so one finger has to mean *pick* —
 * which leaves the second finger to mean move and zoom, exactly as it does on
 * the main canvas. The wheel scrolls the box natively and is left alone;
 * held with ⌘ or Ctrl it zooms, which is what a trackpad pinch arrives as.
 *
 * The zoom is about the **middle of the box** rather than about the pointer,
 * which is the one place this parts company with the canvas. A palette is a
 * few hundred pixels of sidebar and the scroll position is what is really
 * being adjusted; zooming about a moving point in a box that small reads as
 * the picture sliding out from under the fingers.
 */
function bindZooming(
  box: HTMLElement,
  firstgid: number,
  selection: TileSelection,
  canvasZoom: () => number,
  show: () => void,
): void {
  const fingers = new Map<number, { x: number; y: number }>();
  let spread = 0;

  const centre = (): { x: number; y: number } => {
    const points = [...fingers.values()];
    const sum = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), {
      x: 0,
      y: 0,
    });
    return { x: sum.x / points.length, y: sum.y / points.length };
  };
  const apart = (): number => {
    const [a, b] = [...fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  box.addEventListener("pointerdown", (event: PointerEvent) => {
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size === 2) spread = apart();
  });
  box.addEventListener("pointermove", (event: PointerEvent) => {
    if (!fingers.has(event.pointerId)) return;
    const was = centre();
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size !== 2) return;
    const now = centre();
    // The second finger moves the picture as well as scaling it, which is
    // what makes a palette larger than its box reachable on a device with no
    // scrollbar to drag.
    box.scrollLeft -= now.x - was.x;
    box.scrollTop -= now.y - was.y;
    const next = apart();
    if (spread > 0 && next > 0) {
      selection.setZoom(
        firstgid,
        selection.zoom(firstgid, canvasZoom()) * (next / spread),
      );
      show();
    }
    spread = next;
  });
  const lift = (event: PointerEvent): void => {
    fingers.delete(event.pointerId);
    spread = 0;
  };
  box.addEventListener("pointerup", lift);
  box.addEventListener("pointercancel", lift);
  box.addEventListener("pointerleave", lift);

  box.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const by = Math.pow(ZOOM_STEP, -event.deltaY / 100);
      selection.setZoom(firstgid, selection.zoom(firstgid, canvasZoom()) * by);
      show();
    },
    { passive: false },
  );
}

/** The two buttons and the readout over a palette — see `inspect-tiles.ts`. */
export function zoomControls(
  firstgid: number,
  selection: TileSelection,
  canvasZoom: () => number,
  onChange: () => void,
): HTMLElement {
  const held = () => selection.zoom(firstgid, canvasZoom());
  const readout = h("button", {
    class: "tile-zoom-now m",
    title: "Back to the canvas's own zoom",
    "aria-label": "Reset the palette's zoom",
  });
  const paint = () => {
    readout.textContent = `${Math.round(held() * 100)}%`;
  };
  readout.addEventListener("click", () => {
    selection.resetZoom(firstgid);
    paint();
    onChange();
  });

  const step = (by: number) =>
    h("button", {
      class: "tile-zoom-step",
      text: by > 1 ? "+" : "−",
      title: by > 1 ? "Larger" : "Smaller",
      "aria-label": by > 1 ? "Zoom the palette in" : "Zoom the palette out",
      onClick: () => {
        selection.setZoom(firstgid, held() * by);
        paint();
        onChange();
      },
    });

  paint();
  return h(
    "div",
    { class: "tile-zoom" },
    step(1 / ZOOM_STEP),
    readout,
    step(ZOOM_STEP),
  );
}

/** What the panel says about a run in hand. */
export function describeStamp(stamp: TileStamp | null): string {
  if (!stamp) return "nothing picked";
  if (stamp.cols === 1 && stamp.rows === 1) return "one tile";
  return `${stamp.cols} × ${stamp.rows} tiles`;
}
