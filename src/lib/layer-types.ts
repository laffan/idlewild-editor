/**
 * What a *kind* of layer holds.
 *
 * Split out of `types.ts` the way `project-types.ts` was, and for the same
 * two reasons: that file reached its seven hundred lines, and this is a seam
 * rather than a cut. `types.ts` is the shape of a document — the layers, the
 * fills, the placements, the zones, the strokes. This is the payload each
 * kind of layer carries instead, which is `lib/layer-kinds.ts`'s subject and
 * nothing else's. Re-exported from `types.ts`, so every existing import of
 * `LayerKind` or `PatternSpec` from there still works.
 */

import type { Cell, Point } from "./types";
import type { TiledTileLayer } from "./tiled/types";

/**
 * What a layer is *for*, which decides what putting a PSD on it means.
 *
 * An **object** layer is what a layer has always been: things stand where
 * they were put, one placement per top-level layer of the file, and the
 * canvas selects, drags and resizes them. Everything else in this editor was
 * written against that reading, so it is the default and the absent value.
 *
 * A **pattern** layer holds a *palette* rather than a scene. The placements
 * on it are the elements the pattern is made of; where they are drawn is
 * worked out from `pattern` for as far as the camera can see, which is why
 * nothing on one can be picked on the canvas — there is no one object under
 * the pointer to name.
 *
 * A **background** layer is the backdrop: colours and gradients that follow
 * the camera rather than sitting anywhere, and PSDs painted as scenery. Both
 * are reached from the sidebars, for the same reason — a backdrop is
 * everywhere the camera is, so there is nothing on it to aim at.
 *
 * A **tile** layer is a Tiled map. Its placements are a *tileset* rather than
 * a scene or a scatter — a PSD on one is cut on the project's own grid
 * boundaries and shown in the inspector as a palette, and what stands on the
 * ground is gids in `tiles`. It is the one kind that is not offered on every
 * project: a tileset is a picture cut into equal spaces, and a blank project
 * has no spaces to cut on. See `tileLayersAllowed`.
 *
 * See `lib/layer-kinds.ts` for everything that reads this, and
 * `lib/tile-layers.ts` for what a tile layer holds.
 */
export type LayerKind = "object" | "pattern" | "background" | "tile";

/**
 * How a pattern layer scatters its elements.
 *
 * Random is the default and the interesting one: grass, rocks, trees — things
 * whose arrangement should read as unconsidered. Grid is the same machinery
 * with the randomness taken out of the position, for a tiled floor or a
 * regular field of columns.
 */
export type PatternType = "random" | "grid";

/**
 * An area a pattern is confined to.
 *
 * Two shapes because there are two ways to say "here": a run of grid spaces,
 * from the long-press selection every other part of this editor asks space
 * with, and a polygon, from the pencil. Both answer the same question —
 * *is this space inside?* — so they are one record with two fields rather
 * than two kinds a reader has to switch on.
 */
export interface PatternShape {
  id: string;
  name: string;
  /** Grid spaces, from the selection tool. */
  cells?: Cell[];
  /** A world-pixel polygon, closed implicitly, from the pencil. */
  points?: Point[];
}

/**
 * What a pattern layer does with what is placed on it.
 *
 * The pattern is **infinite and deterministic**: there is no world bound in
 * this editor to fill, so what is stored is a rule and the canvas works out
 * what falls inside it. `repeat` is what makes that possible — the rule is
 * evaluated one repeat tile at a time and seeded by the tile's own
 * coordinates, so the same space answers the same way whatever route the
 * camera took to get there, and the exported game can regenerate it without
 * being shipped a list.
 *
 * `shapes` is the exception to infinite. An empty list means everywhere,
 * which is the default; a shape in it confines the pattern to the spaces
 * that shape covers.
 */
export interface PatternSpec {
  type: PatternType;
  /** How many elements land in each repeat tile. */
  density: number;
  /** The repeat tile, in grid spaces. */
  repeat: { cols: number; rows: number };
  /**
   * What the arrangement is generated from.
   *
   * Kept in the document rather than derived from the layer id, so that
   * duplicating a scene gives the copy the pattern it was showing rather
   * than a different one — and so that a pattern somebody likes survives a
   * rename.
   */
  seed: number;
  shapes: PatternShape[];
}

/**
 * A backdrop on a background layer: a colour or a gradient.
 *
 * Both are camera-locked and have no extent — a backdrop is wherever the
 * camera is, so there is nothing to position and nothing to size. That is
 * also why an **image** background is not one of these: a picture painted in
 * Photoshop is a thing of a certain size standing in a certain place, which
 * is what a `Placement` already is, and the exported game already loads,
 * places, scales and stacks one. Adding an image background makes a PSD and
 * places it on this layer; what makes it a background is the layer it is on.
 */
export interface Background {
  id: string;
  name: string;
  kind: "color" | "gradient";
  /** Set when kind is "color". */
  color?: string;
  /** Set when kind is "gradient": two stops and the direction between them. */
  gradient?: { from: string; to: string; angle: number };
}

/**
 * A tile layer's tiles: a Tiled tile layer, held verbatim.
 *
 * The first rule of a tile layer is that its data is indistinguishable from
 * data Tiled wrote, so what the document stores is not a design of ours with
 * a converter at each end — it *is* Tiled's record, in Tiled's spelling, and
 * a `.tmj` is assembled from it rather than translated out of it. See
 * `lib/tiled/types.ts` for the transcription and `Docs/tile-layers.md` for
 * why infinite and chunked is the only shape that fits a canvas with no edge.
 */
export type TileLayerData = TiledTileLayer;
