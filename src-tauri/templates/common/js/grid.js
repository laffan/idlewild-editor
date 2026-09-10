// Grid projection, shared with the editor (src/lib/grid.ts). Keep the two in
// step: the editor writes cell coordinates into game.config.json, and this is
// what turns them back into world pixels at runtime.

export function createGrid(projection, size) {
  const tileWidth = size;
  const tileHeight = projection === "isometric" ? size / 2 : size;

  return {
    projection,
    size,
    tileWidth,
    tileHeight,

    cellToWorld(cx, cy) {
      if (projection === "isometric") {
        return {
          x: (cx - cy) * (tileWidth / 2),
          y: (cx + cy) * (tileHeight / 2),
        };
      }
      return { x: cx * size, y: cy * size };
    },

    worldToCell(x, y) {
      if (projection === "isometric") {
        const a = x / (tileWidth / 2);
        const b = y / (tileHeight / 2);
        return { cx: Math.round((a + b) / 2), cy: Math.round((b - a) / 2) };
      }
      return { cx: Math.floor(x / size), cy: Math.floor(y / size) };
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
        c.x + size, c.y,
        c.x + size, c.y + size,
        c.x, c.y + size,
      ];
    },
  };
}
