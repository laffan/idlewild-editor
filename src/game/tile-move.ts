/**
 * Carrying a run of selected tiles to another patch of ground.
 *
 * The Select tool's third gesture, and the one that makes a tile selection
 * worth making: drag a box over some tiles, then drag the tiles. It sits in
 * the gesture chain beside `TilePaint` — between the canvas modes and the
 * drag controller — and refuses everything that is not a press inside a run
 * it is already holding, which is the same rule `DragController` keeps about
 * a placed image.
 *
 * **Nothing reaches the document until the release.** What moves during the
 * drag is a ghost: the same faded tiles the Stamp tool previews with, drawn
 * at the offset so far. A move that wrote on every pointer step would be a
 * hundred documents for one gesture and a source patch that ate itself as it
 * went — the tiles under the finger would be cleared and rewritten a space
 * at a time, and the overlap would take a bite out of the run.
 *
 * The write itself is `moveTiles`, which lifts the gids before it clears
 * anything for exactly that reason.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { moveTiles } from "../lib/tile-layers";
import { tileLayer } from "../lib/tile-layers";
import { tileAt } from "../lib/tiled/chunks";
import type { TileWrite } from "../lib/tiled/chunks";
import type { Cell, Point, Selection } from "../lib/types";

export interface TileMoveHost {
  store: DocStore;
  grid: Grid;
  worldAt: (screenX: number, screenY: number) => Point;
  /** What is selected, and the way to say where it ended up. */
  selection: () => Selection;
  setSelection: (selection: Selection) => void;
  /** The ghost of the run at its offset so far. */
  onPreview: (tiles: readonly TileWrite[]) => void;
  /** Something changed: the renderer rebuilds rather than waiting for a pan. */
  onChanged: () => void;
}

export class TileMove {
  private readonly host: TileMoveHost;
  /** The space the drag started on, and the run it is carrying. */
  private from: Cell | null = null;
  private carrying: { layerId: string; cells: Cell[]; gids: number[] } | null = null;
  /** Where the run has got to, so the release knows what to write. */
  private by = { cx: 0, cy: 0 };

  constructor(host: TileMoveHost) {
    this.host = host;
  }

  /**
   * A press inside the selected run takes the gesture.
   *
   * Inside, not merely on the layer: a press on ground outside the run is a
   * fresh marquee, which is how a selection is replaced rather than dragged.
   */
  begin(screenX: number, screenY: number): boolean {
    const selection = this.host.selection();
    if (selection.kind !== "tiles" || selection.cells.length === 0) return false;
    const layer = this.host.store.layer(selection.layerId);
    if (!layer || layer.locked || !layer.visible) return false;

    const at = this.host.grid.worldToCell(
      this.host.worldAt(screenX, screenY),
    );
    if (!selection.cells.some((c) => c.cx === at.cx && c.cy === at.cy)) return false;

    const held = tileLayer(layer);
    this.from = at;
    this.by = { cx: 0, cy: 0 };
    this.carrying = {
      layerId: selection.layerId,
      cells: selection.cells.map((c) => ({ ...c })),
      // Lifted at the start rather than read at the release: what is under
      // the run changes as the ghost passes over it, and the tiles being
      // carried are the ones that were there when the drag began.
      gids: selection.cells.map((c) => tileAt(held, c.cx, c.cy)),
    };
    return true;
  }

  move(screenX: number, screenY: number): boolean {
    if (!this.from || !this.carrying) return false;
    const at = this.host.grid.worldToCell(this.host.worldAt(screenX, screenY));
    this.by = { cx: at.cx - this.from.cx, cy: at.cy - this.from.cy };
    this.host.onPreview(
      this.carrying.cells.map((cell, i) => ({
        x: cell.cx + this.by.cx,
        y: cell.cy + this.by.cy,
        gid: this.carrying?.gids[i] ?? 0,
      })),
    );
    return true;
  }

  end(): boolean {
    if (!this.carrying) return false;
    const { layerId, cells } = this.carrying;
    const by = this.by;
    this.from = null;
    this.carrying = null;
    this.by = { cx: 0, cy: 0 };
    this.host.onPreview([]);

    if (by.cx === 0 && by.cy === 0) return true;
    const moved = moveTiles(this.host.store, layerId, cells, by);
    // The selection goes with the tiles. A run that stayed behind would be an
    // outline round the ground they used to be on, and the next drag inside
    // it would pick up whatever happened to be there now.
    this.host.setSelection({ kind: "tiles", layerId, cells: moved });
    this.host.onChanged();
    return true;
  }

  /** Whether a drag of this object's is in flight. */
  get active(): boolean {
    return this.carrying !== null;
  }
}
