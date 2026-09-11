/** Typed wrappers over the Tauri command surface in src-tauri/src/lib.rs. */

import { invoke } from "@tauri-apps/api/core";
import type { Genre, ProjectMeta, Projection } from "./types";

/**
 * Bytes as the command surface takes them.
 *
 * Every route that hands Rust a file — an import, a paste, a drop, a saved
 * PNG — sends base64 over the bridge, so the encoding lives beside the calls
 * rather than being written out again in each caller. Chunked because
 * `String.fromCharCode` is applied to the whole run at once and a megabyte of
 * arguments overflows the stack.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * And back the other way, for bytes a command hands over.
 *
 * The buffer is spelled out because a plain `Uint8Array` is backed by
 * `ArrayBufferLike`, which a `Blob` will not take — and everything reading
 * this makes a `File` out of it.
 */
export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface GameFile {
  path: string;
  isDir: boolean;
}

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

/** A file taken off the system pasteboard — see src-tauri/src/clipboard.rs. */
export interface ClipboardFile {
  /** A filename with an extension; its stem becomes the PSD's key. */
  name: string;
  /** The pasteboard type the bytes came from, for the log. */
  uti: string;
  dataBase64: string;
}

export interface ClipboardRead {
  /** Everything the pasteboard offered, readable or not. */
  types: string[];
  file: ClipboardFile | null;
}

/**
 * The asset server's port. psd-to-phaser concatenates onto the base path it
 * is given and lazy-loads long after the initial load, so it needs a real
 * HTTP origin rather than Tauri's asset protocol.
 */
export const getServerPort = () => invoke<number>("get_server_port");

/**
 * The OS the shell is running on — `std::env::consts::OS`, so "macos",
 * "ios", "windows" or "linux". Handing a PSD to a desktop editor and handing
 * it to a share sheet are different gestures, and only the shell knows which
 * one it is.
 */
export const platform = () => invoke<string>("platform");

/**
 * What the system pasteboard is holding.
 *
 * The webview's own clipboard sees only a web-safe subset of it, which never
 * includes a PSD — so the shell is asked instead. See `editor/clipboard.ts`.
 */
export const clipboard = {
  read: () => invoke<ClipboardRead>("read_clipboard"),
};

/**
 * A file dropped on the window, read by path.
 *
 * Only where the shell intercepts the drag: a drop the webview handles itself
 * arrives as a `File` and needs nothing from Rust. See `editor/drop.ts`.
 */
export const droppedFile = (sourcePath: string) =>
  invoke<{ name: string; dataBase64: string }>("read_dropped_file", { sourcePath });

/** The base URL for a project's processed assets. */
export async function assetBase(projectId: string): Promise<string> {
  const port = await getServerPort();
  return `http://127.0.0.1:${port}/${projectId}`;
}

/**
 * Whether the asset server is answering the page at all.
 *
 * psd-to-phaser reads the project store over HTTP and by no other route, so a
 * webview that cannot reach `file_server.rs` is a project where every image
 * places as an empty selection box — and the only symptom is one load failure
 * per PSD, which reads like a problem with the PSD. The server answers its
 * own root, so one request at boot separates "the server is not reachable
 * from here" from "that one file is not there".
 *
 * Resolves to null when it answered, and to what went wrong when it did not.
 */
export async function checkAssetServer(base: string): Promise<string | null> {
  try {
    const response = await fetch(new URL(base).origin + "/", { cache: "no-store" });
    return response.ok ? null : `it answered HTTP ${response.status}`;
  } catch (err) {
    // A rejected fetch to loopback is the interesting case: the request never
    // arrived, so the webview refused to make it or nothing was listening.
    return err instanceof Error ? err.message : String(err);
  }
}

export const projects = {
  list: () => invoke<ProjectMeta[]>("list_projects"),
  create: (
    name: string,
    projection: Projection,
    gridSize: number,
    genre: Genre,
  ) => invoke<ProjectMeta>("create_project", { name, projection, gridSize, genre }),
  rename: (id: string, name: string) =>
    invoke<ProjectMeta>("rename_project", { id, name }),
  remove: (id: string) => invoke<void>("delete_project", { id }),
  duplicate: (id: string) => invoke<ProjectMeta>("duplicate_project", { id }),
  meta: (id: string) => invoke<ProjectMeta>("read_project_meta", { id }),
  /** Read a `.idlewild` file back in, as a new project of its own. */
  import: (path: string) => invoke<ProjectMeta>("import_project", { path }),
  thumbnail: (id: string) => invoke<string | null>("read_thumbnail", { id }),
  writeThumbnail: (id: string, pngBase64: string) =>
    invoke<void>("write_thumbnail", { id, pngBase64 }),
};

export const doc = {
  read: (id: string) => invoke<string>("read_document", { id }),
  write: (id: string, body: string) =>
    invoke<void>("write_document", { id, doc: body }),
};

export const gameFiles = {
  list: (id: string) => invoke<GameFile[]>("list_game_files", { id }),
  read: (id: string, path: string) =>
    invoke<string>("read_game_file", { id, path }),
  /**
   * The file as the scaffold wrote it — what a managed block's Reset puts
   * back. Rejects for a file the template does not write, which the code
   * modal reads as "this one is the user's alone".
   */
  template: (id: string, path: string) =>
    invoke<string>("read_game_template", { id, path }),
  write: (id: string, path: string, content: string) =>
    invoke<void>("write_game_file", { id, path, content }),
  createFile: (id: string, path: string) =>
    invoke<void>("create_game_file", { id, path }),
  createDir: (id: string, path: string) =>
    invoke<void>("create_game_dir", { id, path }),
  /** Move and rename are the same call with different intent. */
  move: (id: string, from: string, to: string) =>
    invoke<void>("move_game_path", { id, from, to }),
  /** Returns the path the copy actually took. */
  copy: (id: string, path: string) =>
    invoke<string>("copy_game_path", { id, path }),
  remove: (id: string, path: string) =>
    invoke<void>("delete_game_path", { id, path }),
};

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
  reprocess: (id: string, key: string, options?: Record<string, unknown>) =>
    invoke<string>("reprocess_psd", { id, key, options }),
  /** Overwrite `<key>.psd` with another file and run the pipeline again. */
  reimport: (id: string, key: string, sourcePath: string) =>
    invoke<ImportResult>("reimport_psd", { id, key, sourcePath }),
  /**
   * Copy a PSD to a key of its own and process it — what breaks a reference,
   * so one of two placements sharing a file can be changed alone.
   */
  duplicate: (id: string, key: string) =>
    invoke<ImportResult>("duplicate_psd", { id, key }),
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

export const publish = {
  /**
   * A zip you can serve: the game, its assets and both runtimes.
   *
   * Written straight to the path rather than handed back as base64 — an
   * archive carrying every processed asset has no business crossing this
   * boundary as a string first.
   */
  site: (id: string, path: string) => invoke<void>("publish_site", { id, path }),
  /** The project itself, as `.idlewild` — source PSDs included. */
  project: (id: string, path: string) =>
    invoke<void>("export_project", { id, path }),
  saveBytes: (path: string, dataBase64: string) =>
    invoke<void>("save_bytes", { path, dataBase64 }),
};
