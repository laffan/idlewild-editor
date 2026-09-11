/** Shared document + project types. Mirrored by src-tauri/src/project.rs. */

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
}

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
  walkable: boolean;
}

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
   * Which placed instance of the PSD this belongs to.
   *
   * Placing a PSD makes one placement per placeable layer, and they share
   * this: on the canvas they are one thing, dragged and resized together,
   * until a double-tap says otherwise. Optional because documents written
   * before it existed have none — see `game/instance.ts`.
   */
  instance?: string;
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

/**
 * What a fill covers, in the units it is stored in.
 *
 * A run of grid spaces counts spaces; a rectangle on a blank project has no
 * spaces to count and reports its size, because "0 spaces" is what a fill
 * that covers 420 by 260 pixels was saying before this existed.
 */
export function describeFill(fill: FillPatch): string {
  if (fill.rect) {
    return `${Math.round(fill.rect.width)} × ${Math.round(fill.rect.height)} px`;
  }
  return `${fill.cells.length} ${fill.cells.length === 1 ? "space" : "spaces"}`;
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
  /** "ink" paints, "highlight" multiplies. */
  mode: "ink" | "highlight";
  createdAt: number;
}

export interface Layer {
  id: string;
  name: string;
  locked: boolean;
  visible: boolean;
  fills: FillPatch[];
  placements: Placement[];
  zones: Zone[];
  strokes: Stroke[];
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
  | { kind: "zone"; layerId: string; zoneId: string }
  | { kind: "strokes"; layerId: string; ids: string[] };

export type EditorMode = "edit" | "play";

/**
 * The rail's tools. Boundary is not among them: a boundary is made from
 * strokes already drawn and lassoed, so it is an action on a selection
 * rather than a mode you draw in.
 */
export type ToolId = "select" | "pan" | "pencil" | "eraser" | "lasso";

export interface PsdManifestEntry {
  key: string;
  width: number;
  height: number;
  layerPaths: string[];
}
