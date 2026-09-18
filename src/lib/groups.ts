/**
 * Groups: placed PSDs tied together by hand, for the editor's sake alone.
 *
 * Everything else in this document is *about the game*. A layer is Phaser's
 * draw order, a collider is what stops a character, a point is a place the
 * project's own code reads back by name — each of them is in `doc.json`
 * because it is in `game.config.json` too. A group is the first thing here
 * that is neither: it is a statement about how somebody is working, and the
 * game is never told. `game_config.rs` reads the fields it names and ignores
 * the rest, so a grouped document exports byte for byte the game an ungrouped
 * one does.
 *
 * It is still **saved**, and that is the whole point of putting it in the
 * document rather than in `localStorage` beside the overlay switches. A wall,
 * a roof and a door that have been put together are a fact about *this
 * project* — it travels in a `.idlewild`, it comes back on another machine, it
 * is undone and redone with everything else, and two people opening the same
 * project see the same groups. An overlay switch is none of those things.
 *
 * **Groups are of units, not of placements.** A placed PSD is one thing on the
 * canvas however many layers came in with it — see `lib/units.ts` — so what a
 * group holds is unit keys, and the placements are looked up from them. That
 * also means nothing has to be rewritten when a file is re-parsed into a
 * different number of layers.
 *
 * **Flat, for now.** A unit is in at most one group and a group holds no
 * groups. Nesting is what every drawing program does eventually, and it costs
 * a tree in the panel, a path in the selection, and a decision about what a
 * double tap means at each level — none of which is worth guessing at before
 * the flat version has been lived with. Grouping a selection that already
 * holds grouped units **absorbs** them: they leave the group they were in, and
 * a group left with fewer than two members goes, because a group of one is a
 * thing that only says the name of what is already there.
 */

import { makeId } from "./doc-shape";
import type { DocStore } from "./doc-store";
import type { Layer, Placement, PlacementGroup } from "./types";
import { unitKey, unitsOf } from "./units";

/** A layer's groups, as stored. Absent on every layer written before them. */
export function groupsOf(layer: Layer | undefined): readonly PlacementGroup[] {
  return layer?.groups ?? [];
}

/**
 * A layer's groups as they currently *stand*: only units still on the layer,
 * and only groups with two of them left.
 *
 * Every reader goes through this rather than through `groupsOf`, because a
 * group names units and a unit stops existing when its last placement is
 * deleted or carried somewhere else — and neither of those operations knows
 * what a group is, nor should it. `pruneGroups` writes the same answer back
 * when there is an edit to hang it on; until then this is what is drawn, so a
 * stale id is never something anybody sees.
 */
export function liveGroups(layer: Layer | undefined): PlacementGroup[] {
  const stored = groupsOf(layer);
  if (stored.length === 0) return [];
  const present = new Set((layer?.placements ?? []).map(unitKey));
  return stored
    .map((group) => ({
      ...group,
      units: group.units.filter((unit) => present.has(unit)),
    }))
    .filter((group) => group.units.length > 1);
}

/** The group a unit is in, if it is in one. */
export function groupOfUnit(
  layer: Layer | undefined,
  unit: string,
): PlacementGroup | undefined {
  return liveGroups(layer).find((group) => group.units.includes(unit));
}

/** The group a *placement* is in, which is its unit's. */
export function groupOfPlacement(
  layer: Layer | undefined,
  placement: Placement,
): PlacementGroup | undefined {
  return groupOfUnit(layer, unitKey(placement));
}

/**
 * Every placement a group stands for, in the layer's own order.
 *
 * The layer's order rather than the group's, because the group's list is the
 * order things were grouped in and the layer's is the order they draw in —
 * and what this answers is used to select, drag and delete, all of which are
 * about the drawing.
 */
export function groupPlacements(
  layer: Layer | undefined,
  group: PlacementGroup | undefined,
): Placement[] {
  if (!layer || !group) return [];
  const held = new Set(group.units);
  return layer.placements.filter((p) => held.has(unitKey(p)));
}

/** `Group 1`, `Group 2`, … — the first number this layer is not using. */
export function nextGroupName(layer: Layer | undefined): string {
  const taken = new Set(groupsOf(layer).map((group) => group.name));
  // Stored rather than live: a name is still taken by a group that has lost a
  // member and is waiting to be pruned, and two Group 2s would be worse than a
  // gap in the numbering.
  let n = 1;
  while (taken.has(`Group ${n}`)) n += 1;
  return `Group ${n}`;
}

/**
 * Tie units together, and hand back the layer that says so.
 *
 * Answers the layer **unchanged** — the same object — when there is nothing to
 * do, so a ⌘G on one file writes no document and pushes no undo step. Two is
 * the floor: a group of one names something that already has a name.
 *
 * The members are brought together into one run of the layer's placements, at
 * the position of the earliest of them. That is not tidiness: the layer panel
 * lists placements in the order they draw, and a group drawn as a cluster of
 * rows whose members are actually scattered through the order would be a list
 * saying something the canvas does not do. Bringing them together makes the
 * two agree, and it is what grouping means in every program that has it —
 * things put together end up next to each other in the stack.
 *
 * On an isometric object layer the list is sorted by screen Y instead, so the
 * run is no longer what is shown; the group is still drawn as a cluster there,
 * which is the one place the panel departs from strict draw order, and it
 * departs from it to say something true.
 */
export function groupUnits(
  layer: Layer,
  units: readonly string[],
  name?: string,
): { layer: Layer; group: PlacementGroup | null } {
  const present = new Set(layer.placements.map(unitKey));
  const members = [...new Set(units)].filter((unit) => present.has(unit));
  if (members.length < 2) return { layer, group: null };

  const group: PlacementGroup = {
    id: makeId("group"),
    name: name ?? nextGroupName(layer),
    units: members,
  };
  const taken = new Set(members);
  const groups = liveGroups(layer)
    .map((existing) => ({
      ...existing,
      units: existing.units.filter((unit) => !taken.has(unit)),
    }))
    // A group the new one has emptied, or left with a single member, has
    // nothing left to say.
    .filter((existing) => existing.units.length > 1);

  return {
    layer: {
      ...layer,
      placements: gather(layer.placements, taken),
      groups: [...groups, group],
    },
    group,
  };
}

/**
 * Take units out of whatever groups they are in.
 *
 * ⇧⌘G, and the same shape as grouping: the layer comes back unchanged when
 * none of them was in a group, so an ungroup of nothing is not an undo step.
 * A group left holding one unit goes with it.
 */
export function ungroupUnits(layer: Layer, units: readonly string[]): Layer {
  const taken = new Set(units);
  const before = groupsOf(layer);
  if (!before.some((group) => group.units.some((unit) => taken.has(unit)))) {
    return layer;
  }
  return withGroups(
    layer,
    before.map((group) => ({
      ...group,
      units: group.units.filter((unit) => !taken.has(unit)),
    })),
  );
}

/**
 * Write the live answer back, for the callers that have an edit to hang it on.
 *
 * Deleting a selection and carrying a placement to another layer are the two
 * ways a unit leaves a layer, and both already write the document — so they
 * take the chance to tidy. Everything that only *reads* uses `liveGroups` and
 * needs nothing from this.
 *
 * Answers the layer unchanged when there was nothing stale, so it never turns
 * a no-op into a write.
 */
export function pruneGroups(layer: Layer): Layer {
  const before = groupsOf(layer);
  if (before.length === 0) return layer;
  const after = liveGroups(layer);
  const same =
    after.length === before.length &&
    after.every(
      (group, i) => group.units.length === before[i]?.units.length,
    );
  return same ? layer : withGroups(layer, after);
}

/**
 * Write a list of groups back, dropping the ones with nothing left to say and
 * the field itself when none is left.
 *
 * The field goes rather than being left as `[]` so that a document which has
 * never been grouped, and one that has been ungrouped back to nothing, are the
 * same document — which is what keeps an undo step from being pushed for a
 * change nobody made.
 */
function withGroups(layer: Layer, groups: readonly PlacementGroup[]): Layer {
  const kept = groups.filter((group) => group.units.length > 1);
  if (kept.length === 0) {
    if (!layer.groups) return layer;
    const { groups: _dropped, ...rest } = layer;
    return rest;
  }
  return { ...layer, groups: kept };
}

/**
 * Bring a set of units together into one run, where the earliest of them is.
 *
 * Stable in both directions: the members keep their order relative to each
 * other, and everything else keeps its order relative to everything else.
 */
function gather(
  placements: readonly Placement[],
  units: ReadonlySet<string>,
): Placement[] {
  const blocks = unitsOf(placements);
  const at = blocks.findIndex((block) => units.has(unitKey(block[0])));
  if (at < 0) return [...placements];
  const moved = blocks.filter((block) => units.has(unitKey(block[0])));
  const rest = blocks.filter((block) => !units.has(unitKey(block[0])));
  // `at` counts blocks in the original list; the ones before it are all in
  // `rest` by construction, so it indexes `rest` unchanged.
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)].flat();
}

/** ⌘G, against the live document. Answers the group made, or null. */
export function group(
  store: DocStore,
  layerId: string,
  units: readonly string[],
  name?: string,
): PlacementGroup | null {
  const layer = store.layer(layerId);
  if (!layer) return null;
  const next = groupUnits(layer, units, name);
  if (next.layer === layer) return null;
  store.editLayer(layerId, () => next.layer);
  return next.group;
}

/** ⇧⌘G. Answers whether anything was in a group to come out of. */
export function ungroup(
  store: DocStore,
  layerId: string,
  units: readonly string[],
): boolean {
  const layer = store.layer(layerId);
  if (!layer) return false;
  const next = ungroupUnits(layer, units);
  if (next === layer) return false;
  store.editLayer(layerId, () => next);
  return true;
}

/**
 * Tidy a layer's groups against the document, and say nothing if there is
 * nothing stale.
 *
 * Called by the two things that take a unit off a layer — deleting a selection
 * and carrying a placement somewhere else. Both already write, so both wrap
 * this with their own edit in one `history.group`: a group that lost its last
 * member is not a step somebody took.
 */
export function pruneLayerGroups(store: DocStore, layerId: string): void {
  const layer = store.layer(layerId);
  if (!layer) return;
  const next = pruneGroups(layer);
  if (next !== layer) store.editLayer(layerId, () => next);
}

/** Rename one, from the inspector. */
export function renameGroup(
  store: DocStore,
  layerId: string,
  groupId: string,
  name: string,
): void {
  store.editLayer(layerId, (layer) => ({
    ...layer,
    groups: groupsOf(layer).map((g) => (g.id === groupId ? { ...g, name } : g)),
  }));
}
