/**
 * The canvas's marks for code that no longer follows Draw: pressable, over a
 * sheet that takes no pointer, and Draw's alone — in Code and Play the canvas
 * is behind the running game.
 */

import { describe, expect, it } from "vitest";
import css from "../layer-directory.css?raw";
import { ruleIn } from "./rules";

describe("the code marks on the canvas", () => {
  it("lets the pointer through everywhere but the marks", () => {
    expect(ruleIn(css, ".code-marks")["pointer-events"]).toBe("none");
    expect(ruleIn(css, ".code-mark")["pointer-events"]).toBe("auto");
  });

  it("is not drawn under a running game", () => {
    expect(ruleIn(css, ".play-mode .code-marks").display).toBe("none");
  });
});
