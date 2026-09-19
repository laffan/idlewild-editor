/**
 * The tile palette: a PSD on a tile layer, cut into spaces you can pick from.
 *
 * It takes the inspector sidebar while a tile layer is what the panel is
 * about, and that is the whole arrangement — the relationship Tiled has
 * between its palette and its tools, which is the one this feature is
 * modelled on. What is picked here is what the tools put down; nothing else
 * passes between them.
 *
 * **The picture is divided on the project's own grid boundaries.** A space in
 * the palette is a space on the ground, so what is picked up is what is put
 * down — see `addTileset`, which cuts a PSD at `grid.tileWidth` by
 * `grid.tileHeight`. The lines drawn over the picture here are rectangles
 * even on an isometric project, because rectangles are how the image is
 * actually cut: a diamond is what the *ground* looks like, and drawing one
 * here would say the artwork outside it is not part of the tile.
 *
 * **The selection is a rectangle**, for the reason `TileStamp` gives: a stamp
 * has to have a shape, and an L-shaped one would have to decide what the
 * missing corner does to the ground under it. Drag across the palette to take
 * a run; a tap takes one.
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
 */
export class TileSelection extends EventTarget {
  private held: TileStamp | null = null;

  get stamp(): TileStamp | null {
    return this.held;
  }

  set stamp(next: TileStamp | null) {
    this.held = next;
    this.dispatchEvent(new CustomEvent("change"));
  }

}

export interface PaletteOptions {
  tileset: TiledTileset;
  /** The asset server's base URL for this project — see `lib/ipc.ts`. */
  assetBase: string;
  selection: TileSelection;
  /** Told when this palette takes a run, so the panel's summary can follow. */
  onPick?: (stamp: TileStamp) => void;
}

/**
 * One tileset, as a picture with a lattice over it.
 *
 * Everything is positioned as a percentage of the image rather than in
 * pixels, which is what makes the palette survive the sidebar being resized:
 * the `<img>` is laid out at whatever width the column is and the lattice and
 * the highlight follow it without anything having to be measured again. The
 * one place a real measurement is needed is a pointer event, where the box
 * the browser laid out is exactly what has to be divided.
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
  const frame = h(
    "div",
    { class: "tile-palette", dataset: { firstgid: String(tileset.firstgid) } },
    picture,
    lattice,
    marker,
  );

  const show = (): void => {
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
    const box = picture.getBoundingClientRect();
    const col = Math.floor(((event.clientX - box.left) / box.width) * columns);
    const row = Math.floor(((event.clientY - box.top) / box.height) * rows);
    return {
      col: Math.max(0, Math.min(columns - 1, col)),
      row: Math.max(0, Math.min(rows - 1, row)),
    };
  };

  if (columns > 0 && rows > 0) {
    bindPicking(frame, cellAt, (from, to) => {
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
  }

  // Every palette on screen re-reads when any of them is picked from, so the
  // one that *had* the run lets go of it. Each listens on its own element and
  // the announcement goes out to each in turn, which is deliberate: a
  // listener on the frame dies when the panel that holds it is thrown away,
  // and this panel is rebuilt on every document change. A subscription to
  // `TileSelection` would need taking off again, and the render that forgot
  // would leak one per rebuild for the life of the session.
  frame.addEventListener(PICKED, show);
  show();
  return frame;
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
 * drag the panel took for a scroll. `touch-action: none` on the frame is the
 * other half of that and lives in the stylesheet.
 */
function bindPicking(
  frame: HTMLElement,
  cellAt: (event: PointerEvent) => { col: number; row: number },
  pick: (
    from: { col: number; row: number },
    to: { col: number; row: number },
  ) => void,
): void {
  let from: { col: number; row: number } | null = null;

  frame.addEventListener("pointerdown", (event: PointerEvent) => {
    event.preventDefault();
    from = cellAt(event);
    frame.setPointerCapture(event.pointerId);
    pick(from, from);
  });
  frame.addEventListener("pointermove", (event: PointerEvent) => {
    if (!from) return;
    pick(from, cellAt(event));
  });
  const end = (event: PointerEvent): void => {
    if (!from) return;
    from = null;
    if (frame.hasPointerCapture(event.pointerId)) {
      frame.releasePointerCapture(event.pointerId);
    }
  };
  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);
}

/** What the panel says about a run in hand. */
export function describeStamp(stamp: TileStamp | null): string {
  if (!stamp) return "nothing picked";
  if (stamp.cols === 1 && stamp.rows === 1) return "one tile";
  return `${stamp.cols} × ${stamp.rows} tiles`;
}
