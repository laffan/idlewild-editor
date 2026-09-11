/**
 * The stylesheet rules that other code depends on being there.
 *
 * CSS is the one part of this editor with no type checker over it, and the
 * drawing layer is the place where a missing rule does not look like a
 * missing rule. `src/drawing/surface.ts` builds an absolutely-positioned
 * overlay in the markup's head and lets the stylesheet place it: without
 * `position: absolute` the surface lays out in the flow *after* Phaser's
 * canvas, and the stage's own transform then drags a backing canvas of up to
 * 1536 CSS pixels back up over it. Nothing throws. The ink goes somewhere
 * off-screen, and an invisible sheet with the default `pointer-events: auto`
 * swallows every pointer-down over the part of the canvas it covers — which
 * is how the Pencil stopped drawing, and how Select and Pan stopped
 * answering over an editor with the code panel open (which is where the
 * canvas is short enough for the sheet to cover all of it).
 *
 * So the rules are asserted rather than trusted. This is not a test of what
 * the page looks like; it is a test of the handful of declarations that are
 * load-bearing for input.
 */

import { describe, expect, it } from "vitest";
// The stylesheet as text, through Vite's own `?raw` — which is how the test
// reads the same file the app ships without reaching for node's filesystem.
import css from "../editor.css?raw";

/** The declarations of one rule, by property. Comments are stripped first. */
function rule(selector: string): Record<string, string> {
  const body = withoutComments(css);
  const at = body.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = body.indexOf("{", at);
  const close = body.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const line of body.slice(open + 1, close).split(";")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the drawing layer's stylesheet", () => {
  it("takes the surface out of the flow and over the canvas", () => {
    const surface = rule(".draw-surface");
    expect(surface.position).toBe("absolute");
    expect(surface.inset).toBe("0");
    expect(surface.overflow).toBe("hidden");
  });

  it("leaves the surface inert until a drawing tool is up", () => {
    expect(rule(".draw-surface")["pointer-events"]).toBe("none");
    expect(rule(".draw-surface.active")["pointer-events"]).toBe("auto");
  });

  it("anchors the stage's transform to its top-left", () => {
    const stage = rule(".draw-stage");
    expect(stage.position).toBe("absolute");
    expect(stage.left).toBe("0");
    expect(stage.top).toBe("0");
    // The stage is translated by (anchor − origin) × zoom, which is measured
    // from its top-left. Left at the default 50% 50% the backing lands half
    // its own size away from where the ink was baked.
    expect(stage["transform-origin"]).toBe("0 0");
    expect(stage["pointer-events"]).toBe("none");
  });

  it("keeps the backing canvases out of the flow and out of the way", () => {
    const canvas = rule(".draw-stage canvas");
    expect(canvas.position).toBe("absolute");
    expect(canvas["pointer-events"]).toBe("none");
  });
});
