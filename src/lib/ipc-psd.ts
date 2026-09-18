/**
 * Everything the shell is asked about a **PSD**.
 *
 * Split from `ipc.ts` for the 700-line rule, along the same kind of seam
 * `ipc-publish.ts` was: that one is every call about getting a project *out*,
 * this one is every call about the format the whole app is built around. What
 * is left in `ipc.ts` is the shell itself — the port, the platform, the
 * pasteboard — and the project and its code. `ipc.ts` re-exports all of it, so
 * nothing that imports `psd` or `AnchorMarks` from there has to know the split
 * happened.
 *
 * The thing to keep in mind reading it is the one in
 * [the technical README](../../README-TECHNICAL.md): **everything that enters
 * this editor becomes a PSD**. A dropped PNG, a pasted screenshot, a lassoed
 * sketch, a run of filled grid spaces and an extruded solid all arrive at
 * psd-to-phaser through this file.
 */

import { invoke } from "@tauri-apps/api/core";

export interface OutputFile {
  absolutePath: string;
  relativePath: string;
  filename: string;
  isJson: boolean;
}

/**
 * Where an import was dropped on the grid, written into the PSD as the
 * `P | anchor` and `Z | grid` marks. Omitted when there was no grid
 * selection behind it — a pasted screenshot, a rasterised sketch — and the
 * PSD then carries no marks. See `editor/import-anchor.ts`.
 *
 * Both marks go **under** the artwork and arrive turned off, whatever the
 * conversion: they are the editor's rows rather than the artist's picture,
 * and a file opened anywhere that draws a PSD's flattened composite would
 * otherwise have a red dot and a lattice over it. See `psd_marks.rs`.
 */
export interface AnchorMarks {
  /** The selection's outline in world pixels, relative to the anchor cell. */
  outline: Array<{ x: number; y: number }>;
  /** The divisions between the spaces it covers, same frame of reference. */
  lines: Array<{
    a: { x: number; y: number };
    b: { x: number; y: number };
  }>;
  /**
   * Where the artwork's top-left goes relative to the anchor. Omitted by an
   * image import, which has no opinion and gets centred; sent by anything
   * converted from what is already on the grid, which knows exactly which
   * pixels belong over which spaces.
   */
  art?: { x: number; y: number };
  /**
   * Empty room to leave around everything else, in the same pixels.
   *
   * The canvas is otherwise exactly the artwork and the footprint, edge to
   * edge, which is a file with nowhere to draw the eaves that hang past the
   * wall. A margin grows the *canvas* and nothing else: the artwork keeps its
   * size, its position relative to the anchor and therefore its position on
   * the grid — see `editor/import-anchor.ts`.
   */
  margin?: { x: number; y: number };
  cols: number;
  rows: number;
}

/**
 * One layer of a PSD as it really is on disk, top-first — what the inspector
 * lists so the stack can be reordered and renamed without leaving the app.
 */
export interface PsdLayerInfo {
  /** Its position in the *current* file, which is how an edit names it. */
  index: number;
  name: string;
  visible: boolean;
  opacity: number;
  width: number;
  height: number;
  x: number;
  y: number;
  /** What psd-to-json will make of it, read from the pipe prefix. */
  category: "sprite" | "tileset" | "group" | "point" | "zone" | "ignored";
  /**
   * The type segment, when the name carries one: `atlas`, `spritesheet`,
   * `animation`, `jpg`.
   *
   * It is what tells a folder of layers apart from a single composited image.
   * A group named `S | confetti | atlas |` is one picture as far as the game
   * is concerned, and what is indented under it are its frames rather than
   * layers anybody can place.
   */
  type: string | null;
  /** Whether this row is a group holding the rows indented under it. */
  isGroup: boolean;
  /** How deep it sits: zero at the top level, one inside a group. */
  depth: number;
}

export interface PsdLayerList {
  key: string;
  width: number;
  height: number;
  layers: PsdLayerInfo[];
  /**
   * False when a rewrite would lose something the fork cannot express —
   * masks, clipping. The list is then read-only and `blockedBy` says why.
   * Groups are not among them: they come back as rows of their own, with
   * their contents indented under them. See src-tauri/src/psd_layers.rs.
   */
  writable: boolean;
  blockedBy: string | null;
}

/**
 * A row in the order, at the depth, and under the name it should end up with.
 *
 * The whole tree goes over flattened the way the inspector shows it — top
 * first, a group followed by what is inside it — and `depth` is what says
 * which of those it is. See src-tauri/src/psd_layers.rs.
 */
export interface PsdLayerEdit {
  index: number;
  name: string;
  depth: number;
  /**
   * Whether the layer's eye is on. Left out to keep whatever the file has,
   * which is what every rewrite made before the eye column existed means.
   */
  visible?: boolean;
}

/**
 * A rectangle of ink to lay into one layer of a PSD, in the file's own
 * pixels — what PSD Edit mode applies. See src-tauri/src/psd_paint.rs.
 */
export interface PsdPaint {
  x: number;
  y: number;
  width: number;
  height: number;
  /** RGBA8, `width * height * 4` bytes. */
  rgbaBase64: string;
  /**
   * The coverage a turned-round brush takes *out* of the layer, over the same
   * rectangle and in the same format — only its alpha is read.
   *
   * Applied before the ink, which is the order the strokes were drawn in. Left
   * out when nothing in the session erased anything, which is the ordinary
   * case and saves sending a buffer of zeroes.
   */
  eraseBase64?: string;
}

/**
 * The working palette, as a PSD carries it out to another app.
 *
 * See src-tauri/src/psd_palette.rs. `cell` is one square's side in pixels —
 * a quarter of the project's grid, which is the only scale a PSD has any
 * relation to.
 */
export interface PsdPaletteStrip {
  /** `#rrggbb` or `#rrggbbaa`, in the order the palette holds them. */
  colors: string[];
  cell: number;
}

/** What a palette sync did, so the editor can say so. */
export interface PsdPaletteSync {
  /** Whether the file on disk was rewritten. */
  changed: boolean;
  /** Why nothing was written, when something was asked for. */
  skipped: string | null;
}

/** One raster layer of a generated group. The name is the exported one. */
export interface PsdPart {
  name: string;
  rgbaBase64: string;
}

export interface ImportResult {
  key: string;
  width: number;
  height: number;
  manifest: string;
}

/**
 * One placed thing going into a merge.
 *
 * `key` and `path` name what to take — the PSD, and the top-level layer or
 * group of it this placement stands for, which is exactly what a `Placement`
 * already carries. The box is where it lands on the merged canvas, in that
 * canvas's own pixels: already scaled, so a placement somebody resized on the
 * grid arrives at the size it actually looked.
 */
export interface MergePart {
  key: string;
  path: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export const psd = {
  /** Import from an OS path — Files, the share sheet, a deep link. */
  importPath: (
    id: string,
    sourcePath: string,
    name?: string,
    marks?: AnchorMarks,
  ) => invoke<ImportResult>("import_image", { id, sourcePath, name, marks }),
  /** Import bytes already in hand — clipboard, photo picker, a canvas blob. */
  importBytes: (
    id: string,
    name: string,
    dataBase64: string,
    marks?: AnchorMarks,
  ) => invoke<ImportResult>("import_image_bytes", { id, name, dataBase64, marks }),
  /** Build a PSD straight from pixels — the route drawn strokes take. */
  fromRgba: (
    id: string,
    name: string,
    width: number,
    height: number,
    rgbaBase64: string,
    marks?: AnchorMarks,
  ) =>
    invoke<ImportResult>("create_psd_from_rgba", {
      id,
      name,
      width,
      height,
      rgbaBase64,
      marks,
    }),
  /**
   * An empty tiled backdrop, `width` x `height` pixels.
   *
   * What New Background writes for an image backdrop: a PSD the size the
   * backdrop is going to be, holding the anchor mark and `T | Background`
   * with one transparent sprite layer to paint into. No pixels cross the
   * bridge — the buffer is tens of megapixels and Rust writes it.
   *
   * In pixels rather than in grid spaces because the grid is the editor's:
   * how wide a space is, and whether it is a diamond, is a question Rust has
   * no way to ask. See `editor/background-actions.ts`.
   */
  background: (
    id: string,
    name: string,
    width: number,
    height: number,
    marks: AnchorMarks,
  ) =>
    invoke<ImportResult>("create_background_psd", {
      id,
      name,
      width,
      height,
      marks,
    }),
  /**
   * A PSD whose artwork is a *group* of raster layers rather than one sprite.
   *
   * What an extrusion writes. Every part is the same size and sits at the
   * same offset, which is what makes resizing the placed group exact —
   * psd-to-phaser scales each child about its own origin, so children with
   * different origins would drift apart. Parts are sent top-first, as
   * Photoshop's panel lists them.
   */
  fromParts: (
    id: string,
    name: string,
    width: number,
    height: number,
    parts: PsdPart[],
    marks: AnchorMarks,
  ) =>
    invoke<ImportResult>("create_psd_group_from_rgba", {
      id,
      name,
      width,
      height,
      parts,
      marks,
    }),
  /**
   * Several placed PSDs, written back out as one file.
   *
   * The arrangement is the editor's arithmetic — it is what the placements
   * say — so each part arrives with its box already in the merged file's own
   * pixels, **back-first**: the Rust side stacks them in the order they are
   * given and never asks what a grid is. See `psd_merge.rs`.
   *
   * `name` is a suggestion rather than a key. A merge writes a *new* file, so
   * the first free name is taken — writing over a `tower.psd` still standing
   * on the grid is the one outcome nobody could have asked for.
   */
  merge: (
    id: string,
    name: string,
    width: number,
    height: number,
    parts: MergePart[],
    marks: AnchorMarks,
  ) =>
    invoke<ImportResult>("merge_psds", {
      id,
      name,
      width,
      height,
      parts,
      marks,
    }),
  /**
   * Rewrite that group in a PSD this editor already wrote, keeping every
   * other layer in the file.
   *
   * The difference from `fromParts` is what happens to work someone did in
   * Photoshop between one write and the next. That builds a file from
   * nothing; this rebuilds the one that is there, so a layer painted over a
   * generated block-out survives the block-out being regenerated. Takes a key
   * rather than a name — the file exists, so there is nothing to sanitise.
   */
  rewriteParts: (
    id: string,
    key: string,
    width: number,
    height: number,
    parts: PsdPart[],
    marks: AnchorMarks,
  ) =>
    invoke<ImportResult>("rewrite_psd_group_from_rgba", {
      id,
      key,
      width,
      height,
      parts,
      marks,
    }),
  /** The PSD's real layer stack, top-first, and whether it can be rewritten. */
  readLayers: (id: string, key: string) =>
    invoke<PsdLayerList>("read_psd_layers", { id, key }),
  /**
   * Rewrite the stack in the given order and under the given names, then run
   * psd-to-json over it again. Returns the fresh manifest.
   */
  writeLayers: (id: string, key: string, layers: PsdLayerEdit[]) =>
    invoke<string>("write_psd_layers", { id, key, layers }),
  /**
   * Put an empty sprite layer on the top of the stack, and re-parse.
   *
   * It arrives holding a single transparent pixel — a real row to rename,
   * reorder or draw into, and nothing for the game to draw yet.
   */
  addLayer: (id: string, key: string) =>
    invoke<string>("add_psd_layer", { id, key }),
  /**
   * Lay ink into one layer of the file, over whatever it already holds.
   *
   * `index` is a row of the list `readLayers` returned and `name` is what it
   * was called then; Rust checks both, because a paint against a stale index
   * would silently draw into the wrong layer.
   */
  paintLayer: (
    id: string,
    key: string,
    index: number,
    name: string,
    paint: PsdPaint,
  ) => invoke<string>("paint_psd_layer", { id, key, index, name, paint }),
  reprocess: (id: string, key: string, options?: Record<string, unknown>) =>
    invoke<string>("reprocess_psd", { id, key, options }),
  /** Overwrite `<key>.psd` with another file and run the pipeline again. */
  reimport: (id: string, key: string, sourcePath: string) =>
    invoke<ImportResult>("reimport_psd", { id, key, sourcePath }),
  /**
   * Copy a PSD to a key of its own and process it — what **Make Unique** does,
   * so one of several objects sharing a file can be changed alone.
   */
  duplicate: (id: string, key: string) =>
    invoke<ImportResult>("duplicate_psd", { id, key }),
  /**
   * The key a **bulk** import should write under: the name somebody offered, or
   * the first free step from it — `roof`, then `roof-2`.
   *
   * Asked for rather than worked out here, because the rule for what survives
   * being a filename is Rust's (`sanitise_stem`) and a second copy of it on
   * this side would be a second answer. Only Import Assets wants it: every
   * other route lets a name decide a key outright, which is what makes
   * bringing a file home a replacement rather than a second copy.
   */
  freeKey: (id: string, name: string) =>
    invoke<string>("free_psd_key", { id, name }),
  /**
   * Copy a PSD out of another project in this app and process it here.
   *
   * The bytes never cross the bridge — both projects are directories in the
   * same store — and a PSD carries its own anchor mark, so what lands is the
   * file that left. See `src-tauri/src/import_assets.rs`.
   */
  importFromProject: (id: string, fromId: string, key: string) =>
    invoke<ImportResult>("import_psd_from_project", { id, fromId, key }),
  /**
   * Rename a PSD and re-run the pipeline under the new key. `name` is raw
   * user input; the key that actually resulted comes back on the result, so
   * the caller repoints its placements at that rather than at what was typed.
   */
  rename: (id: string, key: string, name: string) =>
    invoke<ImportResult>("rename_psd", { id, key, name }),
  /** Hand the PSD to whatever the OS opens PSDs with. */
  openExternally: (id: string, key: string) =>
    invoke<void>("open_psd", { id, key }),
  /**
   * Put the working palette into the file, or take it back out.
   *
   * Called immediately before the file goes out to another app. `null` is a
   * request to *remove* a strip an earlier send left behind rather than a
   * request to do nothing — see `psd_palette`.
   */
  syncPalette: (id: string, key: string, strip: PsdPaletteStrip | null) =>
    invoke<PsdPaletteSync>("sync_psd_palette", { id, key, strip }),
  /** The PSD's own bytes, base64 — what the iPadOS share sheet needs. */
  bytes: (id: string, key: string) =>
    invoke<string>("read_psd_bytes", { id, key }),
  manifest: (id: string, key: string) =>
    invoke<string>("read_psd_manifest", { id, key }),
  isProcessed: (id: string, key: string) =>
    invoke<boolean>("is_psd_processed", { id, key }),
  outputs: (id: string, key: string) =>
    invoke<OutputFile[]>("list_psd_outputs", { id, key }),
  thumbnail: (path: string, maxSize = 128) =>
    invoke<string>("psd_thumbnail", { path, maxSize }),
  preview: (id: string, key: string) =>
    invoke<string>("psd_preview", { id, key }),
  assetUrl: (id: string, relative: string) =>
    invoke<string>("read_asset_data_url", { id, relative }),
};
