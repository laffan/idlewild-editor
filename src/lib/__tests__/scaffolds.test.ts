/**
 * The four scaffolds, and the two questions the editor asks about one.
 *
 * `Scaffold` is the only choice on the New Project sheet that the editor does
 * *not* read while you draw — Template and Grid scale reach the canvas, and
 * this reaches the code on the other side of it. What the editor does read it
 * for is two rows it withholds: Page Setup, on a project with no scaffolded
 * page, and the character controller, on a project with no character module.
 * Both of those are the shape of bug that shows up as a setting that silently
 * does nothing, so the two predicates are pinned here rather than left to the
 * two sheets that call them.
 *
 * The template sources are read as text for the reason `console-site.test.ts`
 * reads the console bridge that way: they are JavaScript shipped to exports
 * rather than modules of this app, and reading one *is* the test. What is
 * asserted about them is only what a broken scaffold would break — an import
 * of a file the scaffold does not write is a game that will not boot.
 */

import { describe, expect, it } from "vitest";
import {
  hasCharacter,
  isPhaserScaffold,
  SCAFFOLDS,
  scaffoldLabel,
  type Scaffold,
} from "../types";
import p2pScene from "../../../src-tauri/templates/p2p/js/scenes/Scene.js?raw";
import commonScene from "../../../src-tauri/templates/common/js/scenes/Scene.js?raw";
import vanillaHtml from "../../../src-tauri/templates/vanilla/index.html?raw";
import vanillaScript from "../../../src-tauri/templates/vanilla/script.js?raw";
import optionsCss from "../../styles/options.css?raw";
import { ruleIn } from "../../styles/__tests__/rules";

const ALL: Scaffold[] = ["topdown", "platformer", "p2p", "vanilla"];

describe("the scaffolds the sheet offers", () => {
  it("offers all four, in the order they scaffold least last", () => {
    expect(SCAFFOLDS.map((row) => row.value)).toEqual(ALL);
  });

  it("names the two new ones the way the brief does", () => {
    expect(scaffoldLabel("p2p")).toBe("Blank PSD to Phaser");
    expect(scaffoldLabel("vanilla")).toBe("Vanilla");
  });

  /**
   * A project made before the choice existed carries no scaffold at all, and
   * what every one of those has always been is top down. The fallback is the
   * migration path, so it is the one answer worth a test of its own.
   */
  it("reads a project made before the choice existed as top down", () => {
    expect(scaffoldLabel(undefined)).toBe("Top Down");
    expect(isPhaserScaffold(undefined)).toBe(true);
    expect(hasCharacter(undefined)).toBe(true);
  });
});

describe("what the editor withholds, and from which scaffold", () => {
  /**
   * Page Setup writes six values into the generated config for `js/main.js`
   * to put on the document as custom properties. A vanilla project has no
   * `js/main.js` and a `style.css` with no `var()` in it, so every one of
   * those would be a value nothing reads.
   */
  it("keeps Page Setup on every scaffold that writes the page it describes", () => {
    expect(ALL.filter(isPhaserScaffold)).toEqual(["topdown", "platformer", "p2p"]);
  });

  /**
   * The character switch is a switch because `js/shared/character.js` reads
   * `config.character` and answers no. The two leaner scaffolds do not write
   * that file, so there is nothing for the switch to reach.
   */
  it("keeps the character controller on the two scaffolds that write one", () => {
    expect(ALL.filter(hasCharacter)).toEqual(["topdown", "platformer"]);
  });

  /**
   * And the row it withholds actually disappears. `.option` sets
   * `display: flex`, which is an author rule, while the browser's own
   * `[hidden] { display: none }` is user-agent origin and loses whatever its
   * specificity — the same trap `.tool-btn[hidden]` was written for.
   */
  it("draws no row for a withheld option, whatever `.option` says", () => {
    expect(ruleIn(optionsCss, ".option[hidden]").display).toBe("none");
  });
});

describe("the Blank PSD to Phaser scene", () => {
  it("places the document the way a whole game does", () => {
    for (const call of ["loadDocument", "applyCamera", "placeDocument", "updateCanvas"]) {
      expect(p2pScene).toContain(call);
      expect(commonScene).toContain(call);
    }
  });

  /**
   * The one that would be a boot failure rather than a missing feature: the
   * scaffold writes no `js/shared/character.js` for a P2P project, so a scene
   * importing one is a module resolution error before a frame is drawn.
   */
  it("imports nothing the P2P scaffold does not write", () => {
    expect(commonScene).toContain("../shared/character.js");
    expect(p2pScene).not.toContain("character.js");
    expect(p2pScene).not.toContain("spawnCharacter");
    expect(p2pScene).not.toContain("updateCharacter");
  });

  it("is the author's end to end, like every scene file", () => {
    expect(p2pScene).not.toContain("// idlewild:");
  });
});

describe("the vanilla page", () => {
  it("links the two files beside it and loads no runtime", () => {
    expect(vanillaHtml).toContain('href="style.css"');
    expect(vanillaHtml).toContain('src="script.js"');
    expect(vanillaHtml).not.toContain("js/lib/");
    expect(vanillaHtml).not.toContain("<script src=");
  });

  /**
   * The config is at the root rather than under `js/`, because a vanilla tree
   * has no `js/`. `script.js` fetching it from anywhere else is the whole of
   * what would be broken, and it is broken silently — the page renders, and
   * the only symptom is a console error nobody opened the drawer for.
   */
  it("reads the config from where a vanilla project keeps it", () => {
    expect(vanillaScript).toContain('fetch("game.config.json")');
  });
});
