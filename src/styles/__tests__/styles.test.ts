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
// The stylesheets as text, through Vite's own `?raw` — which is how the test
// reads the same files the app ships without reaching for node's filesystem.
import css from "../editor.css?raw";
import codeCss from "../code.css?raw";
import docsCss from "../docs.css?raw";
import panelsCss from "../panels.css?raw";

/** The declarations of one rule, by property. Comments are stripped first. */
function rule(selector: string): Record<string, string> {
  return ruleIn(css, selector);
}

/**
 * The same, in a named stylesheet.
 *
 * A grouped selector is found by its **last** member, since that is the one
 * followed by the brace.
 */
function ruleIn(source: string, selector: string): Record<string, string> {
  const body = withoutComments(source);
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

/**
 * Where the code panel sits, which is four rules and one trap.
 *
 * Floating, the panel is `position: absolute; inset: 0`. A box given top,
 * bottom *and* a size is over-constrained, so the browser drops `bottom` and
 * the panel hangs from the top of the shell at whatever size it was docked at
 * — which is why `editor/code-panel.ts` takes both inline sizes off on every
 * move, and why the docked rules have to be the ones carrying a size. If the
 * docked rules stopped taking the panel out of that positioning, a dock would
 * look like a panel that had covered the editor.
 */
describe("the code panel's placements", () => {
  it("floats over the whole shell when it is not docked", () => {
    const floating = ruleIn(codeCss, ".code-backdrop");
    expect(floating.position).toBe("absolute");
    expect(floating.inset).toBe("0");
  });

  it("takes a docked panel out of that positioning and out of the flex flow", () => {
    const docked = ruleIn(codeCss, ".code-backdrop.docked");
    expect(docked.position).toBe("static");
    expect(docked.inset).toBe("auto");
    expect(docked.flex).toBe("none");
  });

  it("gives the bottom dock a height and the column a width", () => {
    expect(ruleIn(codeCss, ".code-backdrop.dock-bottom").height).toBeTruthy();
    const column = ruleIn(codeCss, ".code-backdrop.dock-right");
    expect(column.width).toBeTruthy();
    // A column takes the height of the row it is in, not the height it had as
    // a bottom dock — the inline one is removed, and this is the fallback.
    expect(column.height).toBe("auto");
  });

  it("moves the reference between the two axes the same way", () => {
    // The same trap as the panel's own: the docked height has to stop
    // applying, or the reference beside the editor is 260px tall in a column
    // that is 800.
    const beside = ruleIn(docsCss, ".docs-panel.docs-right");
    expect(beside.width).toBeTruthy();
    expect(beside.height).toBe("auto");
    expect(ruleIn(docsCss, ".docs-panel").height).toBeTruthy();
  });

  it("takes the file column away with its divider", () => {
    expect(ruleIn(codeCss, ".code-backdrop.files-hidden .code-column").display).toBe(
      "none",
    );
  });

  it("keeps the drag ghost out of the pointer's way", () => {
    const ghost = ruleIn(codeCss, ".code-drag-ghost");
    expect(ghost.position).toBe("fixed");
    // Under the finger, it would be the element `dropTarget` found.
    expect(ghost["pointer-events"]).toBe("none");
  });
});

/**
 * Code mode runs the game over the canvas exactly as Play does, and keeps the
 * editor around it. Both halves are rules rather than code, so both are
 * asserted: the tools that would have nothing to act on go down, and the
 * sidebars — the reason the mode exists, because a scene is switched from one
 * of them — stay up.
 */
describe("code mode", () => {
  it("puts the canvas tools and the ink's own layer down", () => {
    expect(rule(".editor.code-mode .selection-actions").display).toBe("none");
    expect(rule(".editor.code-mode .draw-surface").display).toBe("none");
    expect(rule(".editor.code-mode .editor-canvas-wrap canvas")["pointer-events"]).toBe(
      "none",
    );
  });

  it("leaves both sidebars alone", () => {
    const body = withoutComments(css);
    expect(body).not.toContain(".editor.code-mode .side-panel");
    expect(body).not.toContain(".editor.code-mode .edge-toggle");
  });
});

/**
 * The minimap is driven by a drag, and two of its rules are what make that
 * drag reach it at all. Without `touch-action: none` the iPad takes the
 * gesture as a scroll of the sidebar and the camera never moves — the same
 * failure the layer grip's own rule exists to prevent. And the frame is
 * positioned against the body it is inside: taken out of `position: absolute`
 * it lays out in the flow *after* the canvas and pushes the map out of the
 * panel, which looks like a minimap that has stopped drawing.
 */
describe("the minimap's stylesheet", () => {
  it("gives the map the whole gesture", () => {
    expect(ruleIn(panelsCss, ".minimap-body")["touch-action"]).toBe("none");
    expect(ruleIn(panelsCss, ".minimap-body").position).toBe("relative");
    expect(ruleIn(panelsCss, ".minimap-body").overflow).toBe("hidden");
  });

  it("keeps the camera's frame over the map and out of the way", () => {
    const frame = ruleIn(panelsCss, ".minimap-frame");
    expect(frame.position).toBe("absolute");
    // Under the pointer it would swallow the press that moves the camera.
    expect(frame["pointer-events"]).toBe("none");
  });
});
