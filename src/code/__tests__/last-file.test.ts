/**
 * Which file the code panel opens with.
 *
 * The panel is built on the way into Code and destroyed on the way out, so
 * the answer to "which file" is not in the panel — and it used to be a
 * constant, `js/scenes/WorldScene.js`, which no project scaffolded since the
 * one-file-per-scene change has. Two things are pinned here: that a file you
 * were in comes back, and that a project which has never been opened in Code
 * still lands somewhere sensible rather than in an empty editor.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { GameFile } from "../../lib/ipc";
import { forgetFile, lastFile, opening, rememberFile } from "../last-file";

/** A `localStorage` for a suite that runs in node. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

beforeEach(() => store.clear());

const tree = (...paths: string[]): GameFile[] =>
  paths.map((path) => ({ path, isDir: path.endsWith("/") }));

/** What a vanilla project holds: no scenes, no `js/` at all. */
const VANILLA = tree("game.config.json", "index.html", "script.js", "style.css");

/** What a project scaffolded by this editor actually holds. */
const SCAFFOLD = tree(
  "index.html",
  "js/",
  "js/main.js",
  "js/prefabs/character.js",
  "js/scenes/Scene1.js",
  "js/scenes/index.js",
  "js/shared/canvas.js",
);

describe("remembering the open file", () => {
  it("gives back what was last opened, per project", () => {
    rememberFile("alpha", "js/shared/canvas.js");
    rememberFile("beta", "js/main.js");
    expect(lastFile("alpha")).toBe("js/shared/canvas.js");
    expect(lastFile("beta")).toBe("js/main.js");
    expect(lastFile("gamma")).toBeNull();
  });

  it("forgets a project's answer when its file goes away", () => {
    rememberFile("alpha", "js/gone.js");
    forgetFile("alpha");
    expect(lastFile("alpha")).toBeNull();
  });

  /**
   * A path means nothing across projects — `js/prefabs/character.js` is a
   * different file in each — so the store is keyed by project and one
   * project's answer must not become another's.
   */
  it("keeps the most recent projects and drops the oldest", () => {
    for (let i = 0; i < 40; i++) rememberFile(`p${i}`, `js/${i}.js`);
    expect(lastFile("p0")).toBeNull();
    expect(lastFile("p39")).toBe("js/39.js");
    expect(lastFile("p39")).toBe("js/39.js");
  });

  it("survives a store holding something that is not a map", () => {
    store.set("idlewild.code.lastFile", "[1,2,3]");
    expect(lastFile("alpha")).toBeNull();
    rememberFile("alpha", "js/main.js");
    expect(lastFile("alpha")).toBe("js/main.js");
  });
});

describe("which file the panel opens into", () => {
  it("is the remembered one, when the project still has it", () => {
    expect(opening(SCAFFOLD, "js/shared/canvas.js")).toBe("js/shared/canvas.js");
  });

  /**
   * A file that has been renamed or deleted since is not an error — it is
   * simply not an answer, and the fallback takes over.
   */
  it("falls through when the remembered file has gone", () => {
    expect(opening(SCAFFOLD, "js/scenes/WorldScene.js")).toBe("js/scenes/Scene1.js");
  });

  it("never opens a folder", () => {
    expect(opening(SCAFFOLD, "js/")).toBe("js/scenes/Scene1.js");
  });

  /**
   * The scene, because the canvas beside this panel is showing one — and not
   * `index.js`, which is a generated list of scenes rather than a scene.
   */
  it("is the scene for a project nobody has opened Code in", () => {
    expect(opening(SCAFFOLD, null)).toBe("js/scenes/Scene1.js");
    expect(opening(tree("js/scenes/index.js", "js/main.js"), null)).toBe("js/main.js");
  });

  /**
   * A vanilla project has neither, so the file that *runs* is `script.js`.
   * Without its own line the panel landed on whichever file came first, which
   * for that tree is `game.config.json` — the one file in there nobody can
   * edit.
   */
  it("is the script for a vanilla project", () => {
    expect(opening(VANILLA, null)).toBe("script.js");
  });

  it("is whatever there is, for a tree with neither", () => {
    expect(opening(tree("styles.css"), null)).toBe("styles.css");
    expect(opening(tree(), null)).toBeNull();
    expect(opening(tree("js/"), null)).toBeNull();
  });
});
