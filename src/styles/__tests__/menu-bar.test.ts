/**
 * Room for the iPadOS menu bar, which a pointer at the top edge brings down
 * over a full-screen window — see `lib/window-chrome.ts`.
 *
 * Both halves fail only on a device with a trackpad: the token that holds the
 * top open, and every top inset reading it through `--safe-top` rather than
 * the raw `env()`.
 */

import { describe, expect, it } from "vitest";
import tokensCss from "../tokens.css?raw";
import editorCss from "../editor.css?raw";
import homeCss from "../home.css?raw";
import { ruleIn } from "./rules";

describe("the menu bar's room", () => {
  it("is held open only while the window says a pointer is attached", () => {
    expect(ruleIn(tokensCss, ":root")["--menu-bar-room"]).toBe("0px");
    expect(ruleIn(tokensCss, "html.ipad.menu-bar-room")["--menu-bar-room"]).toBe("28px");
    expect(ruleIn(tokensCss, ":root")["--safe-top"]).toBe(
      "max(env(safe-area-inset-top, 0px), var(--menu-bar-room))",
    );
  });

  it("is what the header and the home screen's bar pad their tops by", () => {
    expect(editorCss).toContain("padding-top: var(--safe-top)");
    expect(homeCss).toContain("var(--safe-top)");
    for (const css of [editorCss, homeCss]) expect(css).not.toContain("safe-area-inset-top");
  });
});
