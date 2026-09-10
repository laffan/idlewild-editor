/**
 * The editor's modal sheets: Add Image, Replace PSD, Export selection,
 * Publish and Project Options.
 */

import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { psd, publish } from "../lib/ipc";
import type { AnchorMarks, ImportResult } from "../lib/ipc";
import type { ProjectMeta } from "../lib/types";
import { isMobile } from "../lib/platform";
import * as log from "../lib/log";

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
      run(() => importClipboard(projectId, os, marks)),
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
        run(() => importClipboard(projectId, os, undefined, key)),
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
export function openPublish(projectId: string, projectName: string): void {
  const sheet = openSheet({
    title: "Publish",
    subtitle: "Zipped project · rsync targets coming later",
    width: 520,
  });

  const exportZip = async () => {
    sheet.close();
    try {
      // Both runtime libraries are vendored into the Rust binary, so the
      // export carries the exact builds this editor runs.
      const base64 = await publish.zip(projectId);
      const path = await saveFileDialog({
        defaultPath: `${projectName.replace(/[^\w-]+/g, "-").toLowerCase()}.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (!path) return;
      await publish.saveBytes(path, base64);
      log.info(`Published to ${path}`);
    } catch (err) {
      log.error("Publish failed:", err);
    }
  };

  sheet.actions.append(
    h("button", {
      class: "btn btn-primary",
      text: "Export .zip",
      onClick: () => void exportZip(),
    }),
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
 * Read an image from the clipboard and put it through the pipeline.
 *
 * Two routes, because neither is reliable everywhere: the Tauri plugin hands
 * back raw RGBA and works on desktop, while the webview's own clipboard API
 * hands back encoded bytes and is what iPadOS actually serves. Try the plugin
 * first and fall back rather than failing the paste.
 *
 * `key` names the PSD to write. Omitted, the paste gets a fresh key of its
 * own; given an existing one, it overwrites that file — which is how the
 * clipboard replaces a PSD as well as adding one.
 */
/**
 * Import whatever image is on the clipboard.
 *
 * Two routes, and which is tried first depends on the platform. The Tauri
 * clipboard plugin reads the *system* pasteboard, which is the right answer
 * on a Mac — but on iOS it has no image support at all: `read_image` is a
 * hard error there and the plugin's own Swift side implements only text. So
 * mobile goes straight to the webview's clipboard and skips a call that can
 * only fail, which is also what stops "Clipboard plugin unavailable" being
 * logged before every successful paste.
 *
 * When both fail, the *webview's* error is the one worth reporting: it is the
 * route that could have worked. Re-throwing the plugin's error meant every
 * failure on an iPad read "Unsupported on this platform", which named the
 * wrong thing and hid what the clipboard actually held.
 */
async function importClipboard(
  projectId: string,
  os: string,
  marks?: AnchorMarks,
  key?: string,
): Promise<ImportResult> {
  const name = key ?? `pasted-${Date.now().toString(36)}`;

  if (!isMobile(os)) {
    try {
      const image = await readImage();
      const { width, height } = await image.size();
      const rgba = await image.rgba();
      // Raw pixels rather than an encoded file, so this route goes through
      // the RGBA command — which takes no marks, and a paste arriving this
      // way has no grid selection to describe anyway.
      return await psd.fromRgba(projectId, name, width, height, toBase64(rgba));
    } catch (err) {
      log.info("The system clipboard had no image; trying the webview's:", err);
    }
  }

  const file = await clipboardImage();
  return psd.importBytes(projectId, name, toBase64(file), marks);
}

/**
 * The first image the webview will hand over, as bytes.
 *
 * WebKit exposes only a safe subset of the pasteboard — `text/plain`,
 * `text/html`, `text/uri-list`, `image/png` and web custom formats — so a PSD
 * copied out of another app may simply not be there to read, whatever the
 * pasteboard itself holds. When that happens the types that *were* offered go
 * into the error, because "nothing on the clipboard" and "a PSD this cannot
 * see" need different answers from whoever is reading the console.
 */
async function clipboardImage(): Promise<Uint8Array> {
  const items = await navigator.clipboard.read();
  const seen: string[] = [];
  for (const item of items) {
    seen.push(...item.types);
    const type = item.types.find(
      (t) => t.startsWith("image/") || t.endsWith("photoshop-image"),
    );
    if (!type) continue;
    const blob = await item.getType(type);
    return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error(
    seen.length === 0
      ? "The clipboard is empty"
      : `The clipboard has no image this app can read — it offered ${seen.join(", ")}. ` +
        "Save the file and use Import from Files instead.",
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
