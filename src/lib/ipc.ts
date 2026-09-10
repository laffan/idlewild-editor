/** Typed wrappers over the Tauri command surface in src-tauri/src/lib.rs. */

import { invoke } from "@tauri-apps/api/core";
import type { ProjectMeta, Projection } from "./types";

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
  cols: number;
  rows: number;
}

export interface ImportResult {
  key: string;
  width: number;
  height: number;
  manifest: string;
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

/** The base URL for a project's processed assets. */
export async function assetBase(projectId: string): Promise<string> {
  const port = await getServerPort();
  return `http://127.0.0.1:${port}/${projectId}`;
}

export const projects = {
  list: () => invoke<ProjectMeta[]>("list_projects"),
  create: (name: string, projection: Projection, gridSize: number) =>
    invoke<ProjectMeta>("create_project", { name, projection, gridSize }),
  rename: (id: string, name: string) =>
    invoke<ProjectMeta>("rename_project", { id, name }),
  remove: (id: string) => invoke<void>("delete_project", { id }),
  duplicate: (id: string) => invoke<ProjectMeta>("duplicate_project", { id }),
  meta: (id: string) => invoke<ProjectMeta>("read_project_meta", { id }),
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
  zip: (id: string) => invoke<string>("publish_zip", { id }),
  saveBytes: (path: string, dataBase64: string) =>
    invoke<void>("save_bytes", { path, dataBase64 }),
};
