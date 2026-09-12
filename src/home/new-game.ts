/**
 * The New Game sheet: pick a template, a style, a grid scale and how the
 * project renders, then name it.
 *
 * Two axes decide the program. The *template* is the shape of the space you
 * build in — diamonds, squares, or nothing at all. The *style* is the game that
 * comes out of it: a character that walks the grid, or one that runs and jumps
 * along it. Both are codebase selections: each combination scaffolds a real
 * runnable Phaser 4 project into `game/` — see src-tauri/templates/.
 *
 * The one combination that is not offered is an isometric platformer. A
 * platformer is a side-on view of a plane with gravity pulling down it, and
 * an isometric projection is a view of the ground from above; there is no
 * scaffold that could honestly be written for the pair, so picking Isometric
 * puts the style back to Top Down and takes Platformer away rather than
 * generating something that does not work.
 *
 * Everything under Rendering is a `GameOptions`, and all of it but the
 * character controller can be changed later in Project Options. The character
 * cannot: it is lines in a file, and the file becomes the project's own the
 * moment it is written.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { DEFAULT_OPTIONS, type GameOptions, type Genre, type Projection } from "../lib/types";

/**
 * The grid scales offered.
 *
 * 8 and 16 are here for pixel art, where a space is a sprite rather than a
 * room: the two settings go together often enough that the sheet puts them on
 * the same screen.
 */
const SCALES = [8, 16, 32, 64, 128, 256];

/** What the zoom control offers, and what a pixel-art project usually wants. */
const ZOOMS = [1, 2, 3, 4];

export interface NewGameChoice {
  name: string;
  projection: Projection;
  genre: Genre;
  gridSize: number;
  options: GameOptions;
}

export function openNewGame(
  onCreate: (choice: NewGameChoice) => void,
): void {
  let projection: Projection = "isometric";
  let genre: Genre = "topdown";
  let gridSize = 64;
  const options: GameOptions = { ...DEFAULT_OPTIONS };

  const sheet = openSheet({
    title: "New Game",
    subtitle: "Template, style, grid scale and rendering",
    light: true,
    width: 620,
  });

  const nameInput = h("input", {
    class: "input",
    placeholder: "Untitled",
    maxlength: "60",
  });

  const styleSeg = segmented(
    [
      { value: "topdown", label: "Top Down" },
      { value: "platformer", label: "Platformer" },
    ],
    genre,
    (value) => {
      genre = value as Genre;
    },
  );

  const scaleField = field(
    "Grid scale",
    segmented(
      SCALES.map((s) => ({ value: String(s), label: `${s}` })),
      String(gridSize),
      (value) => {
        gridSize = Number(value);
      },
    ).root,
  );

  const templateSeg = segmented(
    [
      { value: "isometric", label: "Isometric" },
      { value: "orthogonal", label: "Orthogonal" },
      { value: "blank", label: "Blank" },
    ],
    projection,
    (value) => {
      projection = value as Projection;
      // Gravity has no direction on a diamond grid seen from above.
      styleSeg.setEnabled("platformer", projection !== "isometric");
      if (projection === "isometric" && genre === "platformer") {
        genre = "topdown";
        styleSeg.select("topdown");
      }
      scaleHint.textContent = scaleNote(projection);
    },
  );

  const scaleHint = h("div", {
    class: "field-hint",
    text: scaleNote(projection),
  });
  scaleField.appendChild(scaleHint);

  // Pixel perfect is the pair of settings that go together: nearest-neighbour
  // textures, and drawing on whole pixels. One box, because a project that
  // wants one and not the other is a project that wants Project Options, where
  // they are two.
  const pixelPerfect = check(
    "Pixel perfect",
    "Nearest-neighbour textures and whole-pixel drawing. Both can be toggled " +
      "separately later, in Project Options",
    options.pixelArt,
    (on) => {
      options.pixelArt = on;
      options.roundPixels = on;
    },
  );

  const zoomField = field(
    "Default zoom",
    segmented(
      ZOOMS.map((z) => ({ value: String(z), label: `${z}×` })),
      String(options.defaultZoom),
      (value) => {
        options.defaultZoom = Number(value);
      },
    ).root,
  );
  zoomField.appendChild(
    h("div", {
      class: "field-hint",
      text: "What a scene opens at, here and in the game — 8px art usually wants 3× or 4×",
    }),
  );

  const character = check(
    "Character controller",
    "A prefab that walks the grid, or runs and jumps along it, and the line " +
      "in the scene that puts it down. Unticked, the project places the " +
      "document and nothing moves",
    options.character,
    (on) => {
      options.character = on;
    },
  );

  sheet.body.append(
    field("Name", nameInput),
    field("Template", templateSeg.root),
    field("Style", styleSeg.root),
    scaleField,
    zoomField,
    pixelPerfect,
    character,
  );

  const create = () => {
    const name = nameInput.value.trim() || "Untitled";
    sheet.close();
    onCreate({ name, projection, genre, gridSize, options: { ...options } });
  };

  nameInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") create();
  });

  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Create Game", onClick: create }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  nameInput.focus();
}

/**
 * What the grid scale means under each template. It is the size of a space on
 * the two that have spaces; on Blank nothing snaps to it, but it is still the
 * project's unit — how big the character is, and how coarse the lattice play
 * mode walks.
 */
function scaleNote(projection: Projection): string {
  return projection === "blank"
    ? "Nothing snaps on a blank canvas — this is the unit the character and its movement are measured in"
    : "The size of one space, in pixels";
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "field" },
    h("span", { class: "field-label m", text: label }),
    control,
  );
}

/**
 * A labelled checkbox with a line under it saying what it does.
 *
 * The hint is not decoration: every one of these changes what lands on disk,
 * and the sheet is the only place it is explained.
 */
function check(
  label: string,
  hint: string,
  initial: boolean,
  onChange: (on: boolean) => void,
): HTMLElement {
  const box = h("input", { type: "checkbox", class: "check-box" }) as HTMLInputElement;
  box.checked = initial;
  box.addEventListener("change", () => onChange(box.checked));

  return h(
    "div",
    { class: "field" },
    h(
      "label",
      { class: "check" },
      box,
      h("span", { class: "check-label", text: label }),
    ),
    h("div", { class: "field-hint", text: hint }),
  );
}

interface Segmented {
  root: HTMLElement;
  /** Choose an option from outside, without firing `onPick`. */
  select: (value: string) => void;
  /** Grey an option out, and move off it if it was the one chosen. */
  setEnabled: (value: string, enabled: boolean) => void;
}

function segmented(
  options: Array<{ value: string; label: string }>,
  initial: string,
  onPick: (value: string) => void,
): Segmented {
  const buttons = new Map<string, HTMLButtonElement>();
  const wrap = h("div", { class: "seg" });

  for (const option of options) {
    const button = h("button", {
      class: "seg-opt",
      type: "button",
      text: option.label,
      "aria-pressed": String(option.value === initial),
      onClick: () => {
        for (const b of buttons.values()) b.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-pressed", "true");
        onPick(option.value);
      },
    });
    buttons.set(option.value, button);
    wrap.appendChild(button);
  }

  return {
    root: wrap,
    select: (value) => {
      for (const [key, button] of buttons) {
        button.setAttribute("aria-pressed", String(key === value));
      }
    },
    setEnabled: (value, enabled) => {
      const button = buttons.get(value);
      if (!button) return;
      button.disabled = !enabled;
    },
  };
}
