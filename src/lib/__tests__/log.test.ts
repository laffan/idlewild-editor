import { describe, expect, it } from "vitest";
import { clearLog, error, formatArgs, getEntries, info, logFrom } from "../log";

const plain = (args: unknown[]) => formatArgs(args).map((s) => s.text).join("");

describe("formatArgs", () => {
  it("joins ordinary arguments", () => {
    expect(plain(["Opened", "Harborworks"])).toBe("Opened Harborworks");
  });

  it("splits %c runs and carries their style", () => {
    const segments = formatArgs([
      "%cPhaser v4.2.1%c https://phaser.io",
      "color: #ffffff; font-weight: bold",
      "color: #999",
    ]);
    expect(segments.map((s) => s.text)).toEqual([
      "Phaser v4.2.1",
      " https://phaser.io",
    ]);
    expect(segments[0].style).toContain("color:#ffffff");
    expect(segments[0].style).toContain("font-weight:bold");
  });

  it("drops the declarations that made Phaser's banner unreadable", () => {
    // This is the real shape of Phaser's boot banner.
    const segments = formatArgs([
      "%cPhaser v4.2.1",
      'background-image: url("data:image/png;base64,iVBORw0KGgo"); padding: 2px 6px; color: #fff',
    ]);
    expect(segments[0].style).toBe("color:#fff");
    expect(segments[0].style).not.toContain("url");
    expect(plain(["%cPhaser v4.2.1", "background-image: url(x)"])).toBe(
      "Phaser v4.2.1",
    );
  });

  it("refuses a style that smuggles a url or script through a kept property", () => {
    const segments = formatArgs(["%cx", "color: url(javascript:alert(1))"]);
    expect(segments[0].style).toBeUndefined();
  });

  it("substitutes %s, %d and %o", () => {
    expect(plain(["%s scored %d", "Ada", 42])).toBe("Ada scored 42");
    expect(plain(["%d", 7.9])).toBe("7");
    expect(plain(["%o", { a: 1 }])).toBe('{"a":1}');
  });

  it("keeps a literal %% and an unmatched directive", () => {
    expect(plain(["100%% done"])).toBe("100% done");
    expect(plain(["%s and %s", "one"])).toBe("one and %s");
  });

  it("appends arguments the format string did not consume", () => {
    expect(plain(["%s", "one", "two"])).toBe("one two");
  });

  it("leaves a string with no directives untouched", () => {
    expect(plain(["50% of the grid"])).toBe("50% of the grid");
  });
});

describe("where a line came from", () => {
  it("tags the editor's own commentary App and the console JS", () => {
    clearLog();
    info("Imported tower.psd");
    error("Save failed:", "disk full");
    logFrom("js", "warn", "Phaser: no WebGL");

    expect(getEntries().map((e) => [e.source, e.level])).toEqual([
      ["app", "info"],
      ["app", "error"],
      ["js", "warn"],
    ]);
  });

  it("keeps an error's stack, which is the part worth reading", () => {
    clearLog();
    const err = new Error("boom");
    err.stack = "Error: boom\n    at WorldScene.create (WorldScene.js:31:7)";
    logFrom("js", "error", err);
    expect(getEntries()[0].message).toContain("WorldScene.js:31:7");
  });
});
