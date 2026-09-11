/**
 * The shape of a PSD's layer list, as the inspector shows it.
 *
 * The list is flat and the file is a tree, so a row carries the depth it sits
 * at and everything else is read back out of that: what a group holds is the
 * run of deeper rows under it, and who a row's siblings are is the run either
 * side of it that never goes shallower. Kept pure and apart from the panel
 * because the awkward parts are the arithmetic, and arithmetic is worth
 * testing without a DOM.
 *
 * Reordering works on **blocks**, never on single rows. Dragging a group has
 * to take what is inside it — a group torn away from its contents is not an
 * edit anyone meant to make — and a block only ever lands among its own
 * siblings, so a drag cannot silently move a layer into or out of a group.
 * Doing that deliberately is a different gesture and is not offered yet.
 */

/** The only thing any of this needs to know about a row. */
export interface TreeRow {
  depth: number;
}

/** A row plus everything indented under it: what a drag moves. */
export function blockLength(rows: readonly TreeRow[], at: number): number {
  const depth = rows[at]?.depth;
  if (depth === undefined) return 0;
  let length = 1;
  while (at + length < rows.length && rows[at + length].depth > depth) length++;
  return length;
}

/**
 * The run of rows sharing a parent with this one, their contents included.
 *
 * Walking out from the row until the depth goes *shallower* than its own —
 * that row is the parent, or the end of the list — which is the same thing
 * the indent says to the eye.
 */
export function siblingSpan(
  rows: readonly TreeRow[],
  at: number,
): { from: number; to: number } {
  const depth = rows[at]?.depth;
  if (depth === undefined) return { from: at, to: at };
  let from = at;
  while (from > 0 && rows[from - 1].depth >= depth) from--;
  let to = at + 1;
  while (to < rows.length && rows[to].depth >= depth) to++;
  return { from, to };
}

/**
 * Where a block may be dropped: the start of each sibling block, and the end
 * of the run they are in.
 *
 * The last slot is the span's end rather than the list's, which is what keeps
 * a drag inside the group it started in.
 */
export function dropSlots(rows: readonly TreeRow[], at: number): number[] {
  const depth = rows[at]?.depth;
  if (depth === undefined) return [];
  const { from, to } = siblingSpan(rows, at);
  const slots: number[] = [];
  for (let i = from; i < to; i += Math.max(1, blockLength(rows, i))) {
    if (rows[i].depth === depth) slots.push(i);
  }
  slots.push(to);
  return slots;
}

/**
 * Move a block so it starts at `to`, and hand back the new order.
 *
 * `to` is a slot in the list *as it stands*, so moving a block downward has to
 * account for the hole it leaves behind it.
 */
export function moveBlock<T>(
  rows: readonly T[],
  at: number,
  size: number,
  to: number,
): T[] {
  if (size <= 0 || to === at) return [...rows];
  const block = rows.slice(at, at + size);
  const rest = [...rows.slice(0, at), ...rows.slice(at + size)];
  const target = to > at ? to - size : to;
  return [...rest.slice(0, target), ...block, ...rest.slice(target)];
}
