/**
 * The New Game sheet: pick a template, a style and a grid scale, name the
 * project.
 *
 * Two axes, because they answer different questions. The *template* is the
 * shape of the space you build in — diamonds, squares, or nothing at all.
 * The *style* is the game that comes out of it: a character that walks the
 * grid, or one that runs and jumps along it. Both are codebase selections:
 * each combination scaffolds a real runnable Phaser 4 project into `game/` —
 * see src-tauri/templates/.
 *
 * The one combination that is not offered is an isometric platformer. A
 * platformer is a side-on view of a plane with gravity pulling down it, and
 * an isometric projection is a view of the ground from above; there is no
 * scaffold that could honestly be written for the pair, so picking Isometric
 * puts the style back to Top Down and takes Platformer away rather than
 * generating something that does not work.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import type { Genre, Projection } from "../lib/types";

const SCALES = [32, 64, 128, 256];

export interface NewGameChoice {
  name: string;
  projection: Projection;
  genre: Genre;
  gridSize: number;
}

export function openNewGame(
  onCreate: (choice: NewGameChoice) => void,
): void {
  let projection: Projection = "isometric";
  let genre: Genre = "topdown";
  let gridSize = 64;

  const sheet = openSheet({
    title: "New Game",
    subtitle: "Template, style and grid scale",
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
      SCALES.map((s) => ({ value: String(s), label: `${s} px` })),
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

  sheet.body.append(
    field("Name", nameInput),
    field("Template", templateSeg.root),
    field("Style", styleSeg.root),
    scaleField,
  );

  const create = () => {
    const name = nameInput.value.trim() || "Untitled";
    sheet.close();
    onCreate({ name, projection, genre, gridSize });
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
    : "The size of one space";
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "field" },
    h("span", { class: "field-label m", text: label }),
    control,
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
