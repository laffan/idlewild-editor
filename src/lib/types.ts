/**
 * Shared document types. Mirrored by `src-tauri/src/project.rs`.
 *
 * What a *project* is — the templates, the render options, the home screen's
 * row — is next door in `project-types.ts`, split off for the 700-line rule
 * and re-exported here, so every import of `ProjectMeta` or `GameOptions`
 * from this module still works. What is left here is the document: the
 * layers, fills, placements, zones and strokes inside one.
 */

export * from "./project-types";
export * from "./layer-types";

import type { Genre, Projection } from "./project-types";
import type {
  Background,
  LayerKind,
  PatternSpec,
  TileLayerData,
} from "./layer-types";
import type { TiledTileset } from "./tiled/types";
import type { PaintSpec } from "./paint";
import type { TextItem } from "./text-items";

/** Integer grid coordinates. Not pixels — see lib/grid.ts for the mapping. */
export interface Cell {
  cx: number;
  cy: number;
}

export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned box in world pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A contiguous run of filled cells. Fills give grid space properties: a
 * colour or a pattern to draw, and whether a character may cross it.
 */
export interface FillPatch {
  id: string;
  cells: Cell[];
  /**
   * Set instead of `cells` on a project whose grid does not snap, where the
   * fill is the exact rectangle that was selected. A blank template's cells
   * are single world pixels, so storing one per covered pixel would put a
   * hundred thousand of them in a document that means "this box".
   */
  rect?: Rect;
  kind: "color" | "pattern";
  /** Set when kind is "color". */
  color?: string;
  /** Set when kind is "pattern": the PSD key whose texture tiles the patch. */
  patternKey?: string;
  patternLayer?: string;
  /**
   * What the patch is *made of*, when it is not flat colour.
   *
   * Beside `kind` rather than a third value of it, because the two mean
   * different things: `kind: "pattern"` is a PSD in this project whose
   * texture tiles the patch, while this is a row in the app-wide library. A
   * patch is usually `kind: "color"` and carries one of these as well — the
   * colour is what the pattern or the shape is drawn in.
   */
  paint?: PaintSpec;
  walkable: boolean;
}

/**
 * A line of text on the canvas — see `lib/text-items.ts`, which owns the
 * shape and everything that measures or edits one.
 *
 * Re-exported here because this is where a document's shapes are read from and
 * because `Layer` names it; it lives there because what a `TextItem` *is* is
 * inseparable from how it is measured, and the measuring needs a canvas.
 */
export type { TextItem };

/** A PSD (or a layer inside one) placed into the world. */
export interface Placement {
  id: string;
  /** Key the PSD is registered under with psd-to-phaser. */
  psdKey: string;
  /** "root", or a layer path inside that PSD's manifest. */
  layerPath: string;
  /** World pixels, top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The size the manifest exported this layer at. `width`/`height` are the
   * displayed size, so the two differ once the image has been resized and
   * their ratio is the scale to apply. Optional: documents written before
   * resizing existed fall back to their displayed size, i.e. scale 1.
   */
  naturalWidth?: number;
  naturalHeight?: number;
  /** The cell the placement was anchored to, kept so a grid resize can follow. */
  anchor: Cell;
  /**
   * Where this layer's top-left sits relative to the PSD's `P | anchor` mark,
   * in the **file's own pixels**.
   *
   * What makes the mark survive an edit. A re-parse has to put the anchor
   * back on the world point it is standing on *now*, and `anchor` — a grid
   * space — can only say where it was pinned when it landed. The moment the
   * placement is resized, the offset it holds from that space scales with it
   * and the cell stops describing where the mark is; positions recomputed
   * from the cell then moved the artwork by the anchor's own offset times the
   * change in scale, which for an image import — anchored on its middle — is
   * half its width per doubling.
   *
   * Kept in the file's pixels rather than in the world so that nothing which
   * moves or resizes a placement has to maintain it: the mark stands at
   * `x - fromAnchor.x * scale`, which follows a drag and scales with a resize
   * on its own. Only placing and re-parsing write it, and both write it from
   * the manifest.
   *
   * Optional, because documents written before it existed have none and fall
   * back to the anchor cell — which is right for every placement that has not
   * been resized since, and is what the editor did for all of them before.
   */
  fromAnchor?: Point;
  /**
   * Which **unit** of the PSD this belongs to.
   *
   * Placing a PSD makes one placement per placeable layer, and they share
   * this: on the canvas they are one thing, dragged and resized together,
   * until a double-tap says otherwise. Optional because documents written
   * before it existed have none — see `game/unit.ts`.
   *
   * The field keeps the older name. A unit is not an *instance*: a unit is the
   * layers of one placed PSD, and an instance is one of several placed PSDs
   * reading the same file — `game/instances.ts`. Renaming a field that every
   * document in every project carries, and that the exported game reads, to
   * say the same thing a different way is not a trade worth making; every
   * reader of it comes through `unitOf`.
   */
  instance?: string;
  /**
   * Whether the PSD says this layer is turned off.
   *
   * A fact about the *file*, cached here for the reason `order` is: the
   * document is what the game's config is generated from, and once a
   * placement is in it nothing says what its manifest said. It is refreshed
   * every time the file is placed or re-parsed, so the PSD stays the truth
   * and this stays a copy of it.
   *
   * Hidden is about drawing rather than about existing: the asset is
   * exported, the object is made, and it starts turned off — in the editor
   * and in the game alike — so a project's own code can turn it on.
   */
  hidden?: boolean;
  /**
   * The layers *inside* this one that are turned off, by name.
   *
   * A group is placed whole, so a hidden child of one cannot be expressed by
   * leaving a placement out: what is turned off is one object inside a
   * placed group. Absent for the usual case of nothing hidden under it.
   */
  hiddenParts?: string[];
  /**
   * How high this layer sat in its PSD's stack, counting up from the back.
   *
   * A PSD is a stack of layers and the order is the artwork: a roof over a
   * tower is not the same picture as a tower over a roof. psd-to-json reports
   * it, psd-to-phaser applies it, and the editor needs it in the document
   * because a re-import can restack the file — reordering a PSD's layers in
   * the inspector is a supported edit, and the canvas has to follow it.
   *
   * Optional because documents written before it existed have none; the scene
   * fills them in on open from the order their placements were made in.
   */
  order?: number;
}

/**
 * A named place on the map — psd-to-phaser's `P | name`, made by hand.
 *
 * A point marks somewhere rather than covering something: where the
 * character starts, where a door leads, where a trigger sits. It has no size
 * and nothing to fill, so it is a position and a name and nothing else, and
 * the game reads it out of `config` by that name.
 *
 * A **cell**, where a zone is world pixels and a placement is both. A point
 * is put down on a space and dragged a whole space at a time, so world
 * coordinates would be a second copy of the same fact — one that a grid
 * resize would have to be taught to keep in step, and that Rust would have to
 * learn the projection to read back. `cellCentre` turns it into a position
 * wherever one is wanted, which on a blank project is the pixel that was
 * tapped, because a cell there is a pixel.
 */
export interface MapPoint {
  id: string;
  name: string;
  cell: Cell;
}

/**
 * A boundary: a psd-to-phaser zone with no PSD behind it. Drawn strokes get
 * promoted into these, and play mode reads `blocking` when building the
 * navigation grid.
 */
export interface Zone {
  id: string;
  name: string;
  /** World-pixel polygon, closed implicitly. */
  points: Point[];
  blocking: boolean;
}

/** A freehand stroke from the drawing layer. */
export interface Stroke {
  id: string;
  /**
   * World pixels, flat: `[x, y, pressure, x, y, pressure, …]`. Flat because
   * a document is JSON on disk and a sketch is thousands of points; pressure
   * per point because that is what makes a Pencil stroke taper.
   */
  points: number[];
  brushId: number;
  size: number;
  color: string;
  /**
   * What the stroke *is*: how its points are read, and what is drawn from
   * them.
   *
   * "ink" is stamped along the path and "highlight" is the same multiplied.
   * "fill" is not stamped at all — its points are a closed outline and what
   * is drawn is the inside of it — and "shape" stamps a *library shape* into
   * a box at each recorded point, which is what makes the Shape brush lay
   * tiles rather than a line. "erase" is **legacy**: it was the whole of the
   * Rub tool, back when rubbing out was a mode of its own, and erasing is a
   * *flag* now — see `erase` — so a stored stroke that says "erase" is read
   * as an inked one with that flag set. Documents hold them, so the reader
   * keeps it however long ago the tool went.
   */
  mode: "ink" | "highlight" | "erase" | "fill" | "shape";
  /**
   * Whether the mark is taken *out* of the layer rather than laid onto it.
   *
   * Orthogonal to `mode`, which is the point: what a tool would draw is what
   * it erases, so a Pattern brush set to erase takes out exactly the lattice
   * cells it would have revealed. One composite over the finished mark rather
   * than one per stamp — see `drawing/render.ts`.
   */
  erase?: boolean;
  /**
   * What the mark is made of, when it is not flat colour.
   *
   * Absent means colour: every stroke drawn before the libraries existed, and
   * every one drawn with the plain pencil since. The id it carries is a
   * *library* id, and the library is per install — see `lib/library/store.ts`
   * for why, and for what a project naming a row this machine does not have
   * draws instead.
   */
  paint?: PaintSpec;
  /**
   * The box each stamp fills, in world pixels. Only on a "shape" stroke: a
   * grid space, with `diamond` set on an isometric project, where the space
   * is the diamond inscribed in that box — see `lib/shape-path.ts`.
   */
  stamp?: { width: number; height: number; diamond?: boolean };
  createdAt: number;
}

/**
 * Placed PSDs tied together by hand — a group, in the sense every drawing
 * program means it.
 *
 * **The first thing in this document that the game is never told about.**
 * Everything else here is in `doc.json` because it is in `game.config.json`
 * too: a layer is Phaser's draw order, a collider is what stops a character, a
 * point is a place the project's own code reads back by name. A group is a
 * statement about how somebody is *working* — these three things are a
 * building — and `game_config.rs` reads the fields it names and ignores the
 * rest, so a grouped document exports the same game an ungrouped one does.
 *
 * It is saved all the same, which is the difference between this and the
 * overlay switches: a group travels in a `.idlewild`, comes back on another
 * machine, and is undone and redone with the rest of the document.
 *
 * What it holds is **unit keys** — see `lib/units.ts` — because a placed PSD
 * is one thing on the canvas however many layers came in with it, and because
 * a file re-parsed into a different number of layers then needs nothing here
 * rewritten. See `lib/groups.ts` for the rules, including why it is flat.
 */
export interface PlacementGroup {
  id: string;
  name: string;
  /** Unit keys, in the order they were put together. */
  units: string[];
}

export interface Layer {
  id: string;
  name: string;
  locked: boolean;
  visible: boolean;
  fills: FillPatch[];
  placements: Placement[];
  /**
   * Placed PSDs tied together by hand. Absent until something on this layer
   * has been grouped, and absent again once the last group has gone — see
   * `lib/groups.ts`.
   */
  groups?: PlacementGroup[];
  /**
   * Named places. Absent on every document written before the Point tool
   * existed, which is why `withScenes` fills it in on the way through rather
   * than leaving every reader to write `?? []`.
   */
  points: MapPoint[];
  zones: Zone[];
  strokes: Stroke[];
  /**
   * Words written on the canvas. Absent on every layer written before the text
   * tool existed, and absent again once the last one has gone — read through
   * `textsOf` in `lib/text-items.ts` rather than directly.
   */
  texts?: TextItem[];
  /**
   * What this layer is for. Absent on every layer written before there was
   * more than one kind, and absent means **object** — which is what a layer
   * has always been. Read through `layerKind` rather than directly.
   */
  kind?: LayerKind;
  /**
   * How this layer scatters what is placed on it. Only meaningful on a
   * pattern layer, and absent until one is made — `patternSpec` fills in the
   * defaults, which differ by `PatternType`.
   */
  pattern?: PatternSpec;
  /**
   * The colours and gradients behind everything, back-most last. Only
   * meaningful on a background layer, and absent until one is added.
   */
  backgrounds?: Background[];
  /**
   * The tiles on this layer, as a Tiled tile layer.
   *
   * Only meaningful on a tile layer, and absent until one is made. Held in
   * Tiled's own shape rather than in one of ours — see `TileLayerData` — so
   * that what `doc.json` carries and what a `.tmj` carries are the same
   * record. Read through `tileLayer` in `lib/tile-layers.ts`, which fills in
   * the empty one a layer that has never been painted on has none of.
   */
  tiles?: TileLayerData;
}

/**
 * The solid an extruded PSD was rasterised from, kept so it can be opened
 * back up and carried on with.
 *
 * Apply flattens a shape into pixels, and pixels cannot say where the columns
 * were — so without this a block-out is a one-way door. It is keyed by PSD
 * key rather than carried on a placement because the shape is a fact about
 * the *file*: two placements of one PSD are two views of the same solid, and
 * continuing either of them rewrites the file both draw.
 *
 * It outlives everything that happens to the file. A re-parse, a re-import, a
 * layer stack rewritten in the inspector: none of them change the key, and
 * the key is what this hangs from — which is the point, because the way back
 * into extrude mode is no use if editing the artwork takes it away.
 */
export interface Extrusion {
  /** Voxel keys, as `lib/extrude.ts` writes them: `"cx,cy,cz"`. */
  voxels: string[];
  /**
   * The space the artwork was anchored to when it was written.
   *
   * Kept so a placement that has since been dragged can be reopened where it
   * now stands: the difference between this and the placement's own anchor is
   * how far the whole shape has moved since.
   */
  anchor: Cell;
}

/**
 * The grid spaces a placed PSD blocks: its collider.
 *
 * Keyed by PSD key rather than carried on a placement, for the reason an
 * extrusion is: the shape is a fact about the *file*. A tree that blocks the
 * one space it stands on blocks it wherever it is put, and two instances of one
 * PSD are two views of the same thing.
 *
 * The spaces are **offsets from the space the artwork is anchored to**, so a
 * placement that has been dragged carries its collider with it without
 * anything having to be rewritten. Absolute coordinates would have to be
 * re-based on every drag, and two placements of one file could not share
 * them at all.
 */
export interface Collider {
  /** Cell offsets from the anchor. `{cx: 0, cy: 0}` is the anchor itself. */
  cells: Cell[];
  /**
   * Set instead of `cells` on a project whose grid does not snap, where the
   * collider is the box the artwork covers — measured from the anchor, in
   * cell units, which on a blank project are world pixels. A cell there is
   * one pixel, so a list of covered spaces would be a hundred thousand
   * records saying "this box" — the same bargain `FillPatch` makes.
   */
  rect?: Rect;
  /** Whether those spaces stop a character at all. */
  blocking: boolean;
  /**
   * Set once someone has edited the shape by hand.
   *
   * Applying an extrusion again recomputes the default, because the solid it
   * is derived from has just changed — but only while it is still a default.
   * An edited collider is someone's answer, and a second Apply is not a
   * reason to throw it away.
   */
  edited?: boolean;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * A scene: a set of layers and a canvas of its own.
 *
 * The same idea Phaser has. A project is several places — a title screen, a
 * cave, the overworld — and they share a grid, a genre and a pile of PSDs but
 * not a single thing standing on them. So layers hang off a scene rather than
 * off the document, and switching scenes is a clean canvas rather than a
 * filter over one.
 *
 * The camera rides the scene, because a scene is a place and you come back to
 * where you were standing in it.
 */
export interface Scene {
  id: string;
  name: string;
  /** Top-first, as the layer panel shows them. */
  layers: Layer[];
  camera?: CameraState;
  /**
   * The point the character starts on, by id.
   *
   * On the *scene* rather than on the point, because "only one of them" is
   * the whole of what makes it a start point: a flag on each point would let
   * two of them claim it and leave the game to pick. A scene has one place
   * where play begins or it has none, and this says which — the id, so
   * renaming or moving the point changes nothing about the designation.
   *
   * It names a point in one of this scene's layers. Deleting that point, or
   * the layer holding it, clears this rather than leaving it dangling.
   */
  startPointId?: string;
}

/** The saved body of a project. */
export interface GameDoc {
  version: 1 | 2;
  projection: Projection;
  /** Absent on documents written before the choice existed: top down. */
  genre?: Genre;
  gridSize: number;
  scenes: Scene[];
  activeSceneId: string;
  /**
   * The solids behind extruded PSDs, by key.
   *
   * Document-level rather than per scene, because a PSD is: `psd/` is one
   * directory for the project, an extruded file can be placed in more than
   * one scene, and the record is keyed by the file. Absent on documents
   * written before extrude mode existed, and on every project that has never
   * used it.
   */
  extrusions?: Record<string, Extrusion>;
  /**
   * What each placed PSD blocks, by key.
   *
   * Document-level for the same reason the extrusions are: a collider is a
   * fact about the file, one PSD can be placed in more than one scene, and it
   * blocks the same spaces in each. Absent on documents written before
   * colliders existed; the scene fills one in per placed key on open, from
   * the same defaults a fresh import gets.
   */
  colliders?: Record<string, Collider>;
  /**
   * The tilesets every tile layer in the project draws from, in Tiled's own
   * shape and its own order.
   *
   * Document-level for the reason the extrusions and the colliders are, and
   * for one more that is stronger. `psd/` is one directory for the project,
   * so the file a tileset is made of is the project's; and a gid stored on a
   * layer means *the nth tile across every tileset in the map*, so the list
   * and its `firstgid`s are what every one of those numbers is read against.
   * Per scene or per layer, adding a palette in one place would silently
   * renumber the tiles standing in another.
   *
   * Absent on every document written before tile layers existed, and on every
   * project that has never made one.
   */
  tilesets?: TiledTileset[];
  /**
   * Where layers lived before scenes existed, and where the camera did.
   *
   * Read once, by `DocStore`'s migration, and never written again — a
   * document that has been opened since has one scene holding what these
   * held. Kept on the type so that migration is a thing the compiler knows
   * about rather than a cast.
   */
  layers?: Layer[];
  camera?: CameraState;
}

/**
 * A document as it may arrive from disk.
 *
 * `scenes` and `activeSceneId` are the two fields a project written before
 * scenes existed does not have, so what is read is a document that may be
 * missing them and what everything downstream works on is one that is not —
 * see `withScenes`. Saying that in the type is what keeps the migration a
 * conversion rather than a cast.
 */
export type StoredDoc = Omit<GameDoc, "scenes" | "activeSceneId"> &
  Partial<Pick<GameDoc, "scenes" | "activeSceneId">>;

/** What the inspector is currently describing. */
export type Selection =
  | { kind: "none" }
  | { kind: "layer"; layerId: string }
  | { kind: "region"; from: Cell; to: Cell }
  | { kind: "fill"; layerId: string; fillId: string }
  | { kind: "placement"; layerId: string; placementId: string }
  /**
   * Several placed images at once, caught by dragging a box around them.
   *
   * One layer's worth: a drag moves every member by the same cell step, and
   * carrying placements between layers is the layer panel's job rather than
   * something a marquee should do by accident. `placement` stays its own kind
   * because almost everything — the inspector, resizing, opening a PSD up
   * into its layers — is about one thing and would have to ask "is there
   * exactly one?" on every line otherwise.
   */
  | { kind: "placements"; layerId: string; ids: string[] }
  | { kind: "point"; layerId: string; pointId: string }
  | { kind: "zone"; layerId: string; zoneId: string }
  /**
   * A colour or a gradient on a background layer.
   *
   * Only ever selected from the sidebar. A backdrop is camera-locked and
   * covers the whole view, so there is nothing on the canvas a click could
   * mean *it* rather than whatever is standing in front of it.
   */
  | { kind: "background"; layerId: string; backgroundId: string }
  /** A word written on the canvas — see `TextItem`. */
  | { kind: "text"; layerId: string; textId: string }
  | { kind: "strokes"; layerId: string; ids: string[] };

/**
 * The three things the editor is for, and the header's toggle between them.
 *
 * **Draw** is the canvas: the tools, the inspector, everything that puts
 * something down. **Code** is the project's own `game/` tree, which is code
 * *about* that canvas — so the panel can be pinned to an edge and leave the
 * canvas beside it, and the inspector steps out of the way because nothing in
 * it is about a file. **Play** runs the project's own program over the
 * document as it stands.
 *
 * Edit was what Draw is called, back when there were two of these. A document
 * never stored the mode, so the rename is a rename and nothing else.
 */
export type EditorMode = "draw" | "code" | "play";

/**
 * What the pointer is doing.
 *
 * Eleven tools over two columns — the rail's four and the drawing toolbar's
 * seven — and every one of them has a button. There was another with none:
 * "rub", the pencil with the paint taken out, offered as a toggle on PSD Edit
 * mode's own bar. It went when the four brushes learned to be turned round,
 * which gave that mode four erasers that work the way every other eraser in
 * the editor does. See `editor/tool-rail.ts` for which button is where and
 * `tool-routing.ts` for what each one means.
 *
 * "pattern" and "shape" paint with the library rather than with a colour, and
 * all four brushes can be turned round to erase — see `editor/tool-rail.ts`.
 *
 * "point", "zone" and "text" are the three ways of making something out of
 * bare ground: there is nothing already on an empty patch of canvas to promote
 * into any of them, so each has to be a thing you do to it. A boundary can
 * still be made the other way — from strokes already drawn and lassoed — which
 * is an action on a selection rather than a tool.
 */
export const TOOL_IDS = [
  "select",
  "pan",
  "point",
  "zone",
  "pencil",
  "pattern",
  "shape",
  "eraser",
  "lasso",
  "fill",
  "text",
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export interface PsdManifestEntry {
  key: string;
  width: number;
  height: number;
  layerPaths: string[];
}
