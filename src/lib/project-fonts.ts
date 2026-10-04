/**
 * A project's own typefaces, loaded into the page so the Text tool can set
 * notes in them.
 *
 * Kept in `<project>/fonts/` by `src-tauri/src/project_fonts.rs`, and loaded
 * here with the **`FontFace` API** from the file's own bytes: no URL, no
 * network and no stylesheet, so the editor's offline rule holds and WKWebView
 * on an iPad — which has had `FontFace` since iOS 10 — takes it the same as
 * the Mac does. A family is ready once `load()` has settled, which is what
 * `loadProjectFonts` waits for, so a note measured after it is measured in
 * the face and not in whatever it fell back to.
 *
 * Module state, for the reason `lib/print.ts`'s source scale is: this is a
 * one-project-at-a-time app, and the font menu is drawn far from anything
 * that holds the project.
 */

import { invoke } from "@tauri-apps/api/core";
import { fromBase64, toBase64 } from "./ipc";
import * as log from "./log";
import type { FontChoice } from "./system-fonts";

/** One font the project keeps — mirrored by `ProjectFont` in Rust. */
export interface ProjectFont {
  family: string;
  file: string;
}

/** What a font file may be called. */
export const FONT_EXTENSIONS = ["ttf", "otf", "woff", "woff2"] as const;

export function isFontFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (FONT_EXTENSIONS as readonly string[]).includes(ext);
}

export const fontsIpc = {
  list: (id: string) => invoke<ProjectFont[]>("list_project_fonts", { id }),
  save: (id: string, name: string, dataBase64: string) =>
    invoke<ProjectFont>("save_project_font", { id, name, dataBase64 }),
  saveDropped: (id: string, sourcePath: string) =>
    invoke<ProjectFont>("save_dropped_font", { id, sourcePath }),
  read: (id: string, file: string) => invoke<string>("read_project_font", { id, file }),
  remove: (id: string, file: string) => invoke<void>("delete_project_font", { id, file }),
};

let fonts: ProjectFont[] = [];
/** The faces this page has had added, by family, so a reload replaces them. */
const faces = new Map<string, FontFace>();
const listeners = new Set<() => void>();

/** The id a note stores for a project font — quoted, with a generic behind. */
export function projectFontId(family: string): string {
  return `"${family.replace(/"/g, "")}", sans-serif`;
}

/** The project's fonts, as the font menu offers them. */
export function projectFontChoices(): FontChoice[] {
  return fonts.map((font) => ({ id: projectFontId(font.family), name: font.family }));
}

export function projectFonts(): readonly ProjectFont[] {
  return fonts;
}

/** Be told when the project's fonts change. Returns the way to stop. */
export function onProjectFontsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Put one font's face in the page, from its bytes, and wait for it. */
async function install(family: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const face = new FontFace(family, bytes.buffer);
  await face.load();
  const old = faces.get(family);
  if (old) document.fonts.delete(old);
  document.fonts.add(face);
  faces.set(family, face);
}

/**
 * Read every font the project has and put it in the page. Called as a
 * project opens, before anything is measured; a font that will not load is
 * named in the log and the rest still arrive.
 */
export async function loadProjectFonts(projectId: string): Promise<void> {
  clearProjectFonts();
  let listed: ProjectFont[] = [];
  try {
    listed = await fontsIpc.list(projectId);
  } catch (err) {
    log.warn("Could not list this project's fonts:", err);
    return;
  }
  const loaded: ProjectFont[] = [];
  await Promise.all(
    listed.map(async (font) => {
      try {
        await install(font.family, fromBase64(await fontsIpc.read(projectId, font.file)));
        loaded.push(font);
      } catch (err) {
        log.warn(`Could not load the font ${font.file}:`, err);
      }
    }),
  );
  fonts = listed.filter((font) => loaded.includes(font));
  changed();
}

/** Forget the last project's faces — leaving it, or opening another. */
export function clearProjectFonts(): void {
  for (const face of faces.values()) document.fonts?.delete(face);
  faces.clear();
  fonts = [];
}

/** Keep fonts in the project, from `File`s (dropped or picked), and load them. */
export async function addFontFiles(projectId: string, files: readonly File[]): Promise<ProjectFont[]> {
  const added: ProjectFont[] = [];
  for (const file of files) {
    if (!isFontFile(file.name)) {
      log.info(`${file.name} is not a font — TTF, OTF, WOFF or WOFF2`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const font = await fontsIpc.save(projectId, file.name, toBase64(bytes));
      await install(font.family, bytes);
      added.push(font);
    } catch (err) {
      log.error(`Could not add the font ${file.name}:`, err);
    }
  }
  return remember(added);
}

/** The same, for paths the macOS shell handed over. */
export async function addFontPaths(projectId: string, paths: readonly string[]): Promise<ProjectFont[]> {
  const added: ProjectFont[] = [];
  for (const path of paths) {
    try {
      const font = await fontsIpc.saveDropped(projectId, path);
      await install(font.family, fromBase64(await fontsIpc.read(projectId, font.file)));
      added.push(font);
    } catch (err) {
      log.error(`Could not add the font ${path.split(/[\\/]/).pop()}:`, err);
    }
  }
  return remember(added);
}

/** Take one out of the project and the page. */
export async function removeProjectFont(projectId: string, font: ProjectFont): Promise<void> {
  try {
    await fontsIpc.remove(projectId, font.file);
  } catch (err) {
    log.error(`Could not remove the font ${font.file}:`, err);
    return;
  }
  const face = faces.get(font.family);
  if (face) document.fonts?.delete(face);
  faces.delete(font.family);
  fonts = fonts.filter((f) => f.file !== font.file);
  changed();
}

function remember(added: ProjectFont[]): ProjectFont[] {
  if (added.length === 0) return added;
  const files = new Set(added.map((f) => f.file));
  fonts = [...fonts.filter((f) => !files.has(f.file)), ...added].sort((a, b) =>
    a.family.toLowerCase().localeCompare(b.family.toLowerCase()),
  );
  for (const font of added) log.info(`Added the font ${font.family} to this project`);
  changed();
  return added;
}
