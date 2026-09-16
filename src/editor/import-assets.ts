/**
 * **Import Assets**: artwork into the project, several files at a time.
 *
 * The inverse of Export Assets, and it is in the menu beside it for the same
 * reason: neither is a publish, and both are about *pictures* rather than about
 * a program. Export Assets hands the artwork back; this is the door it comes in
 * by when there is more than one file to bring — a tileset drawn as nine PSDs
 * in another project, or a folder of sprites somebody sent over. Add Image asks
 * for a file, a paste carries one and a drop lands one, so nine files was nine
 * trips through a picker.
 *
 * Two routes, which are the two the request names. **Files** is the filesystem,
 * with as many files pickable at once as the platform allows. **Another
 * project** is the rest of this app: pick the project, tick its PSDs, and they
 * are copied in. What is deliberately *not* here is the photo library and the
 * clipboard — both are one image at a time by their nature, and both already
 * have a route of their own in Add Image and in ⌘V, which is where anybody
 * looks for them.
 *
 * The sheet is a list of routes rather than a form, the way Add Image, Publish
 * and Re-parse are: what somebody came here to say is *where from*, and each
 * answer needs something different next. Files needs a picker and nothing else;
 * a project needs a project and a set of ticks, so that route opens two more
 * steps in the same sheet.
 *
 * Every file then takes the route every other import takes. One off the
 * filesystem goes through the paste path — bytes, the two orienting marks, the
 * pipeline, a placement — so a PNG brought in here is indistinguishable from
 * one that was dropped on the canvas. A PSD out of another project is copied
 * inside the store and placed, because it is already carrying its own anchor
 * mark and its bytes have no business crossing the bridge twice.
 *
 * Going through the paste path rather than importing by name is what gets the
 * marks written: they describe where the artwork sits on the grid, and the grid
 * is the editor's — Rust has no way to ask about it, so a file imported by path
 * arrives with no anchor and says so in the inspector ever after. The cost is
 * that a padded raster is **cropped** to the pixels in it, as a drop is and as
 * Add Image is not. A drop off Finder is the same file arriving by another
 * gesture and it is cropped too, so this sides with the gesture rather than
 * with the sheet — see `trim-alpha.ts` for why the padding is a nuisance.
 *
 * **Nothing lands on top of anything else.** A bulk import that put twelve
 * files on the space in the middle of the view would look like one file, so
 * each is stepped clear of the one before it — see `importAll`.
 *
 * And **no file is written over**. Elsewhere a name decides a key outright,
 * which is what makes bringing `roof.png` home a replacement rather than a
 * second copy; here a collision is two files that happen to share a name, so
 * the second becomes `roof-2`. See `psd_pipeline::free_key`.
 */

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { clear, h } from "../lib/dom";
import { Grid } from "../lib/grid";
import { droppedFile, fromBase64, projects, psd, publish } from "../lib/ipc";
import type { ImportResult, PsdSummary } from "../lib/ipc";
import * as log from "../lib/log";
import { isMobile } from "../lib/platform";
import { openSheet, type SheetHandle } from "../lib/sheet";
import type { Cell, ProjectMeta } from "../lib/types";
import { IMPORT_SCALE, psdMargin } from "./import-anchor";
import { importPasted, type PasteTarget } from "./paste-actions";

/** What the desktop dialog offers. Neither mobile picker reads extensions. */
const IMAGE_EXTENSIONS = ["psd", "png", "jpg", "jpeg"];

export interface ImportAssetsDeps {
  projectId: string;
  /** Which platform, since the two file pickers differ — see `pickFiles`. */
  os: string;
  grid: Grid;
  /** Where an import lands, or null before the canvas is up. */
  target: () => PasteTarget | null;
}

/**
 * The sheet's three steps, and which one is showing.
 *
 * Two of them read something before they can draw — the project list, then one
 * project's PSDs — and both of those reads can land after somebody has pressed
 * Back. So a step takes a token when it starts and checks it before it writes:
 * without that, a slow read fills the body of a step nobody is looking at.
 */
interface Wizard {
  sheet: SheetHandle;
  deps: ImportAssetsDeps;
  /** Claim the sheet, and hand back a way to ask whether it has moved on. */
  enter: () => () => boolean;
}

export function openImportAssets(deps: ImportAssetsDeps): void {
  const sheet = openSheet({
    title: "Import Assets",
    subtitle: "Artwork from the filesystem, or from another project",
    width: 620,
  });
  let step = 0;
  const wizard: Wizard = {
    sheet,
    deps,
    enter: () => {
      const mine = ++step;
      return () => mine !== step;
    },
  };
  showRoutes(wizard);
}

/** The first thing the sheet asks, and the only thing it always asks. */
function showRoutes(wizard: Wizard): void {
  const { sheet, deps } = wizard;
  wizard.enter();
  clear(sheet.body);
  clear(sheet.actions);

  const list = h("div", { class: "sheet-list" });
  list.append(
    option("Import from Files", "PSDs and images · as many as you like", () => {
      sheet.close();
      void fromFiles(deps);
    }),
    option(
      "Import from another project",
      "The PSDs somebody drew over there, as the files they are",
      () => void showProjects(wizard),
    ),
  );

  sheet.body.appendChild(list);
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}

/**
 * The second step of the project route: which project.
 *
 * This one is left out of the list rather than greyed in it. Copying a file
 * over itself is not what this is for, and a second copy *inside* one project
 * already has a route — Make Unique, which gives it a name that reads as a copy
 * of what it came from.
 */
async function showProjects(wizard: Wizard): Promise<void> {
  const { sheet, deps } = wizard;
  const stale = wizard.enter();
  clear(sheet.body);
  clear(sheet.actions);
  sheet.body.appendChild(
    h("div", { class: "sheet-list-hint", text: "Reading the project list…" }),
  );
  sheet.actions.appendChild(back(() => showRoutes(wizard)));
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  let all: ProjectMeta[] = [];
  try {
    all = await projects.list();
  } catch (err) {
    log.error("Could not read the project list:", err);
  }
  if (stale()) return;
  const others = all.filter((meta) => meta.id !== deps.projectId);

  clear(sheet.body);
  if (others.length === 0) {
    sheet.body.appendChild(
      h("div", {
        class: "sheet-list-hint",
        text:
          "There is only this project. Import from Files instead, or open a " +
          "project file with Open on the home screen.",
      }),
    );
    return;
  }

  const list = h("div", { class: "sheet-list scroll" });
  for (const meta of others) {
    list.appendChild(
      option(
        meta.name,
        `${meta.projection} · ${meta.gridSize} px`,
        () => void showPsds(wizard, meta),
      ),
    );
  }
  sheet.body.appendChild(list);
}

/**
 * And the third: which of that project's files.
 *
 * It lists what is in its `psd/` rather than what its document places — the
 * same list Export Assets shows, for the same reason: a file whose placement
 * was deleted over there is still a file somebody drew, and artwork is the one
 * thing this is for.
 *
 * Nothing is ticked to begin with, which is the opposite of Export Assets.
 * There "all of them" is the common answer; here the usual answer is one or two
 * out of a project that may hold twenty, and every tick writes a file into this
 * one.
 */
async function showPsds(wizard: Wizard, from: ProjectMeta): Promise<void> {
  const { sheet, deps } = wizard;
  const stale = wizard.enter();
  clear(sheet.body);
  clear(sheet.actions);

  const chosen = new Set<string>();
  const boxes = new Map<string, HTMLInputElement>();
  const list = h("div", { class: "sheet-list scroll psd-picker" });
  const tally = h("div", { class: "sheet-row-key m" });
  const importButton = h("button", {
    class: "btn btn-primary",
    text: "Import",
    disabled: "true",
    onClick: () => {
      const keys = [...chosen];
      sheet.close();
      void fromProject(deps, from, keys);
    },
  }) as HTMLButtonElement;

  const refresh = () => {
    tally.textContent = `${chosen.size} of ${boxes.size} selected`;
    importButton.disabled = chosen.size === 0;
  };
  const setAll = (on: boolean) => {
    for (const [key, box] of boxes) {
      box.checked = on;
      if (on) chosen.add(key);
      else chosen.delete(key);
    }
    refresh();
  };

  sheet.body.append(
    h(
      "div",
      { class: "sheet-row" },
      h("div", { class: "sheet-row-key m", text: from.name }),
      h(
        "div",
        { class: "sheet-row-value picker-actions" },
        h("button", {
          class: "panel-btn",
          text: "All",
          onClick: () => setAll(true),
        }),
        h("button", {
          class: "panel-btn",
          text: "None",
          onClick: () => setAll(false),
        }),
        tally,
      ),
    ),
    list,
  );
  sheet.actions.append(
    importButton,
    back(() => void showProjects(wizard)),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  let files: PsdSummary[] = [];
  try {
    files = await publish.listPsds(from.id);
  } catch (err) {
    log.error(`Could not read the PSDs in ${from.name}:`, err);
  }
  if (stale()) return;

  if (files.length === 0) {
    list.appendChild(
      h("div", {
        class: "sheet-list-hint",
        text: `${from.name} has no PSDs in it yet.`,
      }),
    );
    refresh();
    return;
  }

  for (const file of files) {
    const box = h("input", {
      type: "checkbox",
      class: "check-box",
    }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(file.key);
      else chosen.delete(file.key);
      refresh();
    });
    boxes.set(file.key, box);
    list.appendChild(
      h(
        "label",
        { class: "psd-pick" },
        box,
        h("span", { class: "psd-pick-name", text: `${file.key}.psd` }),
        h("span", { class: "sheet-list-hint m", text: size(file.bytes) }),
      ),
    );
  }
  refresh();
}

/** Pick files off the filesystem and bring every one of them in. */
async function fromFiles(deps: ImportAssetsDeps): Promise<void> {
  const into = deps.target();
  if (!into) return log.warn("The canvas is not ready yet");

  let paths: string[] = [];
  try {
    paths = await pickFiles(deps.os);
  } catch (err) {
    log.error("Could not open the file picker:", err);
    return;
  }
  if (paths.length === 0) return;

  await importAll(deps, into, paths.length, (at, index) =>
    oneFile(deps.projectId, into, paths[index], at),
  );
}

/** And the same for a set of PSDs out of another project. */
async function fromProject(
  deps: ImportAssetsDeps,
  from: ProjectMeta,
  keys: readonly string[],
): Promise<void> {
  const into = deps.target();
  if (!into) return log.warn("The canvas is not ready yet");
  if (keys.length === 0) return;

  await importAll(deps, into, keys.length, (at, index) =>
    onePsd(deps.projectId, into, from, keys[index], at),
  );
}

/**
 * Bring `count` files in, each one stepped clear of the last.
 *
 * The step is the width of what actually landed plus a grid space, measured in
 * **world pixels** and converted back to a cell — so the row reads left to
 * right on the screen on a diamond grid as well as on a square one, where
 * stepping `cx` walks away from the camera instead. A file that failed to
 * import does not move the cursor: there is nothing standing there to step
 * around.
 *
 * One at a time rather than all at once, because the pipeline takes one job at
 * a time anyway (`psd_pipeline::exclusive`) and the width of each import is
 * what decides where the next one goes.
 */
async function importAll(
  deps: ImportAssetsDeps,
  into: PasteTarget,
  count: number,
  bring: (at: Cell, index: number) => Promise<ImportResult | null>,
): Promise<void> {
  const centre = deps.grid.cellToWorld(into.centreCell());
  const gap = psdMargin(deps.grid).x;
  let offset = 0;
  let landed = 0;

  for (let index = 0; index < count; index++) {
    const at = deps.grid.worldToCell({ x: centre.x + offset, y: centre.y });
    const result = await bring(at, index);
    if (!result) continue;
    landed++;
    offset += result.width * IMPORT_SCALE + gap;
  }

  if (landed === count) {
    log.info(`Imported ${landed} ${landed === 1 ? "file" : "files"}`);
  } else {
    log.warn(`Imported ${landed} of ${count} — see the errors above`);
  }
}

/**
 * One file off the filesystem, through the route a drop takes.
 *
 * The bytes come back from the shell rather than being read in the page: a
 * desktop picker hands over a path and an iPadOS one hands over a `file://`
 * URL, and `read_dropped_file` is already the one thing that turns either into
 * bytes with the name still attached. Going through the paste path from there
 * is what gets the two orienting marks written, which is the whole reason not
 * to import by path — Rust cannot mark a file, because the grid is the
 * editor's.
 *
 * The key is asked for before the import: a name decides a key, and two files
 * called `roof` are two files rather than one being brought home.
 */
async function oneFile(
  projectId: string,
  into: PasteTarget,
  path: string,
  at: Cell,
): Promise<ImportResult | null> {
  try {
    const read = await droppedFile(path);
    const key = await psd.freeKey(projectId, stemOf(read.name));
    const file = new File([fromBase64(read.dataBase64)], read.name);
    return await importPasted(projectId, into, key, file, at);
  } catch (err) {
    log.error(`Could not import ${path}:`, err);
    return null;
  }
}

/** And one out of another project, which is a copy inside the store. */
async function onePsd(
  projectId: string,
  into: PasteTarget,
  from: ProjectMeta,
  key: string,
  at: Cell,
): Promise<ImportResult | null> {
  try {
    const result = await psd.importFromProject(projectId, from.id, key);
    await into.placePsd(result.key, result.manifest, at, IMPORT_SCALE);
    log.info(`Imported ${result.key}.psd from ${from.name}`);
    return result;
  } catch (err) {
    log.error(`Could not import ${key}.psd from ${from.name}:`, err);
    return null;
  }
}

/**
 * Pick any number of files.
 *
 * Unfiltered on a touch device and filtered on a desktop, which is the split
 * Add Image and Open both make and for the same reason: iPadOS reads the filter
 * list to decide *which picker* to show, and every filter this app has is an
 * image type — a PSD included — so asking for the document browser with filters
 * attached opens the photo library instead. See `editor/sheets.ts`.
 */
async function pickFiles(os: string): Promise<string[]> {
  const picked = await openFileDialog({
    multiple: true,
    pickerMode: "document",
    filters: isMobile(os)
      ? undefined
      : [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });
  if (Array.isArray(picked)) return picked;
  return typeof picked === "string" ? [picked] : [];
}

/** One row of a sheet's list — the same shape Add Image and Publish use. */
function option(label: string, hint: string, onClick: () => void): HTMLElement {
  return h(
    "button",
    { class: "sheet-list-item", onClick },
    h("span", { text: label }),
    h("span", { class: "sheet-list-hint m", text: hint }),
  );
}

/** The way back a step, which every step but the first one has. */
function back(onClick: () => void): HTMLElement {
  return h("button", { class: "btn btn-ghost", text: "Back", onClick });
}

/** A filename's stem, which is what a key is made from. */
function stemOf(name: string): string {
  return (name.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").trim();
}

/** A file size a person reads, rather than a number of bytes. */
function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}
