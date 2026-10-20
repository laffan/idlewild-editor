/**
 * A PSD laid into an isometric grid's plane — the same orientations a note can
 * take (`lib/text-items.ts`), for a placed file. Mirrored by `GridAlign` in
 * `src-tauri/src/psd_grid_align.rs`, and kept in `ProjectMeta.gridAlign` by
 * key: the file itself is not changed, its processed sprites are.
 */

import type { Grid } from "./grid";
import { groundPlane } from "./text-items";

export interface GridAlign {
  /** Which diagonal the file's rows run along. */
  runs: "cx" | "cy";
  /** Standing up, like a sign on a wall, rather than lying on the floor. */
  upright: boolean;
  /** Where the file's x and y axes go on the canvas — unit vectors. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** The setting for an orientation on this grid, or null where there is no plane. */
export function gridAlignFor(
  grid: Grid,
  how: { runs: "cx" | "cy"; upright: boolean },
): GridAlign | null {
  const plane = groundPlane(grid, { runs: how.runs, upright: how.upright });
  return plane ? { runs: how.runs, upright: how.upright, ...plane } : null;
}
