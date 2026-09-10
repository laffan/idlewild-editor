/**
 * Getting a file off the clipboard when nothing has been pasted.
 *
 * A paste *event* carries its data with it — that is `paste.ts`, and it is
 * the whole story on a Mac. Asking cold is a different problem, and on an
 * iPad it is the only one there is: WKWebView delivers a paste event only
 * when the caret is in an editable element, and this editor's canvas is
 * never that, so ⌘V never reaches the page and *Paste Image* in the menu is
 * the only way in.
 *
 * The obvious way to ask is `navigator.clipboard.read()`, and on an iPad it
 * answers with nothing. WebKit hands a page only a web-safe subset of what
 * the pasteboard holds — plain text, HTML, a URL list, PNG, web custom
 * formats — and a PSD copied out of Files is `com.adobe.photoshop-image`,
 * which is on none of those lists. The clipboard was never empty; the page
 * was simply never shown what was on it, and the editor said "the clipboard
 * is empty" over a pasteboard holding exactly the file the user meant.
 *
 * So the shell is asked first. `read_clipboard` is `src-tauri/clipboard.rs`,
 * reading `UIPasteboard` or `NSPasteboard` directly, where there is no such
 * subset. The webview stays as the fallback for anywhere that command cannot
 * answer — the browser harness, and any platform without a pasteboard this
 * knows how to read.
 */

import { clipboard, fromBase64 } from "../lib/ipc";
import * as log from "../lib/log";

/** What each extension is called, so the File carries an honest type. */
const MIME: Record<string, string> = {
  psd: "image/vnd.adobe.photoshop",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  gif: "image/gif",
};

/**
 * The first image on the clipboard, as a file.
 *
 * Everything downstream takes a `File`, whichever route it came by, so a
 * paste asked for is indistinguishable from a paste that happened — marks
 * and all.
 */
export async function clipboardImage(): Promise<File> {
  try {
    return await fromShell();
  } catch (err) {
    // Two very different failures land here: a pasteboard that really had
    // nothing to give, which is the answer, and a shell that could not be
    // asked, which is not. Only the second is worth another attempt, and it
    // is the one that names a *command*.
    if (!unavailable(err)) throw err;
    log.info("The shell could not read the clipboard; trying the webview's:", err);
  }
  return fromWebview();
}

/**
 * The system pasteboard, through the shell.
 *
 * The error names what the pasteboard was actually holding, because "empty"
 * and "holding something this app cannot read" call for different next steps
 * — one is *copy something first*, the other is *save it and use Import from
 * Files*.
 */
async function fromShell(): Promise<File> {
  const read = await clipboard.read();
  if (read.file) {
    const bytes = fromBase64(read.file.dataBase64);
    return new File([bytes], read.file.name, { type: mimeFor(read.file.name) });
  }
  throw new Error(describeEmpty(read.types));
}

/** The pasteboard types the import pipeline knows what to do with. */
const READABLE =
  /photoshop-image|public\.(png|jpeg|tiff|file-url)|com\.compuserve\.gif|^image\//;

/**
 * What to say about a pasteboard that gave nothing back.
 *
 * Three different situations, and they want three different next steps.
 * Nothing on it at all is *copy something first*. Something this cannot read
 * is *save it and import it from Files*. And something this can read that
 * still did not arrive is iPadOS holding it back: since iOS 16 a program
 * reading the pasteboard raises a prompt, and declining it looks exactly
 * like an empty clipboard from in here.
 */
export function describeEmpty(types: readonly string[]): string {
  if (types.length === 0) return "The clipboard is empty";
  const readable = types.filter((type) => READABLE.test(type));
  if (readable.length > 0) {
    return (
      `The clipboard is holding ${readable.join(", ")} but would not hand it over. ` +
      "Try again and allow the paste when asked."
    );
  }
  return (
    `The clipboard has no image this app can read — it offered ${types.join(", ")}. ` +
    "Save the file and use Import from Files instead."
  );
}

/**
 * Whether a failed read means *ask somewhere else* rather than *there was
 * nothing there*.
 *
 * Tauri answers an unknown command with a message naming it, and the browser
 * harness has no `invoke` at all — both mean the shell is not the one to ask.
 */
function unavailable(err: unknown): boolean {
  const text = String(
    typeof err === "object" && err !== null && "message" in err
      ? (err as { message?: unknown }).message
      : err,
  );
  return (
    /not (supported|allowed|found)/i.test(text) ||
    /unknown command|command .* not found/i.test(text) ||
    /invoke/i.test(text)
  );
}

/**
 * The webview's own clipboard.
 *
 * Kept for the harness and for anywhere the shell has no pasteboard to read.
 * It sees only what WebKit is willing to show a page, which is why it is not
 * the first thing asked.
 */
async function fromWebview(): Promise<File> {
  const items = await navigator.clipboard.read();
  const seen: string[] = [];
  for (const item of items) {
    seen.push(...item.types);
    const type = item.types.find(
      (t) => t.startsWith("image/") || t.endsWith("photoshop-image"),
    );
    if (!type) continue;
    const blob = await item.getType(type);
    // `image.png` is what a screenshot is called on every platform, and the
    // name is what decides the PSD's key — see `pasteName`.
    const name = type.endsWith("photoshop-image") ? "image.psd" : "image.png";
    return new File([blob], name, { type });
  }
  throw new Error(describeEmpty(seen));
}

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}
