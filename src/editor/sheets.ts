/**
 * The editor's modal sheets: Add Image, Replace PSD, Export selection,
 * Publish and Project Options.
 */

import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { psd, publish, toBase64 } from "../lib/ipc";
import type { AnchorMarks, ImportResult } from "../lib/ipc";
import type { ProjectMeta } from "../lib/types";
import { isMobile } from "../lib/platform";
import * as log from "../lib/log";
import { clipboardImage } from "./clipboard";
import { pasteName } from "./paste";

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
 * Replace the file behind an existing PSD key, and hand back the manifest
 * the pipeline produced.
 *
 * The same three routes as Add Image, because "the edited file came back"
 * arrives by whichever of them the user sent it out through — Files if it
 * went to a document provider, Photos if it came back as a flattened image,
 * the clipboard if it was copied out of another app. The button used to go
 * straight to one of the three, and on iPadOS it went to the wrong one.
 *
 * Every route writes over `<project>/psd/<key>.psd` and re-runs psd-to-json,
 * which is what makes it a replacement rather than a second import: the key
 * does not move, so every placement already pointing at it still does.
 * Resolves to null when the sheet is dismissed or a picker is cancelled —
 * backing out is not an error.
 */
export function openReplacePsd(
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
      title: `Re-import ${key}.psd`,
      subtitle: "Replaces the file and re-runs the pipeline",
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

    const list = h("div", { class: "sheet-list" });
    list.append(
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

/** Publish. A zipped copy for now; rsync targets are explicitly deferred. */
/**
 * Publish, which has two exits.
 *
 * **Export site** is a zip you can serve: the game, its processed assets and
 * both runtimes, and nothing you would edit it with. **Export project** is a
 * `.idlewild` file — the project itself, source PSDs and all, to open
 * somewhere else and carry on with. The source files are the difference, and
 * they are the part a published site cannot give back.
 *
 * Both are written straight to the path the dialog returns; neither comes
 * back through the IPC boundary as base64 first.
 */
export function openPublish(projectId: string, projectName: string): void {
  const sheet = openSheet({
    title: "Publish",
    subtitle: "rsync targets coming later",
    width: 560,
  });

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

  sheet.body.appendChild(list);
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}

export function openProjectOptions(meta: ProjectMeta, layerCount: number): void {
  const sheet = openSheet({
    title: "Project Options",
    subtitle: meta.name,
    width: 600,
  });

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
 */
async function importClipboard(
  projectId: string,
  marks?: AnchorMarks,
  key?: string,
): Promise<ImportResult> {
  const file = await clipboardImage();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return psd.importBytes(projectId, key ?? pasteName(file), toBase64(bytes), marks);
}
