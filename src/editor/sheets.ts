/**
 * The editor's modal sheets: Add Image, Export selection, Publish and
 * Project Options.
 */

import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { psd, publish } from "../lib/ipc";
import type { AnchorMarks, ImportResult } from "../lib/ipc";
import type { ProjectMeta } from "../lib/types";
import * as log from "../lib/log";

/**
 * Add Image. Every route ends in the same place: bytes reach Rust, become a
 * PSD, and go through psd-to-json. That is what keeps the psd-to-phaser
 * integration uniform.
 */
export function openAddImage(
  projectId: string,
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
        const picked = await openFileDialog({
          multiple: false,
          filters: [
            { name: "Images", extensions: ["psd", "png", "jpg", "jpeg"] },
          ],
        });
        if (typeof picked !== "string") return null;
        return psd.importPath(projectId, picked, undefined, marks);
      }),
    ),
    option("Paste from clipboard", "⌘V", () =>
      run(() => pasteFromClipboard(projectId, marks)),
    ),
    option("Import from Photos", "iPad", () =>
      run(async () => {
        const picked = await openFileDialog({
          multiple: false,
          filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
        });
        if (typeof picked !== "string") return null;
        return psd.importPath(projectId, picked, undefined, marks);
      }),
    ),
  );

  sheet.body.appendChild(list);
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
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
    ["Grid scale", `${meta.gridSize} px`],
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
 * Read an image from the clipboard.
 *
 * Two routes, because neither is reliable everywhere: the Tauri plugin hands
 * back raw RGBA and works on desktop, while the webview's own clipboard API
 * hands back encoded bytes and is what iPadOS actually serves. Try the plugin
 * first and fall back rather than failing the paste.
 */
async function pasteFromClipboard(
  projectId: string,
  marks?: AnchorMarks,
): Promise<ImportResult> {
  const name = `pasted-${Date.now().toString(36)}`;
  try {
    const image = await readImage();
    const { width, height } = await image.size();
    const rgba = await image.rgba();
    // Raw pixels rather than an encoded file, so this route goes through the
    // RGBA command — which takes no marks, and a paste has no grid selection
    // to describe anyway when it arrives this way.
    return await psd.fromRgba(projectId, name, width, height, toBase64(rgba));
  } catch (pluginError) {
    log.info("Clipboard plugin unavailable, trying the webview clipboard");
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return psd.importBytes(projectId, name, toBase64(bytes), marks);
    }
    throw pluginError;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
