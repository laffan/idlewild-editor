/**
 * What the next piece of text is written in.
 *
 * A property of the **tool** rather than of the document, which is the same
 * reading every brush keeps: set the size once and the next five notes are
 * that size. It lives on the scene beside the active layer — the two facts the
 * canvas needs in order to know what a tap makes — and the inspector writes it
 * whenever the style of a selected piece is changed, because that is the only
 * control there is and having a second one for "the next one" would be a
 * second answer to the same question.
 *
 * Its own file rather than a few lines in `world-scene.ts` for the reason
 * `adjusting.ts` is one: the scene is against the 700-line rule, and none of
 * this touches Phaser, the camera or the display list.
 */

import { GENERIC_FONTS } from "../lib/system-fonts";
import type { TextStyleFields } from "../lib/text-items";

/**
 * Everything a piece of text is written in, which is everything about it
 * except its words, its place and its measured box.
 *
 * `lib/text-items.ts` owns the list, so a property added to a note is carried
 * from one to the next without this file being told.
 */
export type TextStyle = TextStyleFields;

/**
 * What the first note in a project is written in.
 *
 * **Not the accent.** The editor draws its own marks in the accent —
 * selection outlines, the extrude plate, a blocking boundary — so a note
 * arriving in it would be the one piece of text nobody could tell from chrome,
 * which is exactly the argument the colour picker makes about a fill starting
 * grey. Near-black on the pale blue ground, which is what writing on paper
 * looks like.
 *
 * Twenty-four pixels is a heading against a 64px grid space and still legible
 * zoomed out to a room's worth of canvas; the size is the first thing anybody
 * changes either way.
 */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  size: 24,
  color: "#1d1f22",
  // The first of the generics `lib/system-fonts.ts` always offers, so a first
  // note is set to something the picker can show as chosen whatever this
  // device turns out to have installed.
  font: GENERIC_FONTS[0].id,
  align: "left",
};
