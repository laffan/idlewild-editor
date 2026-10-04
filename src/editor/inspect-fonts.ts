/**
 * The project's own fonts, in the Text section: what the font menu offers
 * above the device's, and a row to add or take them away.
 *
 * Fonts arrive two ways. Dropped on the properties sidebar (`font-drop.ts`),
 * which on an iPad means Files open beside the app; or through **Add font…**,
 * a file picker, which is the way that always works there. The picker takes
 * any file on iOS — the Files sheet greys out what an `accept` list it cannot
 * map to a type names, and a font it does not recognise would be one nobody
 * could pick — and the name is checked on the way in instead.
 */

import { h, ICONS, icon } from "../lib/dom";
import * as log from "../lib/log";
import type { MenuItem } from "../lib/menu";
import { openProject } from "../lib/print";
import {
  addFontFiles,
  onProjectFontsChange,
  projectFontChoices,
  projectFontId,
  projectFonts,
  removeProjectFont,
} from "../lib/project-fonts";
import { systemFonts } from "../lib/system-fonts";

/** Every family the menu offers: the project's first, then the device's. */
export function fontMenuItems(current: string, onPick: (font: string) => void): MenuItem[] {
  const choices = [...projectFontChoices(), ...systemFonts()];
  return choices.map((font) => ({
    label: font.name,
    font: font.id,
    current: font.id === current,
    onSelect: () => onPick(font.id),
  }));
}

/** Whether a stored family is one of the project's. */
export function isProjectFont(id: string): boolean {
  return projectFonts().some((font) => projectFontId(font.family) === id);
}

/**
 * The project's fonts as removable chips, and Add font… after them. Keeps
 * itself current while it is on the page, so a drop on the sidebar shows up
 * without the panel being rebuilt.
 */
export function projectFontsRow(): HTMLElement {
  const root = h("div", { class: "project-fonts" });
  const input = h("input", {
    type: "file",
    multiple: "true",
    style: { display: "none" },
  }) as HTMLInputElement;
  if (!isTouchApple()) input.accept = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
  input.addEventListener("change", () => {
    const id = openProject()?.id;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (id && files.length > 0) void addFontFiles(id, files);
  });

  const paint = () => {
    const chips = projectFonts().map((font) =>
      h(
        "span",
        { class: "project-font-chip", title: font.file },
        h("span", { text: font.family, style: { fontFamily: projectFontId(font.family) } }),
        h(
          "button",
          {
            class: "project-font-remove",
            "aria-label": `Remove ${font.family} from this project`,
            onClick: () => {
              const id = openProject()?.id;
              if (id) void removeProjectFont(id, font);
            },
          },
          icon(ICONS.close, 11),
        ),
      ),
    );
    root.replaceChildren(
      ...chips,
      h("button", {
        class: "panel-btn project-fonts-add",
        text: "Add font…",
        title:
          "Keep a font file in this project — TTF, OTF, WOFF or WOFF2. You can " +
          "also drop font files anywhere on this sidebar.",
        onClick: () => input.click(),
      }),
      input,
    );
  };
  paint();
  const stop = onProjectFontsChange(() => {
    if (!root.isConnected) return stop();
    paint();
  });
  return root;
}

/** iPadOS and iOS, where an `accept` list of extensions greys fonts out. */
function isTouchApple(): boolean {
  try {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch {
    log.info("Could not tell the platform; offering every file");
    return true;
  }
}
