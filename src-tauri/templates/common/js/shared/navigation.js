// A* over the document's walkable cells. Play mode taps a cell; this returns
// the route. Blocking zones and non-walkable fills are the obstacles.

const STRAIGHT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const key = (cx, cy) => `${cx},${cy}`;

/**
 * @param {(cx:number, cy:number) => boolean} isWalkable
 * @param {{cx:number,cy:number}} start
 * @param {{cx:number,cy:number}} goal
 * @param {number} maxNodes  guard against an unbounded search on an
 *                           effectively infinite grid
 */
export function findPath(isWalkable, start, goal, maxNodes = 20000) {
  if (!isWalkable(goal.cx, goal.cy)) return null;

  const heuristic = (cx, cy) => Math.abs(cx - goal.cx) + Math.abs(cy - goal.cy);
  const open = [{ ...start, f: heuristic(start.cx, start.cy), g: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[key(start.cx, start.cy), 0]]);
  const closed = new Set();
  let expanded = 0;

  while (open.length > 0) {
    // Small frontiers in practice; a linear scan beats a heap's overhead.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.cx, current.cy);

    if (current.cx === goal.cx && current.cy === goal.cy) {
      return reconstruct(cameFrom, current);
    }

    closed.add(currentKey);
    if (++expanded > maxNodes) return null;

    for (const [dx, dy] of STRAIGHT) {
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      const nKey = key(nx, ny);
      if (closed.has(nKey) || !isWalkable(nx, ny)) continue;

      const tentative = current.g + 1;
      if (tentative >= (gScore.get(nKey) ?? Infinity)) continue;

      cameFrom.set(nKey, current);
      gScore.set(nKey, tentative);
      open.push({ cx: nx, cy: ny, g: tentative, f: tentative + heuristic(nx, ny) });
    }
  }
  return null;
}

function reconstruct(cameFrom, node) {
  const path = [{ cx: node.cx, cy: node.cy }];
  let current = node;
  while (cameFrom.has(key(current.cx, current.cy))) {
    current = cameFrom.get(key(current.cx, current.cy));
    path.unshift({ cx: current.cx, cy: current.cy });
  }
  return path;
}
