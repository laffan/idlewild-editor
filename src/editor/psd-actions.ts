/**
 * Sending a PSD out to an editor, and taking the edited file back.
 *
 * These are the two halves of one round trip. Re-parsing on its own was a
 * button with nothing to re-parse: the PSD sat inside the app's store, and
 * nothing between one parse and the next could change it.
 *
 * The way back differs by platform, because the platforms differ.
 *
 * On desktop the editor opens the file where it lies in the project store and
 * saves over it, so the file on disk is already the edited one and all that
 * is left to do is parse it again — asking the user to go and find it would
 * be busywork. On iPadOS an app cannot hand another app its document and get
 * the edits back, so the file goes out through the share sheet, is edited
 * wherever it lands, and has to be picked to come home.
 */

import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import type { DocStore } from "../lib/doc-store";
import { psd, publish } from "../lib/ipc";
import * as log from "../lib/log";
import { isMobile } from "../lib/platform";
import type { WorldScene } from "../game/world-scene";
import type { Inspector } from "./inspector";
import { psdLayerOwner } from "./psd-layer-owner";
import { PsdLayerEditor } from "./psd-layers";
import type { PsdLayerInfo } from "../lib/ipc";
import { openReplacePsd } from "./sheets";

/**
 * What the second PSD button is called here. The two are different actions —
 * one re-reads a file that never moved, the other takes a file back — and
 * the label is the only thing that says which.
 */
export function refreshPsdLabel(os: string): string {
  return isMobile(os) ? "Re-import" : "Re-parse";
}

/**
 * And the first. On desktop the file is opened where it lies; on mobile it
 * goes out through the share sheet, and calling that "Open" promises an
 * editor the tap does not open.
 */
export function openPsdLabel(os: string): string {
  return isMobile(os) ? "Share PSD" : "Open PSD";
}

/**
 * Hand `<key>.psd` to the OS.
 *
 * On desktop that is the registered editor, opened through the shell so the
 * webview never needs a filesystem scope over the store. On mobile it is the
 * share sheet, which shares a `File` the page holds rather than a path — so
 * the bytes come across and are wrapped here.
 */
export async function openPsdExternally(
  projectId: string,
  key: string,
  os: string,
): Promise<void> {
  if (!isMobile(os)) {
    await psd.openExternally(projectId, key);
    log.info(`Opened ${key}.psd — Re-parse it when you have saved your edits`);
    return;
  }

  const file = new File([await psdBlob(projectId, key)], `${key}.psd`, {
    type: PSD_MIME,
  });

  // `canShare` is the only honest test: WKWebView exposes `share` well before
  // it will accept files, and a share it refuses throws after the sheet has
  // already been dismissed.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      // The file alone, with no title beside it. A title makes iOS treat the
      // share as *two* items — the sheet says "Save 2 items" — and an app
      // that opens one PSD declines a two-item share, so Photoshop and
      // Procreate were missing from a list whose whole purpose was to reach
      // them. The filename is what names it in the sheet either way.
      await navigator.share({ files: [file] });
      log.info(`Shared ${key}.psd — Re-import it when you have saved your edits`);
      return;
    } catch (err) {
      // Swiping the share sheet away rejects the promise, and backing out of
      // a sheet is not a failure — it was logged as one, in red, every time.
      if (isAbort(err)) return;
      throw err;
    }
  }

  await savePsdCopy(projectId, key);
}

/**
 * Whether a rejection is the user dismissing something.
 *
 * `AbortError` is what both the share sheet and the file pickers throw when
 * they are backed out of. It arrives as a `DOMException` on iPadOS and as a
 * plain object across the Tauri bridge, so the name is read off whatever it
 * is rather than matched on a class.
 */
function isAbort(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/**
 * The fallback when the share sheet will not take a file: write a copy
 * wherever the document picker points. It is the same round trip, one step
 * longer.
 */
async function savePsdCopy(projectId: string, key: string): Promise<void> {
  const path = await saveFileDialog({
    defaultPath: `${key}.psd`,
    filters: [{ name: "Photoshop document", extensions: ["psd"] }],
  });
  if (!path) return;
  await publish.saveBytes(path, await psd.bytes(projectId, key));
  log.info(`Saved a copy to ${path} — Re-import it when you have edited it`);
}

/**
 * Bring a PSD's edits back into the project and return the fresh manifest.
 *
 * Desktop re-parses the file in place: it never moved, so there is nothing
 * to go and find. Mobile asks *where the file came back from* — Files, the
 * photo library or the clipboard — rather than guessing, which is what it
 * used to do, and it guessed the photo library every time. Returns null when
 * the sheet or the picker is backed out of; a cancelled pick is not an error
 * and should not be logged as one.
 */
export async function refreshPsd(
  projectId: string,
  key: string,
  os: string,
): Promise<string | null> {
  if (!isMobile(os)) {
    const manifest = await psd.reprocess(projectId, key);
    log.info(`Re-parsed ${key}.psd`);
    return manifest;
  }
  return openReplacePsd(projectId, key, os);
}

const PSD_MIME = "image/vnd.adobe.photoshop";

async function psdBlob(projectId: string, key: string): Promise<Blob> {
  const base64 = await psd.bytes(projectId, key);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: PSD_MIME });
}

/**
 * The file behind a placement, as the shell's buttons act on it.
 *
 * Six things happen to a PSD from the editor — it goes out to Photoshop, it
 * comes back, its layer stack is rewritten from the inspector, it is renamed,
 * and a referencing placement is given a copy of its own — and every one of
 * them is the same three steps: talk to Rust, tell the scene, tell the
 * inspector its list of the file's layers is out of date. They were six
 * closures in `editor.ts` because they need the project id, the platform and
 * both panels; bound here instead, that is a parameter list rather than a
 * reason to live in the shell.
 */
export interface PsdFileActionsOptions {
  projectId: string;
  /** `std::env::consts::OS`, which decides how a file goes out and comes back. */
  os: string;
  store: DocStore;
  scene: () => WorldScene | null;
  inspector: Inspector;
}

export interface PsdFileActions {
  /** Hand the file to the OS: a desktop editor, or an iPadOS share sheet. */
  open: (key: string) => Promise<void>;
  /** Bring its edits back — a re-parse on desktop, a re-import on iPadOS. */
  refresh: (key: string) => Promise<void>;
  /** The inspector rewrote the layer stack; take the result back. */
  applyLayers: (
    key: string,
    manifest: string,
    renames: Map<string, string>,
  ) => Promise<void>;
  /** Rename the file, and carry every placement on it to the new key. */
  rename: (key: string, name: string) => Promise<void>;
  /** Give one placement a copy of the file, by id. */
  detach: (layerId: string, placementId: string, key: string) => Promise<void>;
}

export function createPsdFileActions(
  options: PsdFileActionsOptions,
): PsdFileActions {
  const { projectId, os, store, scene, inspector } = options;

  async function open(key: string): Promise<void> {
    try {
      await openPsdExternally(projectId, key, os);
    } catch (err) {
      log.error(`Could not open ${key}.psd:`, err);
    }
  }

  async function refresh(key: string): Promise<void> {
    try {
      const manifest = await refreshPsd(projectId, key, os);
      if (!manifest) return;
      await scene()?.reloadPsd(key, manifest);
      // The file on disk has changed, and the inspector's list of its layers
      // is built once and kept — so it has to be told, or it goes on showing
      // the stack from before the edit.
      inspector.reloadPsdLayers(key);
    } catch (err) {
      log.error(`Could not refresh ${key}:`, err);
    }
  }

  async function applyLayers(
    key: string,
    manifest: string,
    renames: Map<string, string>,
  ): Promise<void> {
    await scene()?.reloadPsd(key, manifest, renames);
    // Reordering renumbers every layer, so the next edit has to be made
    // against the file as it is now rather than as it was.
    inspector.reloadPsdLayers(key);
  }

  /**
   * Rust decides the key: what the field holds is raw text and goes through
   * the same sanitiser an import uses, so the name that lands can differ from
   * the name that was typed. On failure the panel is redrawn, which is what
   * puts the real name back in the field.
   */
  async function rename(key: string, name: string): Promise<void> {
    try {
      const result = await psd.rename(projectId, key, name);
      if (result.key === key) return;
      await scene()?.renamePsd(key, result.key);
      log.info(`${key}.psd → ${result.key}.psd`);
    } catch (err) {
      log.error(`Could not rename ${key}.psd:`, err);
      inspector.render();
    }
  }

  /**
   * Named by id rather than by what is selected — which is what an
   * option-shift drag needs, since the copy it hands over is only *usually*
   * still the selection by the time the file has finished copying.
   */
  async function detach(
    layerId: string,
    placementId: string,
    key: string,
  ): Promise<void> {
    try {
      const copy = await psd.duplicate(projectId, key);
      // A copy of an extruded PSD is an extrusion of its own, and carrying
      // one on must rewrite the file this placement actually draws.
      store.copyExtrusion(key, copy.key);
      // The copy blocks what the original blocked: it is the same artwork
      // standing on the same spaces until someone changes one of them.
      store.copyCollider(key, copy.key);
      await scene()?.repointPlacement(
        { kind: "placement", layerId, placementId },
        copy.key,
        copy.manifest,
      );
      log.info(`${key}.psd → ${copy.key}.psd — this placement is now its own`);
    } catch (err) {
      log.error(`Could not break the reference to ${key}:`, err);
    }
  }

  return { open, refresh, applyLayers, rename, detach };
}

/**
 * What the inspector's PSD section needs to be wired to.
 *
 * The list of a file's layers now carries every button that is about the
 * *file* — open it up on the canvas, send it out, bring it back, add a layer,
 * draw in one — so building one takes the round trip above, the scene, and
 * the two canvas modes it can lead into. That is a paragraph of wiring per
 * key, which is why it is a factory here rather than a closure in the shell.
 */
export interface PsdLayersOptions {
  projectId: string;
  os: string;
  store: DocStore;
  /** The round trip out to Photoshop and back — the actions above. */
  file: PsdFileActions;
  scene: () => WorldScene | null;
  /** Re-open the solid behind an extruded PSD. */
  onExtrude: () => void;
  /** Draw into one sprite layer of a file. */
  onPen: (key: string, layer: PsdLayerInfo) => void;
}

export function createPsdLayersFactory(
  options: PsdLayersOptions,
): (key: string) => PsdLayerEditor {
  const { projectId, os, store, file, scene } = options;
  return (key: string) =>
    new PsdLayerEditor(projectId, key, {
      onWritten: (manifest, renames) =>
        void file.applyLayers(key, manifest, renames),
      // The marks and an extrusion's artwork are the app's to name, and the
      // extrusion's row is the way back into the mode that built it.
      ownerOf: (layer) =>
        psdLayerOwner(layer, key, !!store.extrusion(key), options.onExtrude),
      onOpen: () => void file.open(key),
      onRefresh: () => void file.refresh(key),
      // The eye column, before Apply has written anything: the canvas shows
      // this file the way the list has it staged. The scene holds one such
      // preview at a time, which is all the inspector can ask for.
      onPreviewVisibility: (names) =>
        scene()?.previewPsdVisibility(names.length ? key : null, names),
      onToggleAdjust: () => {
        const open = scene();
        if (!open) return;
        if (open.adjustingInstance) open.stopAdjusting();
        else open.startAdjusting();
      },
      onPen: (layer) => options.onPen(key, layer),
      openLabel: openPsdLabel(os),
      refreshLabel: refreshPsdLabel(os),
    });
}
