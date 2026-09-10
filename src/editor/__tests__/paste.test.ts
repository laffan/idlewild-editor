import { describe, expect, it } from "vitest";
import { imageFrom, pasteName } from "../paste";

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
