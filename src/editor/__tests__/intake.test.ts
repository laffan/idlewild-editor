import { describe, expect, it } from "vitest";
import { describeEmpty } from "../clipboard";
import { pickImportablePath } from "../drop";
import { isPasteShortcut } from "../paste";

/**
 * What the editor says when a clipboard read comes back with nothing.
 *
 * The three answers are the whole reason this is a function: "the clipboard
 * is empty" was reported over a pasteboard holding a PSD, and a message that
 * names what was actually there is the difference between a bug report and a
 * next step.
 */
describe("describeEmpty", () => {
  it("says so when the pasteboard really is empty", () => {
    expect(describeEmpty([])).toBe("The clipboard is empty");
  });

  it("names what it could not read, and where to go instead", () => {
    const message = describeEmpty(["public.utf8-plain-text", "public.html"]);
    expect(message).toContain("public.utf8-plain-text");
    expect(message).toContain("Import from Files");
  });

  it("blames the prompt when something readable was withheld", () => {
    // iOS 16 raises a paste prompt over a program reading the pasteboard, and
    // a declined prompt looks exactly like an empty clipboard from in here.
    const message = describeEmpty(["com.adobe.photoshop-image", "public.utf8-plain-text"]);
    expect(message).toContain("com.adobe.photoshop-image");
    expect(message).toContain("allow the paste");
    expect(message).not.toContain("public.utf8-plain-text");
  });
});

/** Which of a dragged selection of files the drop actually takes. */
describe("pickImportablePath", () => {
  it("takes the image out of whatever else came with it", () => {
    expect(
      pickImportablePath(["/tmp/.DS_Store", "/tmp/notes.txt", "/tmp/tower.psd"]),
    ).toBe("/tmp/tower.psd");
  });

  it("reads the extension whatever case it is in", () => {
    expect(pickImportablePath(["/tmp/Roof.PNG"])).toBe("/tmp/Roof.PNG");
    expect(pickImportablePath(["/tmp/photo.JPEG"])).toBe("/tmp/photo.JPEG");
  });

  it("has nothing to take from a drop of anything else", () => {
    expect(pickImportablePath(["/tmp/notes.txt"])).toBeNull();
    expect(pickImportablePath([])).toBeNull();
  });
});

/**
 * ⌘V where no paste event is coming.
 *
 * On iPadOS the keystroke is the whole signal — WKWebView runs the Paste
 * command only against an editable element, so a canvas gets the keydown and
 * never the paste — and the clipboard is read afterwards by the shell.
 */
describe("isPasteShortcut", () => {
  const press = (over: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      key: "v",
      code: "KeyV",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: false,
      ...over,
    }) as KeyboardEvent;

  it("takes ⌘V and its Windows equivalent", () => {
    expect(isPasteShortcut(press({ metaKey: true }))).toBe(true);
    expect(isPasteShortcut(press({ ctrlKey: true }))).toBe(true);
  });

  it("reads the physical key, for a layout that puts something else there", () => {
    expect(isPasteShortcut(press({ metaKey: true, key: "м" }))).toBe(true);
    expect(isPasteShortcut(press({ metaKey: true, code: "Digit1", key: "V" }))).toBe(true);
  });

  it("is not V on its own, nor another ⌘ shortcut", () => {
    expect(isPasteShortcut(press({}))).toBe(false);
    expect(isPasteShortcut(press({ metaKey: true, key: "c", code: "KeyC" }))).toBe(false);
  });

  it("ignores ⌥⌘V, which is paste-and-match-style elsewhere", () => {
    expect(isPasteShortcut(press({ metaKey: true, altKey: true }))).toBe(false);
  });

  it("takes one image per press, not one per repeat", () => {
    expect(isPasteShortcut(press({ metaKey: true, repeat: true }))).toBe(false);
  });
});
