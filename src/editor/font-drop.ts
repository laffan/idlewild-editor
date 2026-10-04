/**
 * Font files dropped on the properties sidebar become the project's fonts.
 *
 * The sidebar rather than the canvas, because a drop on the canvas is an
 * image coming in (`drop.ts`) and a font is not something that stands
 * anywhere: it is a setting the Text tool offers. The two never compete —
 * `drop.ts` only takes what lands on the canvas — and both routes are wired
 * the way it wires them: the webview's own HTML5 drag events, which is what
 * iPadOS has, and the shell's drag-drop event carrying paths, which is what
 * macOS has. On an iPad a drop needs Files open beside the app, so the Text
 * section also has an **Add font…** button with a file picker — see
 * `inspect-text.ts`.
 */

import * as log from "../lib/log";
import { addFontFiles, addFontPaths, isFontFile } from "../lib/project-fonts";

/** Take font drops on `target` until the returned teardown is called. */
export function listenForFontDrop(projectId: string, target: HTMLElement): () => void {
  const over = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    target.classList.add("font-drop-active");
  };
  const leave = (event: DragEvent) => {
    const to = event.relatedTarget;
    if (to instanceof Node && target.contains(to)) return;
    target.classList.remove("font-drop-active");
  };
  const drop = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    // Not the canvas's drop as well: that one would say a font is not an image.
    event.stopPropagation();
    target.classList.remove("font-drop-active");
    const files = Array.from(event.dataTransfer?.files ?? []);
    const fonts = files.filter((f) => isFontFile(f.name));
    if (fonts.length === 0) {
      log.info(
        `Nothing to add in ${files.map((f) => f.name).join(", ")} — the sidebar ` +
          "takes font files: TTF, OTF, WOFF or WOFF2",
      );
      return;
    }
    void addFontFiles(projectId, fonts);
  };
  target.addEventListener("dragover", over);
  target.addEventListener("dragleave", leave);
  target.addEventListener("drop", drop);

  let unlisten: (() => void) | null = null;
  let stopped = false;
  void (async () => {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const stop = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") return target.classList.remove("font-drop-active");
        const ratio = window.devicePixelRatio || 1;
        const here = inside(target, payload.position.x / ratio, payload.position.y / ratio);
        if (payload.type !== "drop") {
          target.classList.toggle("font-drop-active", here);
          return;
        }
        target.classList.remove("font-drop-active");
        if (!here) return;
        const fonts = payload.paths.filter(isFontFile);
        if (fonts.length > 0) void addFontPaths(projectId, fonts);
      });
      if (stopped) stop();
      else unlisten = stop;
    } catch {
      // No shell — the webview's own events are all there is.
    }
  })();

  return () => {
    stopped = true;
    target.removeEventListener("dragover", over);
    target.removeEventListener("dragleave", leave);
    target.removeEventListener("drop", drop);
    unlisten?.();
  };
}

function carriesFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types).includes("Files");
}

function inside(el: HTMLElement, x: number, y: number): boolean {
  const at = document.elementFromPoint(x, y);
  return !!at && el.contains(at);
}
