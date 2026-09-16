/**
 * The editor's modal sheets: Add Image, Replace PSD, Export selection,
 * Publish and Project Options.
 */

import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { psd, publish, toBase64 } from "../lib/ipc";
import type { AnchorMarks, ImportResult, PublishSettings } from "../lib/ipc";
import {
  describeTarget,
  targetIsSet,
  type PublishTarget,
} from "../lib/publish-target";
import { openPublishWhere } from "./publish-where";
import {
  projectOptions,
  ZOOM_RANGE,
  type GameOptions,
  type ProjectMeta,
} from "../lib/types";
import { isMobile } from "../lib/platform";
import * as log from "../lib/log";
import { clipboardImage } from "./clipboard";
import { pasteName } from "./paste";
import { trimTransparent } from "./trim-alpha";

/** What the desktop dialog offers. Neither mobile picker reads extensions. */
const IMAGE_EXTENSIONS = ["psd", "png", "jpg", "jpeg"];

/**
 * Pick a file through the *document* picker — Files on an iPad, the ordinary
 * open dialog on a Mac.
 *
 * On iPadOS **the filters decide, not `pickerMode`.** The plugin's own
 * comment says so: "if the picker mode is media, images, or videos, we always
 * want to show the media picker regardless of what's in the filters.
 * Otherwise, if the filters A) do not include non-media types and B) include
 * either image or video, we want to show the media picker." The two clauses
 * are `||`-ed, so `pickerMode: "document"` does not *force* anything — it
 * only declines to force the photo library, and the filter heuristic then
 * sends it there anyway. Every filter this app has is an image type, a PSD
 * included (`com.adobe.photoshop-image` conforms to `public.image`), so
 * asking for Files kept opening Photos.
 *
 * Passing no filters is what actually reaches the document picker: with none
 * to inspect, all three flags are false and the plugin falls through to
 * `UTType.item`, the catch-all. So mobile gets an unfiltered browser and the
 * desktop keeps its filtered dialog, which is the platform each one wants.
 * Anything undecodable is refused by the pipeline with a message naming it.
 */
function pickDocument(os: string): Promise<string | null> {
  return openFileDialog({
    multiple: false,
    pickerMode: "document",
    filters: isMobile(os)
      ? undefined
      : [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });
}

/** And the other half of that pair: the photo library, deliberately. */
function pickPhoto(): Promise<string | null> {
  return openFileDialog({ multiple: false, pickerMode: "image" });
}

/**
 * Add Image. Every route ends in the same place: bytes reach Rust, become a
 * PSD, and go through psd-to-json. That is what keeps the psd-to-phaser
 * integration uniform.
 */
export function openAddImage(
  projectId: string,
  os: string,
  onImported: (result: ImportResult) => void,
  marks?: AnchorMarks,
): void {
  const sheet = openSheet({
    title: "Add Image",
    subtitle: "Converted to PSD on import",
    width: 560,
  });

  const run = async (task: () => Promise<ImportResult | null>) => {
    sheet.close();
    try {
      const result = await task();
      if (result) {
        log.info(`Imported ${result.key} (${result.width}×${result.height})`);
        onImported(result);
      }
    } catch (err) {
      log.error("Import failed:", err);
    }
  };

  const list = h("div", { class: "sheet-list" });
  list.append(
    option("Import from Files", "PSD, PNG, JPEG", () =>
      run(async () => {
        const picked = await pickDocument(os);
        if (typeof picked !== "string") return null;
        return psd.importPath(projectId, picked, undefined, marks);
      }),
    ),
    option("Import from Photos", "Photo library", () =>
      run(async () => {
        const picked = await pickPhoto();
        if (typeof picked !== "string") return null;
        return psd.importPath(projectId, picked, undefined, marks);
      }),
    ),
    option("Paste from clipboard", "⌘V", () =>
      run(() => importClipboard(projectId, marks)),
    ),
  );

  sheet.body.appendChild(list);
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}

/**
 * Bring a PSD's edits back on a platform that cannot re-parse in place
 * without being asked where the file is, and hand back the manifest.
 *
 * **Four answers, and the first one is that the file never left.** Re-parse
 * runs the pipeline over `<project>/psd/<key>.psd` as it stands — which is
 * the whole of the desktop button, and is just as true on an iPad: the file
 * in the store is written by Apply in PSD Edit mode, by an extrusion, by a
 * rewritten layer stack, and by a project opened out of a `.idlewild`
 * archive. Every one of those is a file this editor changed and a manifest
 * that may be describing the version before it, and until now the only way
 * to re-read one on an iPad was to go and find a copy of it in Files.
 *
 * The other three are the ones a *replacement* arrives by, because "the
 * edited file came back" arrives by whichever route it was sent out through
 * — Files if it went to a document provider, Photos if it came back as a
 * flattened image, the clipboard if it was copied out of another app. Each
 * of those writes over `<project>/psd/<key>.psd` and re-runs psd-to-json,
 * which is what makes it a replacement rather than a second import: the key
 * does not move, so every placement already pointing at it still does.
 *
 * Resolves to null when the sheet is dismissed or a picker is cancelled —
 * backing out is not an error.
 */
export function openRefreshPsd(
  projectId: string,
  key: string,
  os: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (manifest: string | null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onEscape);
      resolve(manifest);
    };
    // The sheet closes itself on Escape and on a tap outside, and neither
    // goes through a button — so both have to be heard here as well, or a
    // dismissed sheet leaves this promise pending for the rest of the session.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(null);
    };
    document.addEventListener("keydown", onEscape);

    const sheet = openSheet({
      title: `Re-parse ${key}.psd`,
      subtitle: "Re-run the pipeline over this file, or over a replacement",
      width: 560,
    });

    const run = async (task: () => Promise<ImportResult | null>) => {
      sheet.close();
      try {
        const result = await task();
        if (!result) return settle(null);
        log.info(`Re-imported ${key}.psd (${result.width}×${result.height})`);
        settle(result.manifest);
      } catch (err) {
        log.error(`Could not re-import ${key}.psd:`, err);
        settle(null);
      }
    };

    /**
     * The file as it stands. Nothing is written, nothing is picked, and there
     * is nothing to report but the manifest — so it is its own runner rather
     * than an `ImportResult` faked up to fit the one above.
     */
    const reparse = async () => {
      sheet.close();
      try {
        settle(await psd.reprocess(projectId, key));
        log.info(`Re-parsed ${key}.psd`);
      } catch (err) {
        log.error(`Could not re-parse ${key}.psd:`, err);
        settle(null);
      }
    };

    const list = h("div", { class: "sheet-list" });
    list.append(
      option("Re-parse this file", "The file in the project, as it is", () =>
        void reparse(),
      ),
      option("Replace from Files", "PSD, PNG, JPEG", () =>
        run(async () => {
          const picked = await pickDocument(os);
          if (typeof picked !== "string") return null;
          return psd.reimport(projectId, key, picked);
        }),
      ),
      option("Replace from Photos", "Photo library", () =>
        run(async () => {
          const picked = await pickPhoto();
          if (typeof picked !== "string") return null;
          return psd.reimport(projectId, key, picked);
        }),
      ),
      option("Replace from clipboard", "⌘V", () =>
        // Importing under a key that already exists overwrites that key's
        // PSD and re-runs the pipeline over it, which is precisely a
        // replacement — there is nothing a separate command would do
        // differently, and a clipboard image never carries layers to lose.
        run(() => importClipboard(projectId, undefined, key)),
      ),
    );

    sheet.body.appendChild(list);
    sheet.actions.appendChild(
      h("button", {
        class: "btn btn-ghost",
        text: "Cancel",
        onClick: () => {
          sheet.close();
          settle(null);
        },
      }),
    );
    // Dismissing by the backdrop or Escape has to resolve too, or the caller
    // waits forever for a sheet that is no longer on screen.
    sheet.root.addEventListener("click", () => settle(null));
  });
}

function option(label: string, hint: string, onClick: () => void): HTMLElement {
  return h(
    "button",
    { class: "sheet-list-item", onClick },
    h("span", { text: label }),
    h("span", { class: "sheet-list-hint m", text: hint }),
  );
}

/** Export the current grid selection as a transparent PNG. */
export function openExportSelection(
  sizeLabel: string,
  renderPng: () => Promise<string>,
): void {
  const sheet = openSheet({
    title: "Export selection",
    subtitle: `${sizeLabel} · transparent PNG`,
    width: 520,
  });

  const savePng = async () => {
    sheet.close();
    try {
      const dataUrl = await renderPng();
      const path = await saveFileDialog({
        defaultPath: "selection.png",
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (!path) return;
      await publish.saveBytes(path, dataUrl);
      log.info(`Saved ${path}`);
    } catch (err) {
      log.error("Export failed:", err);
    }
  };

  const copyPng = async () => {
    sheet.close();
    try {
      const dataUrl = await renderPng();
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      log.info("Selection copied to the clipboard");
    } catch (err) {
      log.error("Could not copy to the clipboard:", err);
    }
  };

  sheet.actions.append(
    h("button", {
      class: "btn btn-primary",
      text: "Save PNG…",
      onClick: () => void savePng(),
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Copy to clipboard",
      onClick: () => void copyPng(),
    }),
  );
}

/**
 * Publish, which now has somewhere to go as well as something to hand you.
 *
 * At the top, **the project's own destination** — a directory on a server over
 * rsync, or a branch of a GitHub repository — with the login shared by every
 * project on the device and the destination per project. See
 * `publish-where.ts` and `publish-logins.ts` for that split, and `deploy.rs`
 * for what pushes.
 *
 * Under it, the two exits that were here before, and which are still the
 * answer where there is no server to publish to — an iPad, which cannot run
 * either program, or a project going somewhere by hand. **Export site** is a
 * zip you can serve: the game, its processed assets and both runtimes, and
 * nothing you would edit it with. **Export project** is a `.idlewild` file —
 * the project itself, source PSDs and all, to open somewhere else and carry on
 * with. The source files are the difference, and they are the part a published
 * site cannot give back.
 *
 * Both zips are written straight to the path the dialog returns; neither comes
 * back through the IPC boundary as base64 first.
 */
export function openPublish(projectId: string, projectName: string): void {
  const sheet = openSheet({ title: "Publish", width: 560 });

  const stem = projectName.replace(/[^\w-]+/g, "-").toLowerCase() || "idlewild";

  const run = async (
    what: string,
    extension: string,
    filterName: string,
    write: (path: string) => Promise<void>,
  ) => {
    sheet.close();
    try {
      const path = await saveFileDialog({
        defaultPath: `${stem}.${extension}`,
        filters: [{ name: filterName, extensions: [extension] }],
      });
      if (!path) return;
      await write(path);
      log.info(`${what} → ${path}`);
    } catch (err) {
      log.error(`${what} failed:`, err);
    }
  };

  // Filled once Rust has answered which servers exist and where this project
  // points — the sheet is up before either is known, and a strip that gains a
  // row reads better than a sheet that opens late.
  const destination = h("div", { class: "sheet-list" });
  const refresh = () => void showDestination(projectId, destination, sheet.close, refresh);
  refresh();

  const list = h("div", { class: "sheet-list" });
  list.append(
    option("Export site", "A zip to serve · game, assets, runtimes", () =>
      void run("Exported site", "zip", "Zip archive", (path) =>
        publish.site(projectId, path),
      ),
    ),
    option(
      "Export project",
      "A .idlewild file · everything, source PSDs included",
      () =>
        void run("Exported project", "idlewild", "Idlewild project", (path) =>
          publish.project(projectId, path),
        ),
    ),
  );

  sheet.body.append(destination, list);
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}

/**
 * The rows about publishing somewhere real, once it is known whether there is
 * anywhere.
 *
 * Two shapes. **Nothing set up** is one row that opens the destination sheet.
 * **Set up** is Publish, a rehearsal beside it, and the way back to the
 * settings. There is no third shape any more: this used to say that an iPad
 * could not publish, which was true of an implementation that ran `rsync` and
 * `git` as programs and is not true of one that links libgit2 and speaks SSH
 * itself. Both platforms take the same two rows.
 *
 * The rehearsal is there because the question it answers — "is this pointed
 * where I think it is?" — is one people ask with a finger already on Publish,
 * and the answer is cheap: rsync says what it would send, and a GitHub check
 * asks the repository whether the token can reach it.
 */
async function showDestination(
  projectId: string,
  into: HTMLElement,
  close: () => void,
  refresh: () => void,
): Promise<void> {
  let settings: PublishSettings;
  let target: PublishTarget;
  try {
    [settings, target] = await Promise.all([
      publish.settings(),
      publish.target(projectId),
    ]);
  } catch (err) {
    log.error("Could not read where this project publishes:", err);
    return;
  }

  const rows: HTMLElement[] = [];
  const server = settings.servers.find((one) => one.id === target.server);
  const where = describeTarget(target, server?.label || server?.host);
  const set = targetIsSet(target);

  if (set) {
    rows.push(
      option("Publish", where, () => {
        close();
        void send(projectId, where, false);
      }),
      option("Check it first", "say what would happen, send nothing", () => {
        close();
        void send(projectId, where, true);
      }),
    );
  }

  rows.push(
    option(
      set ? "Where this publishes…" : "Set up publishing…",
      set ? "change it" : "a server, or GitHub",
      () => openPublishWhere(projectId, () => refresh()),
    ),
  );
  into.replaceChildren(...rows);
}

/**
 * Push, and say how it went in the console.
 *
 * The console rather than a sheet with a spinner, because that is where this
 * editor says everything else — and because a publish that takes a minute
 * behind a modal is a minute with nothing to read. The first line goes out
 * before the call, so the drawer says what is happening while it happens.
 */
async function send(projectId: string, where: string, dryRun: boolean): Promise<void> {
  log.info(dryRun ? `Checking ${where}…` : `Publishing to ${where}…`);
  try {
    const report = await publish.toTarget(projectId, dryRun);
    log.info(report.summary);
    if (report.log.trim()) log.info(report.log);
  } catch (err) {
    log.error(dryRun ? "That check failed:" : "Publishing failed:", err);
  }
}

/** The three options Project Options can change, as it hands them back. */
/**
 * What this sheet can change, which is now all of `GameOptions`.
 *
 * It was three of the four — the character controller was resolved when the
 * scaffold was written and could only be reported here. The alias is kept
 * because it names the sheet's subject rather than the project's.
 */
export type RenderOptions = GameOptions;

/**
 * Project Options: what the project is, and the four things about it that can
 * still be changed.
 *
 * The template, the style and the grid scale are facts — the document is
 * addressed in them and the scaffold was written for them — so they are read
 * out rather than offered. The rest are not: pixel art, whole-pixel
 * drawing, the zoom a scene opens at and whether anything walks reach the canvas and the game through
 * values either of them reads at the time, so they are controls, and each one
 * takes effect as it is changed rather than on the way out. There is no Cancel
 * because there is no pending state to abandon.
 *
 * The character controller is in between, and is listed as a fact: it was lines
 * in a file, and the file became the project's own the moment it was written.
 * Unticking a box now would not take a character out of code that has one, so
 * the row says what happened instead of pretending to undo it.
 */
export function openProjectOptions(
  meta: ProjectMeta,
  layerCount: number,
  onApply: (options: RenderOptions) => void,
): void {
  const sheet = openSheet({
    title: "Project Options",
    subtitle: meta.name,
    width: 600,
  });

  const live: RenderOptions = { ...projectOptions(meta) };
  const apply = () => onApply({ ...live });

  // The four that can change, first: they are the reason to open this sheet,
  // and the facts under them are a reference rather than a form.
  sheet.body.append(
    toggleRow(
      "Pixel art",
      "Nearest-neighbour textures, so scaling keeps the pixels",
      live.pixelArt,
      (on) => {
        live.pixelArt = on;
        apply();
      },
    ),
    toggleRow(
      "Round pixels",
      "Draw on whole pixels, so a fractional scroll does not smear a sprite",
      live.roundPixels,
      (on) => {
        live.roundPixels = on;
        apply();
      },
    ),
    zoomRow(live.defaultZoom, (zoom) => {
      live.defaultZoom = zoom;
      apply();
    }),
    // The fourth, and the one that used to be a fact rather than a setting:
    // it was resolved when the scaffold was written, so this sheet could only
    // say which way it had gone. `js/shared/character.js` is written either
    // way now and reads the answer out of the generated config, so turning it
    // on is a save rather than a file appearing in somebody's project.
    toggleRow(
      "Character controller",
      "Spawn the prefab in js/prefabs/character.js, and follow it with the camera",
      live.character,
      (on) => {
        live.character = on;
        apply();
      },
    ),
  );

  const rows: Array<[string, string]> = [
    ["Template", meta.projection],
    ["Style", meta.genre === "platformer" ? "Platformer" : "Top Down"],
    [
      "Grid scale",
      meta.projection === "blank"
        ? `${meta.gridSize} px · nothing snaps`
        : `${meta.gridSize} px`,
    ],
    ["Layers", String(layerCount)],
    ["Created", new Date(meta.createdAt).toLocaleString()],
    ["Last edited", new Date(meta.updatedAt).toLocaleString()],
    ["PSD pipeline", "psd-to-json (Rust) → psd-to-phaser"],
  ];
  for (const [key, value] of rows) {
    sheet.body.appendChild(
      h(
        "div",
        { class: "sheet-row" },
        h("div", { class: "sheet-row-key m", text: key }),
        h("div", { class: "sheet-row-value", text: value }),
      ),
    );
  }

  sheet.actions.appendChild(
    h("button", { class: "btn btn-primary", text: "Done", onClick: sheet.close }),
  );
}

/** One switchable option, laid out on the same grid as the rows above it. */
function toggleRow(
  label: string,
  hint: string,
  initial: boolean,
  onChange: (on: boolean) => void,
): HTMLElement {
  const box = h("input", { type: "checkbox", class: "check-box" }) as HTMLInputElement;
  box.checked = initial;
  box.addEventListener("change", () => onChange(box.checked));

  return h(
    "div",
    { class: "sheet-row control" },
    h("div", { class: "sheet-row-key m", text: label }),
    h(
      "div",
      { class: "sheet-row-value" },
      h("label", { class: "check" }, box, h("span", { class: "check-hint", text: hint })),
    ),
  );
}

/**
 * The zoom a scene opens at.
 *
 * A number rather than a row of presets, because a project already has a value
 * and a preset row that did not include it would silently change it. Committed
 * on change — which for a number input is a typed digit or a step — and only
 * when it is a number the control's own bounds allow.
 */
function zoomRow(initial: number, onChange: (zoom: number) => void): HTMLElement {
  const input = h("input", {
    class: "input sheet-row-input",
    type: "number",
    min: String(ZOOM_RANGE.min),
    max: String(ZOOM_RANGE.max),
    step: "0.25",
  }) as HTMLInputElement;
  input.value = String(initial);
  input.addEventListener("change", () => {
    const zoom = Number(input.value);
    if (!Number.isFinite(zoom) || zoom <= 0) {
      input.value = String(initial);
      return;
    }
    onChange(Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, zoom)));
  });

  return h(
    "div",
    { class: "sheet-row control" },
    h("div", { class: "sheet-row-key m", text: "Default zoom" }),
    h(
      "div",
      { class: "sheet-row-value" },
      input,
      h("span", {
        class: "check-hint",
        text: "What a scene with no camera of its own opens at",
      }),
    ),
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Import whatever image is on the clipboard.
 *
 * The reading is `editor/clipboard.ts`, which asks the shell before it asks
 * the webview — on an iPad the webview is never shown a PSD, which is what
 * made this route report an empty clipboard over a pasteboard holding one.
 * What comes back is a `File`, so this is the same import every other route
 * makes, marks included.
 *
 * `key` names the PSD to write. Omitted, the paste gets a key of its own from
 * the file's name; given an existing one, it overwrites that file — which is
 * how the clipboard replaces a PSD as well as adding one.
 *
 * And that is the one difference in what arrives. A **new** import is cropped
 * to the pixels that are there, because a patch copied out of a layer-based
 * editor comes padded to the size of the document it was cut from and the
 * padding would otherwise become the artwork's size (see `trim-alpha.ts`). A
 * **replacement** is not: the file coming back is held where it is rather
 * than re-centred, so cropping it would slide the artwork out from under
 * every placement standing on it.
 */
async function importClipboard(
  projectId: string,
  marks?: AnchorMarks,
  key?: string,
): Promise<ImportResult> {
  const read = await clipboardImage();
  const file = key ? read : (await trimTransparent(read)).file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return psd.importBytes(projectId, key ?? pasteName(read), toBase64(bytes), marks);
}
