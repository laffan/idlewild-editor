import { describe, expect, it } from "vitest";
import { imageFrom, isCopyShortcut, isPasteShortcut, pasteName } from "../paste";

/** A `DataTransfer` as the paste path reads it: `files`, then `items`. */
function clipboard(over: {
  files?: File[];
  items?: Array<{ kind: string; file: File | null }>;
}): DataTransfer {
  return {
    files: over.files ?? [],
    items: (over.items ?? []).map((i) => ({
      kind: i.kind,
      getAsFile: () => i.file,
    })),
  } as unknown as DataTransfer;
}

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("imageFrom", () => {
  it("takes a screenshot off the files list", () => {
    const png = file("image.png", "image/png");
    expect(imageFrom(clipboard({ files: [png] }))).toBe(png);
  });

  it("falls back to items, which is all some engines populate", () => {
    const jpg = file("photo.jpg", "image/jpeg");
    expect(imageFrom(clipboard({ items: [{ kind: "file", file: jpg }] }))).toBe(jpg);
  });

  it("takes a PSD on its name, since its type is whatever the platform invented", () => {
    const psd = file("tower.psd", "");
    expect(imageFrom(clipboard({ files: [psd] }))).toBe(psd);
  });

  it("ignores copied text and anything else that is not an image", () => {
    expect(
      imageFrom(
        clipboard({
          files: [file("notes.txt", "text/plain")],
          items: [{ kind: "string", file: null }],
        }),
      ),
    ).toBeNull();
  });

  it("has nothing to take from an empty clipboard", () => {
    expect(imageFrom(null)).toBeNull();
    expect(imageFrom(clipboard({}))).toBeNull();
  });
});

describe("pasteName", () => {
  it("keeps a name someone chose", () => {
    expect(pasteName(file("tower.psd", ""))).toBe("tower");
    expect(pasteName(file("back wall.png", "image/png"))).toBe("back wall");
  });

  it("invents one for a screenshot, which is `image.png` everywhere", () => {
    expect(pasteName(file("image.png", "image/png"))).toMatch(/^pasted-[a-z0-9]+$/);
    expect(pasteName(file("", ""))).toMatch(/^pasted-[a-z0-9]+$/);
  });

  it("reads the last segment of a path", () => {
    expect(pasteName(file("/Users/me/Desktop/roof.png", "image/png"))).toBe("roof");
  });
});

/**
 * A key event as the two shortcut readers see one.
 *
 * `code` and `key` are both given because a keyboard laid out for another
 * language answers only one of them, and the readers accept either.
 */
function keydown(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: "",
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...over,
  } as KeyboardEvent;
}

/**
 * ⌘C and ⌘V as keystrokes.
 *
 * Both matter on an iPad, and for two different reasons. The paste *event*
 * never arrives over the canvas there, because WKWebView runs the Paste command
 * only against an editable element — so the keydown is the only signal. And
 * there is no copy event over a canvas on any platform, because the browser
 * fires one for a selection and a placed PSD is not one.
 */
describe("the clipboard shortcuts", () => {
  it("reads either half, by physical key or by letter", () => {
    expect(isPasteShortcut(keydown({ metaKey: true, code: "KeyV" }))).toBe(true);
    expect(isPasteShortcut(keydown({ metaKey: true, key: "v" }))).toBe(true);
    expect(isCopyShortcut(keydown({ metaKey: true, code: "KeyC" }))).toBe(true);
    expect(isCopyShortcut(keydown({ metaKey: true, key: "C" }))).toBe(true);
  });

  it("takes control for the keyboards that have no command key", () => {
    expect(isCopyShortcut(keydown({ ctrlKey: true, code: "KeyC" }))).toBe(true);
    expect(isPasteShortcut(keydown({ ctrlKey: true, code: "KeyV" }))).toBe(true);
  });

  it("is not the letter on its own, and not with option held", () => {
    expect(isCopyShortcut(keydown({ code: "KeyC" }))).toBe(false);
    expect(isCopyShortcut(keydown({ metaKey: true, altKey: true, code: "KeyC" })))
      .toBe(false);
  });

  it("ignores auto-repeat, because one press is one file", () => {
    expect(isCopyShortcut(keydown({ metaKey: true, code: "KeyC", repeat: true })))
      .toBe(false);
    expect(isPasteShortcut(keydown({ metaKey: true, code: "KeyV", repeat: true })))
      .toBe(false);
  });

  it("keeps the two apart", () => {
    expect(isCopyShortcut(keydown({ metaKey: true, code: "KeyV" }))).toBe(false);
    expect(isPasteShortcut(keydown({ metaKey: true, code: "KeyC" }))).toBe(false);
  });
});
