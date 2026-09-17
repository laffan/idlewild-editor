/**
 * The guide's stylesheet: the two marks that say where the game's screen is.
 *
 * Its own file because `styles.test.ts` is at the 700-line limit, and the
 * helpers are in `rules.ts` for the same reason.
 */

import { describe, expect, it } from "vitest";
import guidesCss from "../guides.css?raw";
import { ruleIn, withoutComments } from "./rules";

/**
 * The game's screen, drawn on the canvas — `editor/screen-guide.ts`.
 *
 * Two marks over the whole canvas that nothing is meant to press, so the one
 * rule that matters most is the one that is easiest to forget: without
 * `pointer-events: none` the sheet takes every pointer-down over the canvas
 * and the editor stops answering entirely — the same failure the drawing
 * layer's surface has, by the same mechanism, and with no error to go on.
 *
 * And it is Draw's alone, for the reason the minimap is: in Code and Play the
 * canvas is behind a running game, so a drawing of where the game's screen
 * falls would be under the screen itself. Both modes are named, because the
 * pair is the rule.
 */
describe("the game's screen on the canvas", () => {
  it("covers the canvas without taking the pointer", () => {
    const guide = ruleIn(guidesCss, ".screen-guide");
    expect(guide.position).toBe("absolute");
    expect(guide.inset).toBe("0");
    expect(guide["pointer-events"]).toBe("none");
    // Its own layer, below the ink at 4 and the tool rail at 5. Sharing one
    // with either would leave document order to settle it, and the boundary
    // is a rectangle wide enough to cross the rail's buttons.
    expect(guide["z-index"]).toBe("3");
    // Clipped, because the boundary is a rectangle in world units and a
    // camera zoomed in on one corner of it puts the rest a long way outside.
    expect(guide.overflow).toBe("hidden");
  });

  it("puts the dashes on the edge of the game's screen", () => {
    const frame = ruleIn(guidesCss, ".screen-guide-frame");
    expect(frame.position).toBe("absolute");
    // `guideBox` hands over the size of the game's screen, not the size of an
    // element plus its border, so the border has to fall inside it.
    expect(frame["box-sizing"]).toBe("border-box");
    expect(frame.border).toContain("dashed");
  });

  it("is down in the two modes that run the game over the canvas", () => {
    expect(ruleIn(guidesCss, ".editor.code-mode .screen-guide").display).toBe(
      "none",
    );
    expect(withoutComments(guidesCss)).toContain(
      ".editor.play-mode .screen-guide",
    );
  });
});
