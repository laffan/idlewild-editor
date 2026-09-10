/**
 * A* over grid cells. Shared by play mode and the exported game template
 * (src-tauri/templates/common/js/navigation.js is the same algorithm in
 * plain JS — keep the two in step).
 */

import type { Cell } from "./types";

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

interface Node extends Cell {
  g: number;
  f: number;
}

const key = (cx: number, cy: number) => `${cx},${cy}`;

/**
 * @param isWalkable called for each candidate cell
 * @param maxNodes   guard: the grid is unbounded, so an unreachable goal must
 *                   not search forever
 */
export function findPath(
  isWalkable: (cx: number, cy: number) => boolean,
  start: Cell,
  goal: Cell,
  maxNodes = 20_000,
): Cell[] | null {
  if (!isWalkable(goal.cx, goal.cy)) return null;
  if (start.cx === goal.cx && start.cy === goal.cy) return [start];

  const heuristic = (cx: number, cy: number) =>
    Math.abs(cx - goal.cx) + Math.abs(cy - goal.cy);

  const open: Node[] = [
    { cx: start.cx, cy: start.cy, g: 0, f: heuristic(start.cx, start.cy) },
  ];
  const cameFrom = new Map<string, Cell>();
  const gScore = new Map<string, number>([[key(start.cx, start.cy), 0]]);
  const closed = new Set<string>();
  let expanded = 0;

  while (open.length > 0) {
    // Frontiers stay small on a tile grid; a linear scan beats a heap here.
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f) best = i;
    }
    const current = open.splice(best, 1)[0];
    const currentKey = key(current.cx, current.cy);

    if (current.cx === goal.cx && current.cy === goal.cy) {
      return reconstruct(cameFrom, current);
    }

    closed.add(currentKey);
    if (++expanded > maxNodes) return null;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      const nKey = key(nx, ny);
      if (closed.has(nKey) || !isWalkable(nx, ny)) continue;

      const tentative = current.g + 1;
      if (tentative >= (gScore.get(nKey) ?? Infinity)) continue;

      cameFrom.set(nKey, { cx: current.cx, cy: current.cy });
      gScore.set(nKey, tentative);
      open.push({ cx: nx, cy: ny, g: tentative, f: tentative + heuristic(nx, ny) });
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<string, Cell>, node: Cell): Cell[] {
  const path: Cell[] = [{ cx: node.cx, cy: node.cy }];
  let current: Cell = node;
  for (;;) {
    const previous = cameFrom.get(key(current.cx, current.cy));
    if (!previous) break;
    path.unshift(previous);
    current = previous;
  }
  return path;
}
