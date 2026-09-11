import { describe, expect, it } from "vitest";
import bridgeSource from "../../../src-tauri/templates/play/console-bridge.js?raw";

/**
 * Where a `console.log` in the running game was written.
 *
 * This is what makes the drawer's **LOG** chip a link, so it has to survive
 * two stack formats and step over two kinds of frame that are never the
 * answer: this bridge's own, and the vendored runtimes'. The function is
 * pure and reachable from the injected script for exactly this reason — see
 * `templates/play/console-bridge.js`.
 */
const siteIn = loadSiteIn();

const BASE = "http://127.0.0.1:53411/proj-1/game/";

describe("reading a call site out of a stack", () => {
  it("reads Safari's format", () => {
    const stack = [
      `send@${BASE}index.html:41:19`,
      `create@${BASE}js/WorldScene.js:31:17`,
      `global code@${BASE}js/main.js:8:3`,
    ].join("\n");
    expect(siteIn(stack, BASE, "index.html")).toEqual({
      path: "js/WorldScene.js",
      line: 31,
      column: 17,
    });
  });

  it("reads Chrome's format", () => {
    const stack = [
      "Error",
      `    at send (${BASE}index.html:41:19)`,
      `    at WorldScene.create (${BASE}js/WorldScene.js:31:17)`,
    ].join("\n");
    expect(siteIn(stack, BASE, "index.html")).toEqual({
      path: "js/WorldScene.js",
      line: 31,
      column: 17,
    });
  });

  it("steps over the runtimes, so a call through Phaser still names your line", () => {
    const stack = [
      `send@${BASE}index.html:41:19`,
      `emit@${BASE}lib/phaser.min.js:1:90210`,
      `update@${BASE}js/WorldScene.js:52:9`,
    ].join("\n");
    expect(siteIn(stack, BASE, "index.html")?.path).toBe("js/WorldScene.js");
  });

  it("ignores frames from anywhere but this project's game tree", () => {
    const stack = [
      "run@http://127.0.0.1:53411/other-project/game/js/WorldScene.js:4:1",
      "boot@https://cdn.example.com/thing.js:9:1",
    ].join("\n");
    expect(siteIn(stack, BASE, "index.html")).toBeNull();
  });

  it("answers nothing rather than guessing when there is no game to be in", () => {
    expect(siteIn(`x@${BASE}js/WorldScene.js:1:1`, null, null)).toBeNull();
    expect(siteIn("no frames here", BASE, "index.html")).toBeNull();
  });
});

function loadSiteIn(): (
  stack: string,
  base: string | null,
  selfPath: string | null,
) => { path: string; line: number; column: number } | null {
  const win: Record<string, unknown> = {};
  win.parent = win;
  new Function("window", bridgeSource)(win);
  const fn = win.__idlewildSiteIn;
  if (typeof fn !== "function") {
    throw new Error("the bridge no longer exposes its frame reader");
  }
  return fn as ReturnType<typeof loadSiteIn>;
}
