import { describe, expect, it } from "vitest";
import {
  clearLog,
  error,
  formatArgs,
  getEntries,
  info,
  logFrom,
  type LogPart,
} from "../log";

const plain = (args: unknown[]) => formatArgs(args).map(flat).join("");

function flat(part: LogPart): string {
  return part.kind === "text" ? part.text : previewOf(part);
}

function previewOf(part: Extract<LogPart, { kind: "value" }>): string {
  const { value } = part;
  if (value.t === "object") {
    return `{${value.entries.map(([k, v]) => `${k}: ${leaf(v)}`).join(", ")}}`;
  }
  return leaf(value);
}

function leaf(value: { t: string; v?: unknown }): string {
  return value.t === "string" ? JSON.stringify(value.v) : String(value.v);
}

describe("formatArgs", () => {
  it("joins ordinary arguments", () => {
    expect(plain(["Opened", "Harborworks"])).toBe("Opened Harborworks");
  });

  it("splits %c runs and carries their style", () => {
    const parts = formatArgs([
      "%cPhaser v4.2.1%c https://phaser.io",
      "color: #ffffff; font-weight: bold",
      "color: #999",
    ]);
    expect(parts.map(flat)).toEqual(["Phaser v4.2.1", " https://phaser.io"]);
    const [first, second] = parts;
    expect(first.kind === "text" && first.style).toContain("color:#ffffff");
    expect(first.kind === "text" && first.style).toContain("font-weight:bold");
    expect(second.kind === "text" && second.style).toContain("color:#999");
  });

  it("drops the declarations that made Phaser's banner unreadable", () => {
    // This is the real shape of Phaser's boot banner.
    const parts = formatArgs([
      "%cPhaser v4.2.1",
      'background-image: url("data:image/png;base64,iVBORw0KGgo"); padding: 2px 6px; color: #fff',
    ]);
    const [first] = parts;
    expect(first.kind === "text" && first.style).toBe("color:#fff");
    expect(first.kind === "text" && first.style).not.toContain("url");
    expect(plain(["%cPhaser v4.2.1", "background-image: url(x)"])).toBe(
      "Phaser v4.2.1",
    );
  });

  it("refuses a style that smuggles a url or script through a kept property", () => {
    const [first] = formatArgs(["%cx", "color: url(javascript:alert(1))"]);
    expect(first.kind === "text" && first.style).toBeUndefined();
  });

  it("substitutes %s and %d", () => {
    expect(plain(["%s scored %d", "Ada", 42])).toBe("Ada scored 42");
    expect(plain(["%d", 7.9])).toBe("7");
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

describe("openable arguments", () => {
  it("keeps an object as a value of its own rather than flattening it", () => {
    const parts = formatArgs(["cells", { cx: 3, cy: 4 }]);
    expect(parts.map((p) => p.kind)).toEqual(["text", "text", "value"]);
    const last = parts[2];
    expect(last.kind === "value" && last.value).toEqual({
      t: "object",
      entries: [
        ["cx", { t: "number", v: "3" }],
        ["cy", { t: "number", v: "4" }],
      ],
    });
  });

  it("keeps %o openable and %s flat", () => {
    const shown = formatArgs(["%o", { a: 1 }]);
    expect(shown[0].kind).toBe("value");
    const said = formatArgs(["%s", { a: 1 }]);
    expect(said.every((p) => p.kind === "text")).toBe(true);
    expect(plain(["%s", { a: 1 }])).toBe("{a: 1}");
  });

  it("does not re-snapshot a value that arrived already flattened", () => {
    const already = { t: "array" as const, items: [{ t: "number" as const, v: "1" }] };
    const parts = formatArgs([already]);
    expect(parts[0].kind === "value" && parts[0].value).toBe(already);
  });
});

describe("where a line came from", () => {
  it("tags the editor's own commentary App and the console JS", () => {
    clearLog();
    info("Imported tower.psd");
    error("Save failed:", "disk full");
    logFrom({ source: "js" }, "warn", "Phaser: no WebGL");
    logFrom({ source: "js" }, "log", "walking");

    expect(getEntries().map((e) => [e.source, e.level])).toEqual([
      ["app", "info"],
      ["app", "error"],
      ["js", "warn"],
      ["js", "log"],
    ]);
  });

  it("carries the site a line was written at, when it has one", () => {
    clearLog();
    logFrom(
      { source: "js", site: { path: "js/WorldScene.js", line: 31, column: 7 } },
      "log",
      "here",
    );
    expect(getEntries()[0].site).toEqual({
      path: "js/WorldScene.js",
      line: 31,
      column: 7,
    });
    logFrom({ source: "js" }, "log", "nowhere");
    expect(getEntries()[1].site).toBeUndefined();
  });

  it("keeps an error's stack, which is the part worth reading", () => {
    clearLog();
    const err = new Error("boom");
    err.stack = "Error: boom\n    at WorldScene.create (WorldScene.js:31:7)";
    logFrom({ source: "js" }, "error", err);
    expect(getEntries()[0].message).toContain("WorldScene.js:31:7");
  });
});
