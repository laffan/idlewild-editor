/**
 * Picking more than one placed PSD in the layer panel.
 *
 * The canvas has had a multi-selection since the marquee did: drag a box
 * around three towers and `{ kind: "placements" }` is what comes out. The
 * sidebar had no way to make one, which mattered the moment there were things
 * to *do* with several files at once — group them, merge them — because the
 * marquee is a gesture about where things are standing and those two are
 * questions about which files they are. Three trees in a wood are not a
 * rectangle.
 *
 * **What a row stands for is a unit, not a placement.** A placed PSD is one
 * row and several placements — see `lib/units.ts` — so everything here works
 * in whole units and flattens to placement ids only at the end, which is what
 * the document and the canvas both speak.
 *
 * **One layer's worth**, like the marquee's. `{ kind: "placements" }` carries
 * a single `layerId` because a drag moves every member by the same cell step
 * and carrying placements between layers is the panel's own drag rather than
 * something a selection should do by accident. So picking a row on a different
 * layer starts again on that layer rather than growing a selection that spans
 * two — which is also the only reading that can be drawn: the rows the second
 * layer would light up are under a different heading.
 *
 * **Three ways to pick, and the third is the iPad's.** A plain tap replaces,
 * ⌘ or Ctrl toggles one row, and ⇧ takes the run between the last plain tap
 * and this one. None of those exist under a finger, so the row also carries a
 * ⊕ — the same affordance, and the same argument, as the shape editor's path
 * list: tapping a row picks it, and the ⊕ beside it adds or removes it from
 * the selection without moving what the selection is *about*.
 */

import type { Selection } from "../lib/types";

/** What a click on a row meant. */
export type PickMode = "replace" | "toggle" | "range";

/**
 * One placed PSD in the sidebar's list, in the order the panel draws it.
 *
 * Deliberately not `LayerItem`: what this file needs is the members and the
 * order, and asking for less means the tests can say what they mean in one
 * line each.
 */
export interface PickableUnit {
  /** Every placement id the row stands for. */
  members: readonly string[];
}

/**
 * What the modifiers on a click mean.
 *
 * ⇧ wins over ⌘ when both are down, because a range is the more specific ask —
 * and because ⌘⇧-click in every editor that has both means *add this run*,
 * which is what taking the range and unioning it already does.
 *
 * Ctrl stands in for ⌘, the way it does for undo in `shortcuts.ts`: a keyboard
 * with no Command key is not locked out of the editor's own shortcuts.
 */
export function pickMode(event: {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): PickMode {
  if (event.shiftKey) return "range";
  if (event.metaKey || event.ctrlKey) return "toggle";
  return "replace";
}

/** Where a pick leaves the panel: what is selected, and what ⇧ counts from. */
export interface PickResult {
  selection: Selection;
  /**
   * The row a following ⇧-click measures its run from, or null for none.
   *
   * A plain tap and a toggle both set it — the row you last touched is the
   * end you are working from — and a ⇧-click leaves it where it was, so a run
   * can be stretched and shrunk from the same anchor rather than walking the
   * far end along with it. That is what every list with a shift-click does,
   * and getting it wrong is only noticed after you have lost the selection
   * you were adjusting.
   */
  anchor: number | null;
}

/**
 * The selection a click on row `index` leaves behind.
 *
 * `current` is what is selected now, which is read only when it is about this
 * same layer: a selection on another layer, or of a fill, or of nothing, is
 * not a set this row can be added to, so a toggle there behaves as a plain
 * tap. That is the honest reading rather than a special case — ⌘-clicking one
 * row when nothing is selected means "select this row".
 *
 * @param units every placed PSD on the layer, in the order the panel lists
 *        them, which for an isometric object layer is screen Y rather than
 *        the document's order — see `lib/units.ts`.
 */
export function pickUnit(args: {
  current: Selection;
  layerId: string;
  units: readonly PickableUnit[];
  index: number;
  anchor: number | null;
  mode: PickMode;
}): PickResult {
  const { current, layerId, units, index, anchor, mode } = args;
  const unit = units[index];
  if (!unit) return { selection: current, anchor };

  const held = heldRows(current, layerId, units);

  if (mode === "range" && anchor !== null && anchor < units.length) {
    const from = Math.min(anchor, index);
    const to = Math.max(anchor, index);
    const run = new Set<number>();
    for (let row = from; row <= to; row++) run.add(row);
    // Unioned rather than replacing, so ⌘⇧ and a plain ⇧ after a toggle both
    // do the thing they look like they are doing. A bare ⇧ from a single
    // selection is the same answer either way, because that row is in the run.
    for (const row of held) run.add(row);
    return { selection: selectionOf(layerId, units, run), anchor };
  }

  if (mode === "toggle") {
    const next = new Set(held);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return { selection: selectionOf(layerId, units, next), anchor: index };
  }

  return { selection: selectionOf(layerId, units, new Set([index])), anchor: index };
}

/**
 * Which rows the current selection covers, as indices into `units`.
 *
 * A row is held when *any* of its placements is selected, which is the same
 * rule `isSelected` draws the highlight by: the canvas selects whichever layer
 * of a file the pointer landed on, so a row that only matched its own first
 * placement would go dark when you clicked the thing it is about.
 */
export function heldRows(
  selection: Selection,
  layerId: string,
  units: readonly PickableUnit[],
): Set<number> {
  const rows = new Set<number>();
  const ids =
    selection.kind === "placement" && selection.layerId === layerId
      ? [selection.placementId]
      : selection.kind === "placements" && selection.layerId === layerId
        ? selection.ids
        : [];
  if (ids.length === 0) return rows;
  units.forEach((unit, index) => {
    if (unit.members.some((id) => ids.includes(id))) rows.add(index);
  });
  return rows;
}

/**
 * A set of rows, as the selection the rest of the editor reads.
 *
 * **One row is a `placement`, not a `placements` of one.** Almost everything
 * about a placed PSD — the inspector's file panel, resizing, opening it up
 * into its own layers — is about one thing, and would have to ask "is there
 * exactly one?" on every line if a single pick came through as a list. So the
 * kinds stay as they are and this is where the count decides which one.
 *
 * An empty set is `none`: ⌘-clicking the last held row is a way of clearing
 * the selection, and inventing a selection of nothing to keep the kind would
 * leave a panel describing zero images.
 */
export function selectionOf(
  layerId: string,
  units: readonly PickableUnit[],
  rows: ReadonlySet<number>,
): Selection {
  const ordered = [...rows].filter((row) => units[row]).sort((a, b) => a - b);
  if (ordered.length === 0) return { kind: "none" };
  if (ordered.length === 1) {
    const [only] = ordered;
    const first = units[only].members[0];
    if (first) return { kind: "placement", layerId, placementId: first };
    return { kind: "none" };
  }
  const ids: string[] = [];
  for (const row of ordered) ids.push(...units[row].members);
  return { kind: "placements", layerId, ids };
}
