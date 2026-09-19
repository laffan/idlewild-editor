/** Typed wrappers over the Tauri command surface in src-tauri/src/lib.rs. */

import { invoke } from "@tauri-apps/api/core";

// Two halves live next door, split off for the 700-line rule and re-exported
// here so nothing that imports `publish` or `psd` from this module has to
// know: leaving with a project — the three exports and the two real publishes
// — and everything asked about a PSD, which is the format the whole app is
// built around.
export * from "./ipc-publish";
export * from "./ipc-psd";

import type {
  GameOptions,
  Presentation,
  ProjectMeta,
  Projection,
  Scaffold,
} from "./types";

/**
 * How many bytes are encoded as one standalone piece.
 *
 * A **multiple of three**, which is the whole trick: base64 turns three bytes
 * into four characters, so a run whose length divides by three encodes to
 * exactly what it would have encoded to inside the whole buffer. The pieces
 * can therefore be joined afterwards instead of the bytes being joined first.
 */
const B64_BYTES = 3 * 16384;

/** And how many arguments `String.fromCharCode` is spread over at once. */
const SPREAD = 0x8000;

/**
 * Bytes as the command surface takes them.
 *
 * Every route that hands Rust a file — an import, a paste, a drop, a converted
 * sketch — sends base64 over the bridge, so the encoding lives beside the
 * calls rather than being written out again in each caller.
 *
 * **Encoded in pieces, not in one go.** This used to build a `binary` string
 * the size of the whole buffer and hand that to `btoa`. A converted sketch is
 * routinely ten megabytes, which made that ten megabytes of rope
 * concatenation followed by a single `btoa` over ten megabytes: **four
 * hundred milliseconds of a desktop machine**, measured, for a raster of
 * 1826 × 1412 — and an iPad is several times slower again. Encoding
 * forty-eight kilobytes at a time and joining the results is the same string
 * in a fifth of the time (96 ms on the same raster), which is what makes it
 * an optimisation rather than a change.
 *
 * Both loops are load-bearing. The outer one keeps each piece a multiple of
 * three so it can stand alone; the inner one keeps the argument list handed
 * to `String.fromCharCode` inside what an engine will spread — a megabyte of
 * arguments overflows the stack.
 */
export function toBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  const view =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < view.length; i += B64_BYTES) {
    const end = Math.min(i + B64_BYTES, view.length);
    let binary = "";
    for (let j = i; j < end; j += SPREAD) {
      binary += String.fromCharCode(...view.subarray(j, Math.min(j + SPREAD, end)));
    }
    parts.push(btoa(binary));
  }
  return parts.join("");
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
  /**
   * And the other direction: put one of a project's PSDs on the pasteboard, so
   * ⌘V in another project brings it in.
   *
   * The webview cannot do this either — a page may write plain text, HTML and
   * a PNG, and a PSD is none of those — so the shell writes it as the file it
   * is. See `editor/clipboard.ts`.
   */
  copyPsd: (id: string, key: string) =>
    invoke<void>("copy_psd_to_clipboard", { id, key }),
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
  /**
   * Make one. `scaffold` crosses as `genre`, which is the name the field has
   * on disk and in every document written so far — see `Scaffold`.
   */
  create: (
    name: string,
    projection: Projection,
    gridSize: number,
    scaffold: Scaffold,
    options: GameOptions,
  ) =>
    invoke<ProjectMeta>("create_project", {
      name,
      projection,
      gridSize,
      genre: scaffold,
      options,
    }),
  /**
   * Change how a project renders and what moves in it. Hands back the meta as
   * written, and rewrites the config the project's own code reads — so a game
   * that is up picks the change up on its next start.
   *
   * All four, the character controller included. It used to be the one that
   * could only be reported: it was resolved when the scaffold was written, so
   * unticking a box could not take a character out of code that already had
   * one. `shared/character.js` reads the answer out of the config now, so the
   * files are the same either way and the box is a box.
   */
  setOptions: (id: string, options: GameOptions) =>
    invoke<ProjectMeta>("set_project_options", {
      id,
      pixelArt: options.pixelArt,
      roundPixels: options.roundPixels,
      defaultZoom: options.defaultZoom,
      character: options.character,
    }),
  /**
   * The page the game sits on — what Page Setup writes.
   *
   * One object rather than six arguments: `setOptions` above grew a parameter
   * at a time and shows it, and six positional numbers and booleans is a call
   * nobody can read at either end.
   */
  setPresentation: (id: string, presentation: Presentation) =>
    invoke<ProjectMeta>("set_project_presentation", { id, presentation }),
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
  /**
   * Find a string in every file of `game/` — ⇧⌘F, over the file column.
   *
   * One call rather than a read per file: the alternative is twenty round
   * trips and twenty copies of the tree crossing this boundary as JSON on
   * every keystroke. See `game_search.rs` for what it skips and where it
   * stops.
   */
  search: (id: string, query: string, caseSensitive: boolean) =>
    invoke<SearchResults>("search_game_files", { id, query, caseSensitive }),
};

/** One line of one file that a cross-file Find matched. */
export interface FileMatch {
  /** Relative to `game/`, exactly as the file column names it. */
  path: string;
  /** 1-based, which is what `CodeModal.openAt` takes. */
  line: number;
  /** Where in the line the match starts, in UTF-16 code units — see the Rust. */
  column: number;
  length: number;
  /** The line itself, for the row to show. */
  text: string;
}

export interface SearchResults {
  matches: FileMatch[];
  /** Whether the cap was reached, so the strip can say the list is partial. */
  truncated: boolean;
  /** How many files were read. */
  files: number;
}
