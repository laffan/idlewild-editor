/**
 * The arrow keys: what is selected, moved one world pixel.
 *
 * The other half of Select's Snap to grid switch, and the reason that switch
 * is a switch rather than a mode. A drag is a coarse gesture — a finger over
 * glass, at whatever zoom the camera happens to be at — so it snaps by
 * default and lines a building up with the one beside it; the arrow keys are
 * the fine one, and they move a single pixel whatever the switch says. Both
 * are available at once, which is what somebody placing a sign over a doorway
 * actually needs: drag it roughly there, then tap it into place.
 *
 * **One pixel, not one space and not a scaled number.** A space is what a
 * drag already gives; a pixel is the smallest thing the document can express,
 * and on an 8px pixel-art grid it is an eighth of a space while on a 256px
 * one it is a detail nothing else can reach. Both are what "nudge" means on
 * the project it is being used on.
 *
 * **It does not share `game/drag.ts`.** A drag replays from state captured at
 * pointer-down — every move recomputes the whole position from the origin, so
 * a gesture that crosses the same ground twice never compounds. A nudge is a
 * single relative step with nothing to compound, so it reads the document and
 * adds to it, which is both simpler and the only thing that makes a run of
 * key repeats add up.
 *
 * Beside `group-actions.ts` and `layer-actions.ts` rather than in the scene,
 * for the reason those are: it is an edit to the document made on behalf of
 * the current selection, and the canvas redraws from the document on its own.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { updateText, textById } from "../lib/text-items";
import { unitMembers, unitOf } from "../game/unit";
import type { Placement, Selection } from "../lib/types";

/** How far one press moves what is selected, in world pixels. */
export const NUDGE_PX = 1;

export interface NudgeDeps {
  store: DocStore;
  grid: Grid;
  /** What is selected on the canvas right now. */
  selection: () => Selection | null;
  /**
   * Which placed unit is opened up into its own layers, if any.
   *
   * The same question a drag asks, and for the same reason: with a PSD open,
   * an arrow moves the one layer that is selected; with it closed, the whole
   * file moves as the one thing it is on the canvas.
   */
  adjustingUnit: () => string | null;
}

/**
 * Move what is selected by `dx`, `dy` world pixels.
 *
 * Answers whether anything moved, so the caller can leave the key press to
 * whatever else might want it — a selection of nothing, a locked layer, or
 * one of the two kinds that have nowhere between two spaces to go.
 */
export function nudgeSelection(
  deps: NudgeDeps,
  dx: number,
  dy: number,
): boolean {
  const selection = deps.selection();
  if (!selection) return false;
  const { store } = deps;

  // One press is one undo step, however many records it writes: a PSD with a
  // background, a building and a roof is three placements and one thing on
  // the canvas, and a history that stepped back through it a layer at a time
  // would be a history of the loop.
  store.history.begin();
  try {
    return apply(deps, selection, dx, dy);
  } finally {
    // A press that moved nothing leaves no step at all — see `UndoHistory.end`.
    store.history.end();
  }
}

function apply(
  deps: NudgeDeps,
  selection: Selection,
  dx: number,
  dy: number,
): boolean {
  const { store, grid } = deps;

  if (selection.kind === "placement" || selection.kind === "placements") {
    const layer = store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const group = placementsOf(deps, selection, layer.placements);
    if (group.length === 0) return false;
    for (const placement of group) {
      const moved = { x: placement.x + dx, y: placement.y + dy };
      // The anchor is a cell, because that is what an anchor is — it is what
      // a grid resize follows. It lands on the cell the artwork's origin now
      // sits in, which is the same thing a free drag and a resize both do.
      // Where the PSD's own mark is comes from `fromAnchor`, in the file's
      // pixels, and follows this on its own.
      const home = grid.cellToWorld(placement.anchor);
      store.updatePlacement(selection.layerId, placement.id, {
        ...moved,
        anchor: grid.worldToCell({ x: home.x + dx, y: home.y + dy }),
      });
    }
    return true;
  }

  if (selection.kind === "fill") {
    const layer = store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const fill = layer.fills.find((f) => f.id === selection.fillId);
    // A run drawn on the lattice **is** a set of cells, so there is no
    // position between two of them for a pixel to move it to — the same
    // refusal a free drag makes. The bare rectangle a drag on blank ground
    // leaves is the fill that can move.
    if (!fill?.rect) return false;
    store.updateFill(selection.layerId, selection.fillId, {
      rect: { ...fill.rect, x: fill.rect.x + dx, y: fill.rect.y + dy },
    });
    return true;
  }

  if (selection.kind === "zone") {
    const layer = store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const zone = layer.zones.find((z) => z.id === selection.zoneId);
    if (!zone) return false;
    store.updateZone(selection.layerId, selection.zoneId, {
      points: zone.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    });
    return true;
  }

  if (selection.kind === "text") {
    const layer = store.layer(selection.layerId);
    if (!layer || layer.locked) return false;
    const item = textById(layer, selection.textId);
    if (!item) return false;
    updateText(store, selection.layerId, selection.textId, {
      x: item.x + dx,
      y: item.y + dy,
    });
    return true;
  }

  // Everything else is either a space or a set of them — a named place, a run
  // of tiles, a patch of grid asked for by holding still — or it is not a
  // position at all, like a layer or a backdrop. None of them has anywhere a
  // pixel could put it, so the key press is left alone rather than rounded
  // into a move nobody asked for.
  return false;
}

/**
 * As much of the canvas as a nudge asks about.
 *
 * Named as what is wanted rather than typed as `WorldScene`, the way the
 * overlays panel names the lattice: a key press is a document edit on behalf
 * of whatever is selected, and this file has no other business with the
 * scene.
 */
export interface NudgeSource {
  getSelection(): Selection;
  readonly adjustingUnit: string | null;
}

/**
 * The arrow handler the keyboard is bound to, ready-made.
 *
 * The scene is read through a closure rather than handed over because it is
 * not up when the keyboard is bound — and it is rebuilt by a scene switch,
 * which a captured reference would outlive.
 */
export function nudger(
  store: DocStore,
  grid: Grid,
  scene: () => NudgeSource | null,
): (dx: number, dy: number) => boolean {
  return (dx, dy) =>
    nudgeSelection(
      {
        store,
        grid,
        selection: () => scene()?.getSelection() ?? null,
        adjustingUnit: () => scene()?.adjustingUnit ?? null,
      },
      dx,
      dy,
    );
}

/** The placements one arrow press moves: the unit, or the layer opened up. */
function placementsOf(
  deps: NudgeDeps,
  selection: Extract<Selection, { kind: "placement" | "placements" }>,
  placements: readonly Placement[],
): Placement[] {
  if (selection.kind === "placements") {
    return placements.filter((p) => selection.ids.includes(p.id));
  }
  const held = placements.find((p) => p.id === selection.placementId);
  if (!held) return [];
  // With the file open in the inspector's layer list, an arrow moves the one
  // layer that is selected; with it closed, the whole file moves as the one
  // thing it is on the canvas. The same question `game/drag.ts` asks.
  if (deps.adjustingUnit() === unitOf(held)) return [held];
  return unitMembers(deps.store.layers, selection.layerId, unitOf(held));
}
