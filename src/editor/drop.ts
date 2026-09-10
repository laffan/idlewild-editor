/**
 * Files dropped on the canvas.
 *
 * A drop is a paste with a pointer behind it: the same bytes go down the same
 * pipe and become the same marked PSD, and the only thing it knows that a
 * paste does not is *where*. That buys two things. The image lands where it
 * was let go of rather than in the middle of the view; and a drop onto one
 * that is already there means the file behind it, which is how a piece of
 * artwork is replaced without going through the inspector.
 *
 * **Two routes in, because the platforms differ.** On macOS the shell
 * intercepts the drag before the webview sees it, and Tauri reports it as an
 * event carrying OS paths; on iPadOS there is no such interception and the
 * webview gets ordinary HTML5 drag events carrying `File`s. Both are wired
 * here — the same arrangement phaser-bench arrived at — and both funnel into
 * one decision, so a drop behaves the same on either.
 *
 * Positions from the shell are *physical* pixels and everything in the page is
 * in CSS pixels, so they are divided through by the device pixel ratio. (With
 * the web inspector attached macOS reports them from somewhere else entirely;
 * that is a known Tauri limitation and not worth working around.)
 */

import { droppedFile, fromBase64, psd, toBase64 } from "../lib/ipc";
import * as log from "../lib/log";
import type { Cell } from "../lib/types";
import { chooseSheet } from "../lib/sheet";
import type { PlacedTarget } from "../game/drop-target";
import { imageFrom, pasteName } from "./paste";
import { importPasted, type PasteTarget } from "./paste-actions";

/** What the editor lends this: the canvas, and what is on it. */
export interface DropHost {
  /** Whether a drop should be taken at all — false in play mode. */
  enabled: () => boolean;
  /** Where an import would go, shared with the paste path. */
  paste: () => PasteTarget | null;
  /** The grid space under a point on the page. */
  cellAt: (clientX: number, clientY: number) => Cell | null;
  /** The placed PSD under a point on the page, if any. */
  placedAt: (clientX: number, clientY: number) => PlacedTarget | null;
  /** Outline what a drop would replace, or clear the outline. */
  markDrop: (target: PlacedTarget | null) => void;
  /** Take a replaced PSD's new manifest back onto the canvas. */
  reloadPsd: (key: string, manifest: string) => Promise<void>;
}

/**
 * A file on its way in, whichever route it came by.
 *
 * The bytes are a thunk because a replacement asks before it reads: the
 * confirmation names the file, and reading a fifty-megabyte PSD to put its
 * name in a sentence the user is about to decline is work for nothing.
 */
interface Incoming {
  name: string;
  /** The OS path, where the shell handled the drag. Absent otherwise. */
  path?: string;
  file: () => Promise<File>;
}

/** Take drops on the canvas until the returned teardown is called. */
export function listenForDrop(
  projectId: string,
  canvas: HTMLElement,
  host: DropHost,
): () => void {
  let hovering: string | null = null;

  /** Follow the pointer: outline what is under it, or clear what was. */
  const track = (clientX: number, clientY: number): void => {
    if (!host.enabled() || !inside(canvas, clientX, clientY)) return clear();
    canvas.classList.add("drop-active");
    const target = host.placedAt(clientX, clientY);
    // Redrawn only when the answer changes: a drag reports every pixel it
    // crosses, and the outline is the same outline for most of them.
    const id = target?.placementId ?? null;
    if (id === hovering) return;
    hovering = id;
    host.markDrop(target);
  };

  const clear = (): void => {
    canvas.classList.remove("drop-active");
    if (hovering === null) return;
    hovering = null;
    host.markDrop(null);
  };

  const take = (
    incoming: Incoming,
    clientX: number,
    clientY: number,
  ): void => {
    clear();
    if (!host.enabled() || !inside(canvas, clientX, clientY)) return;
    void receive(projectId, host, incoming, clientX, clientY);
  };

  // ── the webview's own drag and drop: iPadOS, and any desktop where the
  //    shell is not intercepting ──────────────────────────────────────────
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without this the webview opens the file in place of the app.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    track(event.clientX, event.clientY);
  };

  const onDragLeave = (event: DragEvent) => {
    // Moving between the canvas and something on top of it fires this, so
    // only a pointer that has actually left counts as leaving.
    const to = event.relatedTarget;
    if (to instanceof Node && canvas.contains(to)) return;
    clear();
  };

  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    const file = imageFrom(event.dataTransfer);
    if (!file) {
      refuse(Array.from(event.dataTransfer?.files ?? []).map((f) => f.name));
      return clear();
    }
    take({ name: file.name, file: async () => file }, event.clientX, event.clientY);
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);

  // ── and the shell's, which is what macOS gets ────────────────────────────
  let unlistenShell: (() => void) | null = null;
  let stopped = false;
  void listenToShell({
    over: (x, y) => track(x, y),
    leave: () => clear(),
    drop: (paths, x, y) => {
      const incoming = fromPaths(paths);
      if (!incoming) {
        refuse(paths.map((path) => path.split(/[\\/]/).pop() ?? path));
        return clear();
      }
      take(incoming, x, y);
    },
  }).then((unlisten) => {
    if (stopped) unlisten();
    else unlistenShell = unlisten;
  });

  return () => {
    stopped = true;
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
    unlistenShell?.();
    clear();
  };
}

/**
 * What a drop does once it has landed.
 *
 * Onto empty grid it is an import, and lands on the space it was let go over.
 * Onto a placed PSD it is a question, because replacing a file rewrites
 * every placement on it — including the copies of it elsewhere in the
 * project, which is exactly what makes the gesture worth having and exactly
 * what makes it worth asking about.
 */
async function receive(
  projectId: string,
  host: DropHost,
  incoming: Incoming,
  clientX: number,
  clientY: number,
): Promise<void> {
  const target = host.placedAt(clientX, clientY);
  const cell = host.cellAt(clientX, clientY);

  if (target) {
    const choice = await chooseSheet({
      title: `Replace ${target.psdKey}.psd?`,
      message:
        `${incoming.name} was dropped on ${target.psdKey}.psd. Replacing rewrites ` +
        "that file, so every placement of it changes with it. Adding leaves it " +
        "alone and brings the new image in where it was dropped.",
      choices: [
        { id: "replace", label: "Replace", primary: true },
        { id: "add", label: "Add as new" },
      ],
    });
    if (choice === null) return;
    if (choice === "replace") {
      await replace(projectId, host, target.psdKey, incoming);
      return;
    }
  }

  const paste = host.paste();
  if (!paste || !cell) return;
  const file = await incoming.file();
  await importPasted(projectId, paste, pasteName(file), file, cell);
}

/**
 * Put a different file behind an existing key.
 *
 * The key does not move, so every placement pointing at it survives — which
 * is the whole difference between replacing a PSD and importing a second one.
 * A path goes through the same re-import a picked file does; bytes are
 * written under the key, which overwrites it for the same reason.
 */
async function replace(
  projectId: string,
  host: DropHost,
  key: string,
  incoming: Incoming,
): Promise<void> {
  try {
    const result = incoming.path
      ? await psd.reimport(projectId, key, incoming.path)
      : await psd.importBytes(
          projectId,
          key,
          toBase64(new Uint8Array(await (await incoming.file()).arrayBuffer())),
        );
    await host.reloadPsd(key, result.manifest);
    log.info(`${key}.psd is now ${incoming.name} (${result.width}×${result.height})`);
  } catch (err) {
    log.error(`Could not replace ${key}.psd:`, err);
  }
}

/**
 * The first of several dropped paths the pipeline can actually take.
 *
 * A drag can carry a whole selection, and the shell reports every path in it.
 * One image is imported, as one is pasted — but *which* one should not depend
 * on where a `.DS_Store` or a stray text file happened to sort.
 */
export function pickImportablePath(paths: readonly string[]): string | null {
  return paths.find((path) => /\.(psd|png|jpe?g|tiff?|gif)$/i.test(path)) ?? null;
}

/** That path as an `Incoming`, with its bytes fetched only when asked for. */
function fromPaths(paths: readonly string[]): Incoming | null {
  const path = pickImportablePath(paths);
  if (!path) return null;
  const name = path.split(/[\\/]/).pop() ?? "image";
  return {
    name,
    path,
    file: async () => {
      const read = await droppedFile(path);
      return new File([fromBase64(read.dataBase64)], read.name);
    },
  };
}

/**
 * The shell's drag and drop, where there is a shell listening for it.
 *
 * Imported here rather than at the top of the file, which is the one place in
 * this codebase that does so: the browser harness stubs `@tauri-apps/api` down
 * to the handful of things it needs, and a module-level import of the window
 * API would take the whole shell down with it there. Asked for inside a
 * `try`, a missing window is what it is — no shell to listen with — and the
 * webview's own events cover that case anyway.
 */
async function listenToShell(handlers: {
  over: (x: number, y: number) => void;
  leave: () => void;
  drop: (paths: string[], x: number, y: number) => void;
}): Promise<() => void> {
  try {
    const { getCurrentWebviewWindow } = await import(
      "@tauri-apps/api/webviewWindow"
    );
    return await getCurrentWebviewWindow().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "leave") return handlers.leave();
      const ratio = window.devicePixelRatio || 1;
      const x = payload.position.x / ratio;
      const y = payload.position.y / ratio;
      if (payload.type === "drop") handlers.drop(payload.paths, x, y);
      else handlers.over(x, y);
    });
  } catch (err) {
    log.info("No shell drag and drop here; the webview's own is enough:", err);
    return () => {};
  }
}

/**
 * Say so when a drop had nothing the pipeline could take.
 *
 * A deliberate gesture that does nothing at all reads as a broken app, and
 * naming the file is usually enough to explain why — it was a `.txt`, or a
 * folder, or a `.heic` this cannot decode.
 */
function refuse(names: readonly string[]): void {
  if (names.length === 0) return;
  log.info(`Nothing to import in ${names.join(", ")} — PSD, PNG, JPEG, TIFF or GIF`);
}

/** Whether a drag is carrying files rather than dragging something in-page. */
function carriesFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types).includes("Files");
}

/**
 * Whether a point on the page is over the canvas.
 *
 * What is *topmost* there rather than what the canvas's rectangle covers, so
 * a sheet or an unpinned code panel over the canvas takes the drop away from
 * it rather than letting it through to the grid underneath.
 */
function inside(el: HTMLElement, clientX: number, clientY: number): boolean {
  const at = document.elementFromPoint(clientX, clientY);
  return !!at && el.contains(at);
}
