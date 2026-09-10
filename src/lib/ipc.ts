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
};

export const psd = {
  /** Import from an OS path — Files, the share sheet, a deep link. */
  importPath: (id: string, sourcePath: string, name?: string) =>
    invoke<ImportResult>("import_image", { id, sourcePath, name }),
  /** Import bytes already in hand — clipboard, photo picker, a canvas blob. */
  importBytes: (id: string, name: string, dataBase64: string) =>
    invoke<ImportResult>("import_image_bytes", { id, name, dataBase64 }),
  /** Build a PSD straight from pixels — the route drawn strokes take. */
  fromRgba: (
    id: string,
    name: string,
    width: number,
    height: number,
    rgbaBase64: string,
  ) =>
    invoke<ImportResult>("create_psd_from_rgba", {
      id,
      name,
      width,
      height,
      rgbaBase64,
    }),
  reprocess: (id: string, key: string, options?: Record<string, unknown>) =>
    invoke<string>("reprocess_psd", { id, key, options }),
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
