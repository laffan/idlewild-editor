/**
 * What a *project* is: the two choices made when it is created, the settings
 * that can change afterwards, and the row the home screen lists.
 *
 * Mirrors the same half of `src-tauri/src/project.rs`. Split from `types.ts`
 * for the 700-line rule, along the seam that file already had: everything
 * here is about the project, and everything left there is about the
 * *document* inside it — layers, fills, placements, zones, strokes.
 *
 * `types.ts` re-exports all of it, so nothing that imports these from there
 * has to know the split happened.
 */

import type { PublishTarget } from "./publish-target";

/**
 * The three templates.
 *
 * Isometric and orthogonal are lattices: cells are diamonds or squares of the
 * project's grid size, and everything the user draws snaps to one. Blank is
 * not — it addresses world pixels, so a selection is exactly the rectangle
 * that was dragged. `Grid.snaps` is what the rest of the editor reads.
 */
export type Projection = "isometric" | "orthogonal" | "blank";

/**
 * What kind of game the project scaffolds, and how play mode behaves.
 *
 * Top down is the original: a character walks the grid over A*, and the
 * camera follows it. A platformer is side-on — gravity, ground, a jump — and
 * reads the same document, taking non-walkable fills and blocking zones as
 * the solid ground rather than as obstacles to route around.
 *
 * Projects written before this existed carry no genre and are top down, which
 * is what they have always been.
 */
export type Genre = "topdown" | "platformer";

/**
 * How a project renders, and what its scaffold put in it.
 *
 * All four are settings: Project Options can change them, the editor applies
 * them to its own canvas, and the game reads them out of the generated config.
 *
 * `character` was the exception until the scaffold was split up: it was
 * resolved when the files were written, so a project either had a character
 * in it or no way back to one. `js/shared/character.js` is scaffolded either
 * way now and reads `config.character`, so the box is a box.
 *
 * Mirrored by `GameOptions` in src-tauri/src/project.rs.
 */
export interface GameOptions {
  /** Nearest-neighbour textures: what keeps a 16px sprite blocky as it scales. */
  pixelArt: boolean;
  /** Draw on whole pixels, so a fractional scroll does not smear a sprite. */
  roundPixels: boolean;
  /** The zoom a scene opens at, in the editor and in the game. */
  defaultZoom: number;
  /** Whether the project spawns the character controller — see above. */
  character: boolean;
}

/**
 * What a project written before the options existed has always been: no pixel
 * snapping, zoom 1, and a character, because the scaffold always wrote one.
 */
export const DEFAULT_OPTIONS: GameOptions = {
  pixelArt: false,
  roundPixels: false,
  defaultZoom: 1,
  character: true,
};

/**
 * What `defaultZoom` is allowed to be.
 *
 * Named here rather than typed into the control, because the editor's camera
 * clamps its own zoom and the two have to agree: a ceiling below this one
 * meant Project Options would take a number, write it into the config the
 * game reads, and then show the canvas at something else — the one place a
 * setting can lie without failing.
 */
export const ZOOM_RANGE = { min: 0.25, max: 8 } as const;

/**
 * A project's options, filled in.
 *
 * Rust writes the whole object on every save, so `options` is absent only on a
 * `meta.json` no build since has touched — and absent means the defaults.
 * Everything in the editor reads them through here rather than writing `??`
 * four times.
 */
export function projectOptions(meta: ProjectMeta): GameOptions {
  return { ...DEFAULT_OPTIONS, ...(meta.options ?? {}) };
}

/**
 * The page the game sits on: how big it is, where on the page, and what is
 * behind it.
 *
 * **Not part of `GameOptions`, and deliberately.** Those are how the *canvas*
 * renders, and the editor applies every one of them to the canvas in front of
 * you. None of this reaches that canvas at all — it describes the HTML
 * document the game is embedded in, which only the played or exported game
 * has. Keeping them apart means nothing in the editor has to work out which
 * half of one object applies to it.
 *
 * It reaches the game through `game.config.json`, where `js/main.js` reads it
 * and writes it onto the document as custom properties that `styles.css`
 * consumes. A project's stylesheet is its own file and nothing rewrites a line
 * of it — see `Presentation` in src-tauri/src/project.rs, which this mirrors.
 */
export interface Presentation {
  /** A fixed box rather than the whole window. */
  fixed: boolean;
  /** Read only while `fixed`, so turning it off and on returns what you had. */
  width: number;
  height: number;
  /** In the middle of the page, or at its top left. Nothing to see unfixed. */
  centered: boolean;
  /** Clear space around the game, in CSS pixels. */
  margin: number;
  /** Rounded corners on the game itself, in CSS pixels. */
  radius: number;
  /** The page behind the game — not Phaser's own background. `#rrggbb`. */
  background: string;
}

/**
 * The page a project has when nobody has said otherwise: the game filling the
 * window, square, flush — and matted on a neutral dark rather than on the
 * scaffold's blue.
 *
 * The blue is the *world's*: the editor's canvas ground, and what Phaser paints
 * behind the scenes. The page is what the game is mounted on, and is only
 * visible once a margin, a radius or a fixed size has pulled the game back from
 * an edge — where a second field of the same sky would read as the world
 * running on past its own border. `DEFAULT_BACKGROUND` in project.rs is the
 * same value and carries the argument.
 */
export const DEFAULT_PRESENTATION: Presentation = {
  fixed: false,
  width: 960,
  height: 540,
  centered: true,
  margin: 0,
  radius: 0,
  background: "#2d2b2b",
};

/**
 * What the sheet will take, matching `MIN_GAME_SIZE` / `MAX_GAME_SIZE` /
 * `MAX_SPACING` in project.rs.
 *
 * Both sides clamp. This side so the control cannot offer a number the far
 * side will quietly change, and that side because a `meta.json` is a file on a
 * disk and an archive is a file somebody hands you.
 */
export const GAME_SIZE_RANGE = { min: 16, max: 8192 } as const;
export const SPACING_RANGE = { min: 0, max: 512 } as const;

/**
 * A project's page, filled in. The counterpart of `projectOptions` above, and
 * absent for the same reason: a `meta.json` no build since has touched.
 */
export function projectPresentation(meta: ProjectMeta): Presentation {
  return { ...DEFAULT_PRESENTATION, ...(meta.presentation ?? {}) };
}

/** What the home screen lists. Cheap to load — no document body. */
export interface ProjectMeta {
  id: string;
  name: string;
  projection: Projection;
  /** Absent on projects created before the choice existed: they are top down. */
  genre?: Genre;
  gridSize: number;
  createdAt: number;
  updatedAt: number;
  layerCount: number;
  /** Absent on projects created before the options existed — see `projectOptions`. */
  options?: GameOptions;
  /** Where this project publishes to — absent on every project that has never
   *  been pointed anywhere. See `lib/publish-target.ts`. */
  publish?: PublishTarget;
  /** The page around the game — absent on projects made before Page Setup
   *  existed. See `projectPresentation`. */
  presentation?: Presentation;
}
