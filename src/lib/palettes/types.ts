/**
 * What a browsed palette is, which is less than you would expect.
 *
 * A row of hex colours and nothing else — no name, no id, no author. That is
 * what the five sources carry and it is all the browser shows, because a
 * palette here is a thing you take colours out of rather than a thing you
 * keep: what gets kept is the working palette in `lib/palette.ts`, and a
 * colour that has gone into it has stopped being anybody's row.
 */

/** One row of the browser: between three and six colours, `#rrggbb`. */
export type PaletteRow = readonly string[];

/** Where a run of rows came from, and the credit that has to travel with it. */
export interface PaletteSource {
  /** Stable, for the browser's own open/closed state. */
  id: string;
  name: string;
  /** Shown under the rows as a link. These are somebody else's palettes. */
  url: string;
  palettes: readonly PaletteRow[];
}
