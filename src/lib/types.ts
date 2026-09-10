/** Shared document + project types. Mirrored by src-tauri/src/project.rs. */

export type Projection = "isometric" | "orthogonal";

/** What the home screen lists. Cheap to load — no document body. */
export interface ProjectMeta {
  id: string;
  name: string;
  projection: Projection;
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

/**
 * A contiguous run of filled cells. Fills give grid space properties: a
 * colour or a pattern to draw, and whether a character may cross it.
 */
export interface FillPatch {
  id: string;
  cells: Cell[];
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

/** A freehand stroke. The engine port fills `points` out in a later pass. */
export interface Stroke {
  id: string;
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

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** The saved body of a project. Layers are ordered top-first. */
export interface GameDoc {
  version: 1;
  projection: Projection;
  gridSize: number;
  layers: Layer[];
  camera?: CameraState;
}

/** What the inspector is currently describing. */
export type Selection =
  | { kind: "none" }
  | { kind: "layer"; layerId: string }
  | { kind: "region"; from: Cell; to: Cell }
  | { kind: "fill"; layerId: string; fillId: string }
  | { kind: "placement"; layerId: string; placementId: string }
  | { kind: "zone"; layerId: string; zoneId: string };

export type EditorMode = "edit" | "play";

export type ToolId =
  | "select"
  | "pencil"
  | "eraser"
  | "fill"
  | "boundary"
  | "pan";

export interface PsdManifestEntry {
  key: string;
  width: number;
  height: number;
  layerPaths: string[];
}
