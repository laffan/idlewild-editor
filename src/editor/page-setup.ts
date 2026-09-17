/**
 * Page Setup: the HTML and CSS around the game, rather than the game.
 *
 * Everything else in this editor is about what the canvas holds. This is about
 * the **document the canvas is embedded in** — the page a published site opens
 * as, and the one Play runs in. A project has always had one and it has always
 * been the same page: the game filling the window, square-cornered, flush to
 * every edge, on the scaffold's own pale blue. That is a reasonable default and
 * a poor only answer, and it is the reason this sheet exists. A 320×568 phone
 * game shown on a desktop should be a 320×568 game on a desktop, not one
 * stretched across it.
 *
 * ## Six settings, and what each is actually doing
 *
 * - **Fixed size** turns the game from "the window" into a box. Off, nothing
 *   below it about size means anything, which is why the two numbers go quiet
 *   rather than away — a setting that vanishes is a setting people think they
 *   imagined. The size is remembered while it is off, so turning it on again
 *   comes back to what you had.
 * - **Centred** puts the box in the middle of the page rather than at its top
 *   left. Nothing to see while the game fills the window.
 * - **Margin** is clear space around the game, and the first of the three that
 *   makes the page colour visible at all.
 * - **Corner radius** rounds the game itself. It needs `overflow: hidden` on
 *   the box to do anything, because the canvas inside it is an opaque
 *   rectangle — the scaffold's stylesheet has it.
 * - **Page colour** is the `html` background, behind everything. Explicitly
 *   *not* Phaser's own `backgroundColor`, which is behind what the scenes
 *   draw: two surfaces, and they are only ever both visible when one of the
 *   three above has pulled the game back from an edge.
 *
 * ## Why this sheet writes nothing into the project's own files
 *
 * The obvious build is the literal one: rewrite the rules in the project's
 * `styles.css` whenever a number changes. It is also the one that fights the
 * person using it — a `game/` tree is the project's own copy the moment the
 * scaffold writes it, and an editor that owns lines inside a stylesheet is an
 * editor that undoes your edits to them.
 *
 * So these ride in `game.config.json`, the way `pixelArt` and the default zoom
 * already do, and the scaffold reads them: `js/main.js` writes them onto the
 * document as custom properties, and every rule in `styles.css` reads one with
 * a fallback. Change a rule and it stays changed. Delete the block in `main.js`
 * and the page is what it always was. The editor is never in the file.
 *
 * ## It takes effect where it is visible, which is Play
 *
 * There is no live preview on the canvas behind this sheet, because there is
 * nothing on that canvas this describes: the editor draws a world, not a page.
 * What it does do is restart a running game, so with Play up the sheet *is* its
 * own preview — the same `onChanged` the render settings use, for the same
 * reason and through the same path.
 */

import { openSheet } from "../lib/sheet";
import { h } from "../lib/dom";
import { createColorPicker } from "../lib/color-picker";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import {
  optionNumber,
  optionSegmented,
  optionSwatch,
  optionSwitch,
} from "../lib/options-controls";
import { projects } from "../lib/ipc";
import * as log from "../lib/log";
import {
  GAME_SIZE_RANGE,
  projectPresentation,
  SPACING_RANGE,
  type Presentation,
  type ProjectMeta,
} from "../lib/types";

/**
 * Open the sheet.
 *
 * `onChanged` fires once the new page is on disk and the config has been
 * rewritten around it — what the shell uses to restart a game that is up. Not
 * before: a running game is reading `game.config.json` as it was, and told any
 * earlier it would restart on the old numbers.
 */
export function openPageSetup(
  meta: ProjectMeta,
  onChanged: () => void = () => {},
): void {
  let page = projectPresentation(meta);

  const sheet = openSheet({
    title: "Page Setup",
    subtitle: meta.name,
    width: 620,
  });

  /**
   * Write, and tell the shell once it is written.
   *
   * Every control commits as it is changed — there is no Save on this sheet,
   * which is the settings vocabulary's own shape. A failure is worth saying:
   * the sheet has already moved to the new answer, so silence would leave it
   * and the project disagreeing about the project.
   */
  const commit = (next: Partial<Presentation>): void => {
    page = { ...page, ...next };
    void projects
      .setPresentation(meta.id, page)
      .then((written) => {
        meta.presentation = written.presentation;
        onChanged();
      })
      .catch((err) => {
        log.error("Could not save the page settings:", err);
      });
  };

  // ── size ──────────────────────────────────────────────────────────────────

  const width = optionNumber({
    value: page.width,
    min: GAME_SIZE_RANGE.min,
    max: GAME_SIZE_RANGE.max,
    unit: "px",
    label: "Game width",
    onChange: (value) => commit({ width: value }),
  });

  const height = optionNumber({
    value: page.height,
    min: GAME_SIZE_RANGE.min,
    max: GAME_SIZE_RANGE.max,
    unit: "px",
    label: "Game height",
    onChange: (value) => commit({ height: value }),
  });

  const sizeRows = [
    optionRow({
      title: "Width",
      hint:
        "How wide the game is, in CSS pixels. A window narrower than this " +
        "scales the game down to fit rather than cropping it.",
      control: width.root,
    }),
    optionRow({
      title: "Height",
      hint: "How tall the game is, in CSS pixels.",
      control: height.root,
    }),
  ];

  const fixed = optionSwitch(
    page.fixed,
    (on) => {
      setSizeEnabled(on);
      commit({ fixed: on });
    },
    "Fixed size",
  );

  /**
   * The two size rows go quiet rather than away.
   *
   * A row that disappears when a switch above it is turned off is a row
   * somebody remembers seeing and cannot find again, and the numbers in it are
   * still the answer the switch will come back to.
   */
  function setSizeEnabled(on: boolean): void {
    for (const row of sizeRows) row.classList.toggle("muted", !on);
    width.input.disabled = !on;
    height.input.disabled = !on;
  }
  setSizeEnabled(page.fixed);

  // ── placement ─────────────────────────────────────────────────────────────

  const placement = optionSegmented(
    [
      { value: "center", label: "Centred" },
      { value: "start", label: "Top left" },
    ],
    page.centered ? "center" : "start",
    (value) => commit({ centered: value === "center" }),
  );

  const margin = optionNumber({
    value: page.margin,
    min: SPACING_RANGE.min,
    max: SPACING_RANGE.max,
    unit: "px",
    label: "Margin",
    onChange: (value) => commit({ margin: value }),
  });

  const radius = optionNumber({
    value: page.radius,
    min: SPACING_RANGE.min,
    max: SPACING_RANGE.max,
    unit: "px",
    label: "Corner radius",
    onChange: (value) => commit({ radius: value }),
  });

  // ── colour ────────────────────────────────────────────────────────────────

  const swatch = optionSwatch(
    page.background,
    () => openColour(),
    "Page colour",
  );

  /**
   * The colour picker, in a sheet of its own over this one.
   *
   * A panel rather than a popover because that is what this app's picker *is*
   * — a saturation field, two sliders, hex entry and a row of recents — and
   * there is no room for one at the end of a row. `onChange` is live and
   * `onCommit` is the settle: the first keeps the swatch honest while a finger
   * is moving, and the second is what reaches the disk, so dragging across the
   * field is one write rather than two hundred.
   */
  function openColour(): void {
    const inner = openSheet({
      title: "Page colour",
      subtitle: "Behind the game, where the game does not reach",
      width: 420,
    });
    const picker = createColorPicker({
      value: page.background,
      onChange: (hex) => swatch.set(hex),
      onCommit: (hex) => {
        swatch.set(hex);
        commit({ background: hex });
      },
    });
    inner.body.appendChild(picker.root);
    inner.actions.appendChild(
      h("button", { class: "btn btn-primary", text: "Done", onClick: inner.close }),
    );
  }

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Size",
        note:
          "Off, the game fills the browser window — which is what every project " +
          "has done until now. On, it is a box of the size below, and the page " +
          "around it is what the rest of this sheet is about.",
        rows: [
          optionRow({
            title: "Fixed size",
            hint:
              "A game of a set size rather than one that fills the window. The " +
              "width and height are remembered while this is off.",
            control: fixed.root,
          }),
          ...sizeRows,
        ],
      }),
      optionGroup({
        title: "Placement",
        rows: [
          optionRow({
            title: "Position",
            hint:
              "Where a fixed-size game sits on the page. Nothing to see while " +
              "the game fills the window, since there is nowhere else for it to " +
              "be.",
            control: placement.root,
          }),
          optionRow({
            title: "Margin",
            hint:
              "Clear space around the game, on every side. This is the setting " +
              "that makes the page colour visible on a game that would otherwise " +
              "reach every edge.",
            control: margin.root,
          }),
          optionRow({
            title: "Corner radius",
            hint:
              "Rounds the corners of the game itself. The canvas is clipped to " +
              "the rounded box, so what shows through at each corner is the page " +
              "colour.",
            control: radius.root,
          }),
        ],
      }),
      optionGroup({
        title: "Page",
        rows: [
          optionRow({
            title: "Page colour",
            hint:
              "The background of the HTML page, behind everything. Not the " +
              "game's own background, which is behind what your scenes draw — " +
              "this one is only ever visible where the game is not.",
            control: swatch.root,
          }),
        ],
        note:
          "These describe the page the game is embedded in. They are written " +
          "into game.config.json and read by js/main.js, which sets them on the " +
          "document for styles.css — so nothing here rewrites a line of your " +
          "own CSS, and a rule you change stays changed.",
      }),
    ]),
  );

  sheet.actions.appendChild(
    h("button", { class: "btn btn-primary", text: "Done", onClick: sheet.close }),
  );
}
