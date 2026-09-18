/**
 * **Browse Palettes**: somebody else's colours, a panel away.
 *
 * A hundred and twenty-three palettes carried over wholesale from
 * [simple-tileset-generator](https://laffan.github.io/simple-tileset-generator/) —
 * see `lib/palettes/` for what they are and where each one came from. Nothing
 * here generates anything; it is a long column of rows you take colours out
 * of.
 *
 * ## Why it is a drawer and not a sheet
 *
 * Everything else in this app that lists things to choose from is a sheet
 * over the canvas — Export Assets, Project Options, the two library editors.
 * This one cannot be, because of what it is for: you browse a palette *while
 * looking at the picker*, adding a colour and seeing where it lands in the
 * row, and a modal that covers the thing you are filling makes that two
 * gestures per colour with the answer hidden in between.
 *
 * So it slides out of the **left edge of the properties sidebar** and pushes
 * nothing: the picker stays exactly where it was, the palette row under it
 * stays visible, and a colour tapped over here appears over there without
 * anything moving. It is the one panel in the editor that exists to be used
 * beside another panel rather than instead of one.
 *
 * It is positioned against the sidebar's own rectangle rather than docked
 * into the layout row, because the sidebar is resizable and collapsible and a
 * flex sibling would change its width — see `sync`.
 */

import { h, ICONS, icon } from "../lib/dom";
import { palette } from "../lib/palette";
import { PALETTE_SOURCES } from "../lib/palettes";
import * as log from "../lib/log";

export interface PaletteBrowser {
  /** Open it, or bring it back to the sidebar after a resize. */
  open: () => void;
  close: () => void;
  toggle: () => void;
  destroy: () => void;
}

export interface PaletteBrowserOptions {
  /** The editor's main row — what the drawer is positioned inside. */
  main: HTMLElement;
  /** The properties sidebar, whose left edge the drawer opens against. */
  sidebar: HTMLElement;
}

export function createPaletteBrowser(
  options: PaletteBrowserOptions,
): PaletteBrowser {
  const { main, sidebar } = options;

  const body = h("div", { class: "palette-drawer-body scroll" });
  const root = h(
    "aside",
    {
      class: "palette-drawer",
      role: "dialog",
      "aria-label": "Browse palettes",
      hidden: "true",
    },
    h(
      "div",
      { class: "palette-drawer-head" },
      h("div", { class: "palette-drawer-title", text: "Palettes" }),
      h(
        "button",
        {
          class: "icon-btn",
          title: "Close",
          "aria-label": "Close palettes",
          onClick: () => close(),
        },
        icon(ICONS.close, 14),
      ),
    ),
    body,
  );
  main.appendChild(root);

  let built = false;
  let open_ = false;

  /**
   * Put the drawer against the sidebar's left edge.
   *
   * Read off the two rectangles rather than computed from the stored sidebar
   * width, because the width somebody dragged is only one of the things that
   * decides where that edge is: the sidebar is hidden outright in play mode
   * and in code mode, and it is `position: absolute` under 900px. The
   * rectangle is the one answer that is right in all four cases.
   */
  const sync = (): void => {
    if (!open_) return;
    const edge = sidebar.getBoundingClientRect();
    const box = main.getBoundingClientRect();
    // A collapsed sidebar has no rectangle worth measuring; the drawer then
    // sits against the right edge of the canvas, which is where the sidebar
    // would have been.
    const right = edge.width > 0 ? box.right - edge.left : 0;
    root.style.right = `${Math.max(0, right)}px`;
  };

  const build = (): void => {
    for (const source of PALETTE_SOURCES) {
      const rows = h("div", { class: "palette-rows" });
      for (const row of source.palettes) {
        rows.appendChild(paletteRow(row));
      }
      body.appendChild(
        h(
          "section",
          { class: "palette-source" },
          h("div", { class: "palette-source-name m", text: source.name }),
          rows,
          // The credit travels with the colours. These are five people's
          // collections and the link is the whole of what is owed for them.
          h(
            "a",
            {
              class: "palette-source-link m",
              href: source.url,
              target: "_blank",
              rel: "noreferrer",
              text: source.url,
            },
          ),
        ),
      );
    }
    built = true;
  };

  const open = (): void => {
    // Lazily, once. It is 123 rows of five buttons, which is six hundred
    // elements nobody has asked for until they press the button.
    if (!built) build();
    open_ = true;
    root.hidden = false;
    sync();
    window.addEventListener("resize", sync);
    document.addEventListener("keydown", onKey, true);
  };

  const close = (): void => {
    open_ = false;
    root.hidden = true;
    window.removeEventListener("resize", sync);
    document.removeEventListener("keydown", onKey, true);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };

  // The sidebar is resized by a drag and collapsed by a button, and neither
  // is an event this could listen for. A resize observer on the sidebar
  // catches both, and costs nothing while nothing is moving.
  const watcher = new ResizeObserver(() => sync());
  watcher.observe(sidebar);

  return {
    open,
    close,
    toggle: () => (open_ ? close() : open()),
    destroy: () => {
      close();
      watcher.disconnect();
      root.remove();
    },
  };
}

/**
 * One browsed palette: its colours, and the button that takes all of them.
 *
 * A tap on a colour adds that colour; **Use** adds the row. Upstream both
 * *append*, and that is the right way round — a palette you are building is
 * not replaced by the next interesting row you see, it grows by the two
 * colours out of that row you actually wanted.
 */
function paletteRow(row: readonly string[]): HTMLElement {
  const out = h("div", { class: "palette-row" });
  for (const colour of row) {
    out.appendChild(
      h("button", {
        class: "palette-color",
        type: "button",
        title: colour,
        "aria-label": `Add ${colour}`,
        style: { background: colour },
        // Only the refusals are logged. An add that worked puts a square in
        // the row two panels over, which is the feedback; a line in the
        // console per colour would make browsing a palette a wall of text.
        onClick: () => {
          if (palette.add(colour)) return;
          log.info(
            palette.has(colour)
              ? `${colour} is already in the palette`
              : `The palette is full — take a colour out to add ${colour}`,
          );
        },
      }),
    );
  }
  out.appendChild(
    h("button", {
      class: "palette-use",
      type: "button",
      text: "Use",
      title: "Add every colour in this row to the palette",
      onClick: () => {
        // A row is several colours at once, so this one *does* say what it
        // did: five taps' worth of squares appearing is harder to count than
        // to be told about, and "nothing happened" is the answer worth having.
        const added = palette.addMany(row);
        if (added === 0) {
          log.info("Nothing new in that row — every colour is already in the palette");
        } else {
          log.info(`Added ${added} colour${added === 1 ? "" : "s"} to the palette`);
        }
      },
    }),
  );
  return out;
}
