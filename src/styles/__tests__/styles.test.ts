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
import modesCss from "../modes.css?raw";
import panelsCss from "../panels.css?raw";
import inspectCss from "../inspect.css?raw";
import libraryCss from "../library.css?raw";
import sheetsCss from "../sheets.css?raw";
import optionsCss from "../options.css?raw";

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

  /**
   * A tool that draws itself at the pointer hides the system cursor, and the
   * pair have to agree: `drawing-layer.ts` puts the class on for exactly the
   * tools `previews` answers for, and without the rule below a crosshair sits
   * on top of a six-pixel tip — which is most of what the preview was for.
   * The tools whose mark is a whole gesture keep the crosshair.
   */
  it("hides the pointer for a tool that paints its own", () => {
    expect(rule(".draw-surface.active").cursor).toBe("crosshair");
    expect(rule(".draw-surface.active.paints-cursor").cursor).toBe("none");
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
/**
 * The publish sheets are two columns beside two columns: choosing a
 * destination, and reviewing what to send. Two rules there are load-bearing
 * rather than decorative, and neither fails in a way anybody would call a
 * styling bug.
 */
/**
 * The options vocabulary — `styles/options.css` — is the settings look this
 * app's option pages are built on, and it is deliberately not the modernist
 * system the rest of the chrome uses. Three of its rules are load-bearing
 * rather than decorative.
 */
describe("the options list", () => {
  /**
   * The tokens are on `:root`, not on `.options`, and that is the difference
   * between a field used outside an options page working and drawing a bright
   * border round itself. An undefined `var()` makes the declaration invalid at
   * computed-value time, and `border-color` then resolves to `currentColor` —
   * which is text, not a hairline. The publish destination sheet uses
   * `.options-field` outside any `.options`, so this is not hypothetical.
   */
  it("declares its tokens where anything can reach them", () => {
    const root = ruleIn(optionsCss, ":root");
    for (const token of ["--opt-radius", "--opt-edge", "--opt-sub", "--opt-surface"]) {
      expect(root[token], `${token} has to be a :root default`).toBeTruthy();
    }
    // `.options` is a scope that may override them, not where they live.
    expect(ruleIn(optionsCss, ".options")["--opt-radius"]).toBeUndefined();
  });

  /**
   * A group is one rounded card and its rows take its corners by being
   * clipped, rather than each row knowing whether it is first or last.
   */
  it("clips the rows to the group's corners", () => {
    const rows = ruleIn(optionsCss, ".options-rows");
    expect(rows["border-radius"]).toBeTruthy();
    expect(rows.overflow).toBe("hidden");
  });

  /**
   * The separator between rows is inset to where the text starts, which is
   * what makes a list read as a list. It is a pseudo-element because a
   * `border-bottom` cannot be inset — and it is on `.option + .option`, so the
   * first row has none without anybody writing `:last-child { border: 0 }`.
   */
  it("insets the rule between rows to where the text starts", () => {
    const rule = ruleIn(optionsCss, ".option + .option::before");
    expect(rule.position).toBe("absolute");
    expect(rule.left).toContain("--opt-lead");
    expect(rule["border-top"]).toBeTruthy();
  });
});

describe("the publish sheets", () => {
  it("puts the two halves side by side", () => {
    expect(ruleIn(sheetsCss, ".publish-split").display).toBe("flex");
    expect(ruleIn(sheetsCss, ".publish-pane").flex).toBeTruthy();
    expect(ruleIn(sheetsCss, ".publish-side").flex).toBeTruthy();
  });

  /**
   * The column that is *not* the current choice is dimmed and stays live —
   * clicking in it is how you change your mind. `display: none` or
   * `pointer-events: none` there would leave somebody who picked GitHub with
   * no way back to the server side without reopening the sheet.
   */
  it("dims the unchosen column rather than taking it away", () => {
    const dimmed = ruleIn(sheetsCss, ".publish-side:not(.active)");
    expect(Number(dimmed.opacity)).toBeGreaterThan(0.4);
    expect(dimmed.display).toBeUndefined();
    expect(dimmed["pointer-events"]).toBeUndefined();
  });

  /**
   * A file list ellipsizes at the **front**, because two paths in a site
   * differ at the end: cutting the other way gives forty rows that all read
   * `js/scenes/Sc…`.
   */
  it("cuts a long path where the difference is not", () => {
    expect(ruleIn(sheetsCss, ".publish-file-name").direction).toBe("rtl");
    expect(ruleIn(sheetsCss, ".publish-file-name")["text-align"]).toBe("left");
  });
});

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

  /**
   * ⌘F's box is `position: absolute` in the editor's own column. Without a
   * containing block on that column the nearest positioned ancestor is the
   * shell, so the box would hang in the top right corner of the *window* —
   * over the inspector in a bottom dock, and off the panel entirely in a
   * column one. Nothing throws; the Find simply appears somewhere else.
   */
  it("gives the floating Find something to be positioned in", () => {
    expect(ruleIn(codeCss, ".code-main").position).toBe("relative");
    expect(ruleIn(codeCss, ".code-find").position).toBe("absolute");
  });

  /**
   * ⇧⌘F's answers stand where the tree was — a 170px column dock has room for
   * one of them. The class is the whole mechanism: `FileTree.setSearching`
   * toggles it and nothing is destroyed, so the tree comes back folded exactly
   * as it was. If the rule went, the results and the tree would stack and the
   * column would scroll two lists.
   */
  it("puts the cross-file Find's results where the tree was", () => {
    const body = withoutComments(codeCss);
    expect(body).toContain(".code-column.searching .code-files { display: none; }");
    expect(ruleIn(codeCss, ".code-column.searching .code-column-head").flex).toBe("1");
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

  /**
   * The reference beside the editor keeps its contents list beside its page.
   *
   * It used to stack them, and that took the page's scroll with it: a `flex:
   * 1` child of a column with no `min-height: 0` cannot shrink below its own
   * content, so it grew past the panel and was cut off by the panel's
   * `overflow: hidden` with nothing to scroll it back. Both halves are
   * asserted because the symptom — a longer page showing less of itself —
   * does not read as a layout rule at all.
   */
  it("keeps the reference's nav beside its page, and the page scrollable", () => {
    const body = withoutComments(docsCss);
    expect(body).not.toContain(".docs-panel.docs-right .docs-body");
    const content = ruleIn(docsCss, ".docs-content");
    expect(content["min-height"]).toBe("0");
    expect(content["min-width"]).toBe("0");
    expect(content["overflow-y"]).toBe("auto");
  });

  /**
   * And it lets the reference have the whole height of the row it is in.
   *
   * Half is the right cap for a reference stacked on a 320px bottom dock and
   * meaningless for one beside the editor — and a `max-height` is the one
   * thing that beats the `height: auto` a stretched flex item needs, so the
   * panel stopped at half the dock and its page was cut off at the same line
   * however long the page was. Measured in a browser rather than reasoned
   * about, which is how it was found: every other rule on it was right.
   */
  it("takes the docked height cap off the reference beside the editor", () => {
    expect(ruleIn(docsCss, ".code-backdrop.docked .docs-panel")["max-height"]).toBe(
      "50%",
    );
    expect(
      ruleIn(docsCss, ".code-backdrop.docked .docs-panel.docs-right")["max-height"],
    ).toBe("none");
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

  /**
   * The panel's three bars became one, and the two safe-area insets they were
   * carrying had to be caught by whatever is left.
   *
   * Both fail silently and only on a device: the head owned the top, so
   * without this the file bar sits under the iPad's status bar; the footer
   * owned the bottom, so without this the last line of the file sits under
   * the home indicator. Neither shows up on a Mac at all.
   */
  it("carries both device insets now the head and the footer are gone", () => {
    const bar = ruleIn(codeCss, ".code-backdrop:not(.docked) .code-bar");
    expect(bar["padding-top"]).toBe("var(--safe-top)");
    const panel = ruleIn(codeCss, ".code-backdrop:not(.docked) .code-panel");
    expect(panel["padding-bottom"]).toBe("var(--safe-bottom)");
  });

  /**
   * One row where there were three, so the bar has to carry a path it can no
   * longer give a whole line to. Only the folders may be given away: a bar
   * that cut the other way would name a folder instead of the open file.
   */
  it("shrinks a path's folders and never its filename", () => {
    const dir = ruleIn(codeCss, ".code-path-dir");
    expect(dir.flex).toBe("0 1 auto");
    expect(dir["text-overflow"]).toBe("ellipsis");
    expect(ruleIn(codeCss, ".code-path-name").flex).toBe("none");
  });
});

/**
 * Code mode runs the game over the canvas exactly as Play does, and keeps
 * *one* of the panels around it. All of that is rules rather than code, so
 * all of it is asserted: the tools that would have nothing to act on go down,
 * the inspector goes with them because a selection cannot be reached through
 * a running game, and the layer column — the reason the mode keeps a sidebar
 * at all, since it is the directory of scenes, layers and PSDs — stays up
 * along with the toggle that folds it.
 */
describe("code mode", () => {
  it("puts the canvas tools and the ink's own layer down", () => {
    expect(rule(".editor.code-mode .selection-actions").display).toBe("none");
    expect(rule(".editor.code-mode .draw-surface").display).toBe("none");
    expect(rule(".editor.code-mode .editor-canvas-wrap canvas")["pointer-events"]).toBe(
      "none",
    );
  });

  it("takes the inspector down, with its divider and its toggle", () => {
    for (const selector of [
      ".editor.code-mode .side-panel.right",
      ".editor.code-mode .resize-handle.right",
      ".editor.code-mode .edge-toggle.right",
    ]) {
      expect(rule(selector).display, selector).toBe("none");
    }
  });

  it("leaves the layer column up", () => {
    const body = withoutComments(css);
    expect(body).not.toContain(".editor.code-mode .side-panel.left");
    expect(body).not.toContain(".editor.code-mode .side-panel,");
  });

  /**
   * The bug this is here for: the toggle was drawn *under* the game frame, so
   * the one control that folds the sidebar Code exists to keep was invisible
   * and unclickable for the whole of the mode. It has to outrank the frame.
   */
  it("lifts the left toggle over the running game", () => {
    const toggle = Number(rule(".editor.code-mode .edge-toggle.left")["z-index"]);
    expect(toggle).toBeGreaterThan(Number(rule(".game-frame")["z-index"]));
  });
});

/**
 * The directory Code mode makes of the left sidebar.
 *
 * One rule in here fails silently and is the reason this block exists: the
 * `+` is hidden through the `hidden` attribute, and `.panel-add` sets
 * `display: flex`, which outranks the user agent's own
 * `[hidden] { display: none }`. Without a rule of its own the button is still
 * there — and Add layer in a mode with no canvas to add one to is the one
 * control that had to go.
 */
describe("the sidebar as a directory", () => {
  it("actually hides the add-layer button", () => {
    expect(ruleIn(panelsCss, ".panel-add[hidden]").display).toBe("none");
  });

  it("lets the names be selected, which nothing else in the shell allows", () => {
    // The point of a lookup is copying what you looked up.
    expect(
      ruleIn(panelsCss, ".side-panel.left.browsing .panel-body")["user-select"],
    ).toBe("text");
  });
});

/**
 * A named inspector section folds away, and the two rules that make the fold
 * a fold rather than a class nobody reads are here rather than in code — the
 * pass in `editor/inspect-collapse.ts` only adds `collapsed` and lets the
 * stylesheet decide what that means.
 */
describe("the inspector's folded sections", () => {
  it("hides everything but the heading", () => {
    const folded = ruleIn(
      inspectCss,
      ".inspect-section.collapsed > *:not(.inspect-section-fold)",
    );
    expect(folded.display).toBe("none");
  });

  it("gives the heading a caret that turns when it is shut", () => {
    // Two borders on a square turned 45°: down is open, and a quarter turn
    // anticlockwise is shut. No asset, and nothing to line up.
    expect(ruleIn(inspectCss, ".inspect-section-fold::after").transform).toBe(
      "rotate(45deg)",
    );
    expect(
      ruleIn(inspectCss, ".inspect-section.collapsed > .inspect-section-fold::after")
        .transform,
    ).toBe("rotate(-45deg)");
  });

  /**
   * A heading can carry a subject after a colon — `BRUSH : INK` — which makes
   * it two spans rather than one. `space-between` would then put the subject
   * in the middle of the row with the caret past it; the caret has to take the
   * free space instead, or the heading reads as two unrelated words.
   */
  it("keeps the caret at the end of a heading that carries a subject", () => {
    const fold = ruleIn(inspectCss, ".inspect-section-fold");
    expect(fold["justify-content"]).toBe("flex-start");
    expect(ruleIn(inspectCss, ".inspect-section-fold::after")["margin-left"]).toBe(
      "auto",
    );
  });
});

/**
 * The three zone headings fold too, and they are the one thing in this panel
 * that is not a section — so they need both halves: the fold itself, and
 * enough contrast to say which three headings are the structure. See
 * editor/inspect-zone.ts.
 */
describe("the inspector's zones", () => {
  it("folds the body away and turns the caret, as a section does", () => {
    expect(ruleIn(inspectCss, ".inspect-zone.collapsed > .inspect-zone-body").display)
      .toBe("none");
    expect(ruleIn(inspectCss, ".inspect-zone-head::after").transform).toBe(
      "rotate(45deg)",
    );
    expect(
      ruleIn(inspectCss, ".inspect-zone.collapsed > .inspect-zone-head::after")
        .transform,
    ).toBe("rotate(-45deg)");
  });

  it("marks the boundary more heavily than a section's", () => {
    // 2px is the system's heavy rule, and the only one in this panel: every
    // section boundary is 1px. Without the difference a column of foldable
    // headings has nothing in it that says which three are the structure.
    expect(ruleIn(inspectCss, ".inspect-zone")["border-top"]).toContain("2px");
    expect(ruleIn(inspectCss, ".inspect-section")["border-top"]).toContain("1px");
    expect(ruleIn(inspectCss, ".inspect-zone-head").background).toBeTruthy();
  });
});

/**
 * A brush button shows the tip it stamps with, and that is a *mask* rather
 * than a picture: the atlas PNGs are black with an alpha channel, so drawn as
 * images on this editor's dark chrome they would be black on black. The
 * declarations that make it a mask are the whole of the feature, and there is
 * no type checker over them — without the size the button shows all four
 * variants squeezed into it, and without the background there is nothing for
 * the mask to reveal.
 */
describe("the brush stamps", () => {
  it("windows one variant out of the four-cell atlas", () => {
    const stamp = ruleIn(inspectCss, ".brush-stamp");
    expect(stamp.background).toBe("currentColor");
    expect(stamp["mask-size"]).toBe("400% 100%");
    expect(stamp["-webkit-mask-size"]).toBe("400% 100%");
    expect(stamp["mask-repeat"]).toBe("no-repeat");
  });

  it("keeps the box square, so a square tip is not stretched", () => {
    // The atlas cells are square and the buttons are flexible, so a stamp
    // that filled its button distorted the tip it is there to show — which is
    // the one thing a picture of a brush must not do. Paired with the 400%
    // mask above: both together are what puts one whole cell in the box at
    // its own proportions.
    const stamp = ruleIn(inspectCss, ".brush-stamp");
    expect(stamp.width).toBe(stamp.height);
    expect(stamp.flex).toBe("none");
  });
});

/**
 * The bar that floats beside a shape being tapped out.
 *
 * It looks like the action bar over a grid selection and is placed by the
 * same code, but it is deliberately *not* that class: `modes.css` takes
 * `.selection-actions` down while a canvas mode owns the canvas, and this one
 * must stay up — the fill works inside PSD Edit mode, which is the mode whose
 * whole subject is drawing.
 */
describe("the floating fill bar", () => {
  it("floats over the canvas column", () => {
    const bar = rule(".canvas-float");
    expect(bar.position).toBe("absolute");
    // Over the canvas, under the mode bars — the same layer the selection
    // bar sits on.
    expect(bar["z-index"]).toBe("6");
  });

  it("is not swept away with the selection bar by a canvas mode", () => {
    const body = withoutComments(modesCss);
    expect(body).not.toContain(".canvas-float");
  });
});

/**
 * The drawing toolbar, and the one rule that keeps it reachable.
 *
 * It is the same column as the rail — same class, same 56px buttons — turned
 * the other way up: `top: auto; bottom: 16px` is the whole difference, and
 * dropping either half leaves it hanging from the top *over* the rail, which
 * is a stack of nine buttons where there should be four.
 *
 * A canvas mode then puts a 52px bar along the bottom edge it stands on, at a
 * higher z-index — so without the lift the toolbar is *behind* it, which in
 * PSD Edit mode means the pencil, the pattern brush and the sweep fill are
 * unreachable inside the mode whose whole subject is drawing.
 */
describe("the drawing toolbar", () => {
  it("stands on the bottom-left corner rather than hanging from the top", () => {
    const rail = rule(".tool-rail");
    expect(rail.position).toBe("absolute");
    expect(rail.left).toBe("16px");
    expect(rail["flex-direction"]).toBe("column");
    const draw = rule(".tool-rail.draw-bar");
    expect(draw.top).toBe("auto");
    expect(draw.bottom).toBe("16px");
  });

  it("lifts clear of PSD Edit mode's bar", () => {
    expect(
      ruleIn(modesCss, ".editor-canvas-wrap.psd-editing .draw-bar").bottom,
    ).toBe("68px");
  });

  it("goes down in the three modes that own the pointer outright", () => {
    expect(
      ruleIn(modesCss, ".editor-canvas-wrap.masking .draw-bar").display,
    ).toBe("none");
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

  /**
   * And it is Draw's alone. The map frames the camera the canvas is looking
   * through, and in Code and Play the canvas is behind a running game — so
   * the frame would be drawn around a camera nobody is looking through. Play
   * takes the whole sidebar down anyway; Code is the one that keeps it, which
   * is why the rule has to name both.
   */
  it("is down in the two modes that run the game over the canvas", () => {
    expect(rule(".editor.code-mode .minimap").display).toBe("none");
    const body = withoutComments(css);
    expect(body).toContain(".editor.play-mode .minimap");
  });
});

/**
 * The two library editors' toolbars, which are 210 pixels wide.
 *
 * Both rules here are about that width. The sheet's own segmented control is
 * built for the New Project sheet, where a row is the width of the page, and at
 * that size Draw / Select / Pan wrapped onto three lines; and the ways out of
 * an editor are a group held at the right-hand end of the action row, away
 * from the Undo and Redo that are about the work rather than about leaving.
 */
describe("the library editors' chrome", () => {
  it("sizes the mode row to the chips beside it", () => {
    const chip = ruleIn(libraryCss, ".lib-chip");
    const opt = ruleIn(libraryCss, ".lib-section .seg-opt");
    expect(opt.padding).toBe(chip.padding);
    expect(opt.font).toBe(chip.font);
    // And it may shrink: the sheet's own is 44px tall for the finger.
    expect(opt["min-height"]).toBe("0");
  });

  it("holds the ways out at the right-hand end", () => {
    expect(ruleIn(sheetsCss, ".sheet-actions-end")["margin-left"]).toBe("auto");
  });
});
