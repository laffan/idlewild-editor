// Grid projection, shared with the editor (src/lib/grid.ts). Keep the two in
// step: the editor writes cell coordinates into game.config.json, and this is
// what turns them back into world pixels at runtime.
//
// The blank projection is the orthogonal mapping with a cell of one world
// pixel. Nothing snaps to it, so a scene built on it never draws it — but the
// mapping still has to exist, because every cell coordinate the editor wrote
// is measured in it.

export function createGrid(projection, size) {
  const snaps = projection !== "blank";
  const cell = snaps ? size : 1;
  const tileWidth = cell;
  const tileHeight = projection === "isometric" ? size / 2 : cell;

  return {
    projection,
    size,
    snaps,
    cell,
    tileWidth,
    tileHeight,

    cellToWorld(cx, cy) {
      if (projection === "isometric") {
        return {
          x: (cx - cy) * (tileWidth / 2),
          y: (cx + cy) * (tileHeight / 2),
        };
      }
      return { x: cx * cell, y: cy * cell };
    },

    worldToCell(x, y) {
      if (projection === "isometric") {
        const a = x / (tileWidth / 2);
        const b = y / (tileHeight / 2);
        return { cx: Math.round((a + b) / 2), cy: Math.round((b - a) / 2) };
      }
      return { cx: Math.floor(x / cell), cy: Math.floor(y / cell) };
    },

    /**
     * The middle of a cell — not `cellToWorld`, which returns each shape's
     * natural anchor: a diamond's centre, but a square's top-left corner.
     * Anything asking "is this cell inside that shape" has to test a point
     * that is unambiguously in the cell, and a corner has three neighbours.
     */
    cellCentre(cx, cy) {
      const c = this.cellToWorld(cx, cy);
      if (projection === "isometric") return c;
      return { x: c.x + cell / 2, y: c.y + cell / 2 };
    },

    cellPolygon(cx, cy) {
      const c = this.cellToWorld(cx, cy);
      const hw = tileWidth / 2;
      const hh = tileHeight / 2;
      if (projection === "isometric") {
        return [c.x, c.y - hh, c.x + hw, c.y, c.x, c.y + hh, c.x - hw, c.y];
      }
      return [
        c.x, c.y,
        c.x + cell, c.y,
        c.x + cell, c.y + cell,
        c.x, c.y + cell,
      ];
    },

    /**
     * The world-space box a fill covers.
     *
     * A fill is stored one of two ways — a run of grid spaces, or, on a
     * project that does not snap, one rectangle — and both a painter and a
     * platformer's ground want the same answer from either.
     */
    fillBoxes(fill) {
      if (fill.rect) {
        return [
          {
            x: fill.rect.x,
            y: fill.rect.y,
            width: fill.rect.width,
            height: fill.rect.height,
          },
        ];
      }
      return (fill.cells ?? []).map((c) => {
        const flat = this.cellPolygon(c.cx, c.cy);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < flat.length; i += 2) {
          minX = Math.min(minX, flat[i]);
          maxX = Math.max(maxX, flat[i]);
          minY = Math.min(minY, flat[i + 1]);
          maxY = Math.max(maxY, flat[i + 1]);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      });
    },
  };
}
