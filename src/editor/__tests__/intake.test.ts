import { describe, expect, it } from "vitest";
import { describeEmpty } from "../clipboard";
import { pickImportablePath } from "../drop";

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
