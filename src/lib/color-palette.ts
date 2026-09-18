/**
 * The palette row under the picker, and the two buttons under that.
 *
 * Split out of `color-picker.ts` rather than written into it because the two
 * rows above it — the field and the recents — are *the colour*, and this is
 * a list somebody keeps. The picker hands it the colour in hand and a way to
 * put one back, and otherwise the two know nothing about each other.
 *
 * ## The one button that changes its mind
 *
 * A palette needs a way in and a way out, and the way out is the problem on a
 * touch screen: a per-swatch delete is a long-press on a 26-pixel target, and
 * a Remove button under the row needs a *selected* swatch, which is a second
 * kind of selection in a panel that already has one.
 *
 * So there is one button at the head of the row and it is about the colour in
 * hand: a `+` while that colour is not in the palette, a `−` while it is.
 * Taking a colour out is therefore "pick it, then press the button that is
 * already there", which is two taps and no new idea. It also means the button
 * always says something true about what you are looking at, which a plain `+`
 * pressed twice does not.
 */

import { h, ICONS, icon } from "./dom";
import { isValidHex, normaliseHex } from "./color";
import {
  hasPaletteBrowser,
  isPaletteBrowserOpen,
  onPaletteChange,
  palette,
  togglePaletteBrowser,
} from "./palette";

export interface PaletteRowOptions {
  /** The colour the picker is showing, read afresh on every repaint. */
  current: () => string;
  /** A swatch was tapped. The picker moves to it, as it does for a recent. */
  onPick: (hex: string) => void;
}

export interface PaletteRow {
  root: HTMLElement;
  /** Repaint after the picker's own colour changed. */
  sync: () => void;
  destroy: () => void;
}

export function createPaletteRow(options: PaletteRowOptions): PaletteRow {
  const row = h("div", { class: "cp-palette" });
  const lead = h("button", {
    class: "cp-palette-add",
    type: "button",
  }) as HTMLButtonElement;

  // `lib-row-buttons` and `lib-toggle` rather than anything of this control's
  // own: they are what the pattern and shape libraries' buttons directly above
  // this already are, and they carry the panel's ink. A bare `.btn` in a
  // sidebar is the home screen's dark text on the sidebar's dark ground.
  const browse = h("button", {
    class: "btn btn-ghost",
    type: "button",
    title: "Palettes collected from five places on the web",
    onClick: () => togglePaletteBrowser(),
  });
  const browseRow = h("div", { class: "lib-row-buttons" }, browse);
  if (!hasPaletteBrowser()) browseRow.hidden = true;

  /**
   * Its own line, and a toggle rather than a button.
   *
   * It is not an action beside Browse Palettes — it does nothing when pressed
   * and everything the next time a PSD leaves — so a row of two made it look
   * like the other half of a pair of verbs. `lib-toggle` is the switch the
   * Pattern brush's **Invert** already uses: full width, and filled with the
   * accent while it is on, which is how the rest of this sidebar says a
   * setting is on.
   */
  const attach = h("button", {
    class: "lib-toggle",
    type: "button",
    text: "Attach palette to PSDs",
    title:
      "Write the palette into a PSD as its topmost layer whenever one goes " +
      "out to another app, so the colours are there to sample",
    onClick: () => {
      palette.attach = !palette.attach;
    },
  });

  const root = h("div", { class: "cp-palette-box" }, row, browseRow, attach);

  lead.addEventListener("click", () => {
    const hex = options.current();
    if (palette.has(hex)) palette.remove(hex);
    else palette.add(hex);
  });

  const render = (): void => {
    const hex = isValidHex(options.current())
      ? normaliseHex(options.current())
      : null;
    const held = hex !== null && palette.has(hex);

    lead.replaceChildren(icon(held ? ICONS.minus : ICONS.plus, 13));
    lead.title = held
      ? `Take ${hex} out of the palette`
      : "Add the current colour to the palette";
    lead.setAttribute("aria-label", lead.title);
    // A colour nobody could see is a colour there is no point keeping, and
    // the picker starts every session able to produce one.
    lead.disabled = hex === null;

    // Rebuilt from the head each time rather than diffed: a palette is a few
    // dozen squares at the very most, and the alternative is two lists to
    // keep in step for a row that is redrawn when a button is pressed.
    row.replaceChildren(lead);
    for (const colour of palette.list()) {
      const swatch = h("button", {
        class: "cp-swatch",
        type: "button",
        title: colour,
        "aria-label": colour,
        "aria-pressed": String(colour === hex),
        onClick: () => options.onPick(colour),
      });
      swatch.appendChild(
        h("span", { class: "cp-swatch-ink", style: { background: colour } }),
      );
      row.appendChild(swatch);
    }

    // The button says which way it goes rather than what it is about. A
    // toggle whose label never moves leaves the panel with two ways of being
    // shut — the drawer gone, and the button still inviting you to open it.
    const open = isPaletteBrowserOpen();
    browse.textContent = open ? "Close Palettes" : "Browse Palettes";
    browse.setAttribute("aria-expanded", String(open));

    attach.setAttribute("aria-pressed", String(palette.attach));
    // On, with nothing to attach. The toggle is telling the truth about
    // itself and the row above it is telling the truth about the palette;
    // this is the one saying the two do not add up to anything yet.
    attach.classList.toggle("empty", palette.attach && palette.list().length === 0);
  };

  // App-wide, so a colour added from the fill panel's copy of this control has
  // to reach the brush panel's. It unsubscribes itself once its element has
  // left the page, for the reason `paint-picker.ts` gives at greater length:
  // the inspector rebuilds its whole panel on every selection change.
  const unlisten = onPaletteChange(() => {
    if (!root.isConnected) {
      unlisten();
      return;
    }
    render();
  });

  render();

  return { root, sync: render, destroy: unlisten };
}
