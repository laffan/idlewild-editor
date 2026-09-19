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
 * What a project scaffolds into `game/`.
 *
 * It was `Genre` and it was two answers. Two more sit beside them now and
 * neither is a genre — they are how *much* scaffold a project wants, which is
 * what the New Project sheet calls Scaffolding.
 *
 * - `topdown` is the original: a character walks the grid over A*, and the
 *   camera follows it.
 * - `platformer` is side-on — gravity, ground, a jump — and reads the same
 *   document, taking non-walkable fills and blocking zones as the ground it
 *   stands on rather than as obstacles to route around.
 * - `p2p` is **Blank PSD to Phaser**: the plugin registered, every PSD loaded
 *   and the document placed, and nothing above that. No character, no
 *   pathfinder, no physics.
 * - `vanilla` is not a Phaser project at all — an `index.html`, a `style.css`
 *   and a `script.js` beside the exported `assets/`.
 *
 * **Drawing is the same on all four.** Nothing about the canvas, the tools or
 * what a selection does reads this; what it decides is the program on the
 * other side of the export. That is the whole reason the last two exist.
 *
 * Projects written before this existed carry nothing and are top down, which
 * is what they have always been. The field that carries one is still called
 * `genre`, on disk and in the generated config — see `Scaffold` in
 * src-tauri/src/project.rs for why renaming a key every project already has is
 * not a trade worth making.
 */
export type Scaffold = "topdown" | "platformer" | "p2p" | "vanilla";

/**
 * The scaffolds, in the order the sheet offers them, with what to call each.
 *
 * Here rather than in `new-project.ts` because three sheets read it: New
 * Project builds its segmented control from it, Project Options reports which
 * one a project was made with, and the home screen's card line names it. A
 * fourth reader is the label in a log line when a project is created.
 */
export const SCAFFOLDS: ReadonlyArray<{ value: Scaffold; label: string }> = [
  { value: "topdown", label: "Top Down" },
  { value: "platformer", label: "Platformer" },
  { value: "p2p", label: "Blank PSD to Phaser" },
  { value: "vanilla", label: "Vanilla" },
];

/** What to call a scaffold, including one this build does not know. */
export function scaffoldLabel(scaffold: Scaffold | undefined): string {
  return SCAFFOLDS.find((row) => row.value === scaffold)?.label ?? "Top Down";
}

/**
 * Whether the scaffold is a Phaser game: everything but `vanilla`.
 *
 * What it gates in the editor is Page Setup, which describes the page
 * `js/main.js` writes custom properties onto — a file a vanilla project does
 * not have. Mirrors `Scaffold::is_phaser` in src-tauri/src/project.rs.
 */
export function isPhaserScaffold(scaffold: Scaffold | undefined): boolean {
  return (scaffold ?? "topdown") !== "vanilla";
}

/**
 * Whether the scaffold writes a character controller.
 *
 * The switch is a switch on the two that do; on the other two there is no
 * `js/shared/character.js` to read it and no prefab for one to spawn, so both
 * sheets leave the row out rather than offering a setting with nothing behind
 * it. Rust clamps the stored value to match — see `store::create_project`.
 */
export function hasCharacter(scaffold: Scaffold | undefined): boolean {
  const value = scaffold ?? "topdown";
  return value === "topdown" || value === "platformer";
}

/**
 * How a project renders, and what its scaffold put in it.
 *
 * All four are settings: Project Options can change them, the editor applies
 * them to its own canvas, and the game reads them out of the generated config.
 *
 * `character` was the exception until the scaffold was split up: it was
 * resolved when the files were written, so a project either had a character
 * in it or no way back to one. `js/shared/character.js` is scaffolded either
 * way now and reads `config.character`, so the box is a box — on the two
 * scaffolds that have that file. On `p2p` and `vanilla` there is nothing for
 * it to reach, so both sheets leave the row out and Rust stores `false`
 * whatever arrives; see `hasCharacter` above.
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
  /**
   * What the project scaffolded — see `Scaffold`, which explains why a field
   * holding one is still called this. Absent on projects created before the
   * choice existed: they are top down.
   */
  genre?: Scaffold;
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
