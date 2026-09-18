/**
 * The palettes **Browse Palettes** offers, carried over wholesale from
 * [simple-tileset-generator](https://laffan.github.io/simple-tileset-generator/).
 *
 * Upstream these are five JSON files under `swatches/` that the page `fetch`es
 * the first time the palettes tab is opened. Here they are a module, for the
 * reason every other asset in this app is committed rather than fetched: the
 * shell is a Tauri app that has to work with no network, on an iPad, and a
 * `fetch` of a relative path resolves against whichever of the two origins the
 * window happens to be on — see `Docs/shell-and-runtime.md`. Seven kilobytes
 * of hex is not worth an origin question.
 *
 * They are **somebody else's palettes**, which is why `PaletteSource` carries
 * a url and the browser draws it under each source's rows. The collection was
 * assembled by [Lionel Radisson](https://observablehq.com/@makio135/give-me-colors);
 * the credits in `temp-palettes.txt` upstream are the same five links.
 */

import { adobe } from "./adobe";
import { colorhunt } from "./colorhunt";
import { colourlovers } from "./colourlovers";
import { coolors } from "./coolors";
import { muzli } from "./muzli";
import type { PaletteSource } from "./types";

export type { PaletteRow, PaletteSource } from "./types";

/**
 * Every source, in the order the browser lists them.
 *
 * Upstream's order, which is not alphabetical and is not accidental: muzli's
 * rows are the loudest and colorhunt's the flattest, so the column reads from
 * something that grabs you to something you would build a tileset out of.
 */
export const PALETTE_SOURCES: readonly PaletteSource[] = [
  muzli,
  adobe,
  colourlovers,
  coolors,
  colorhunt,
];
