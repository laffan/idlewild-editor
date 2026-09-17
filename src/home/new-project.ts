/**
 * The New Project sheet: pick a template, a style, a grid scale and how the
 * project renders, then name it.
 *
 * It was **New Game**, and the name was a claim the sheet does not make. What
 * comes out of it is a project — a grid, a pile of PSDs and a `game/` tree —
 * and plenty of them are a tileset, a background or a set of sprites for
 * somewhere else, which is the whole reason Export Assets exists. The button on
 * the home screen says *New Project* and so does this.
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
 *
 * ## Why it is drawn in the settings vocabulary
 *
 * This used to be a stack of `.field`s — label, control, and a grey line of
 * explanation under each — which is the design system's form shape and is the
 * wrong shape for this. A form is a thing you fill in; this is a list of
 * questions with an answer already chosen for every one of them, which is a
 * settings page, and the app has had a settings vocabulary since Publish
 * needed one. So it is `options.css` and `options-list.ts` here, the same
 * rows the Logins sheet is built from — see the top of `styles/options.css`
 * for what that system departs from and why.
 *
 * Two things follow from the change.
 *
 * **The explanations are behind a `?`.** Six rows each carrying two lines is
 * six paragraphs of grey to read past before you find the one control you came
 * to change, and the answer to every question is already right for most
 * projects. None of it is thrown away: every sentence that was a `field-hint`
 * is on the hint beside its row's title, and the hint opens to a tap as well
 * as to a hover, because an iPad has no pointer to rest on anything — see
 * `lib/tooltip.ts`.
 *
 * **There is no title.** The sheet is opened by a button that says *New
 * Project* and nothing else on the screen opens it, so a 22px heading saying
 * the same word spends the best line on the one thing nobody needed telling.
 * The dialog still carries the name for anything reading the page.
 */

import { openSheet } from "../lib/sheet";
import { h } from "../lib/dom";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import {
  optionSegmented,
  optionSwitch,
  optionText,
} from "../lib/options-controls";
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

export interface NewProjectChoice {
  name: string;
  projection: Projection;
  genre: Genre;
  gridSize: number;
  options: GameOptions;
}

export function openNewProject(
  onCreate: (choice: NewProjectChoice) => void,
): void {
  let projection: Projection = "isometric";
  let genre: Genre = "topdown";
  let gridSize = 64;
  let name = "";
  const options: GameOptions = { ...DEFAULT_OPTIONS };

  const sheet = openSheet({
    title: "New Project",
    titled: false,
    light: true,
    width: 620,
  });

  const nameInput = optionText(name, (value) => (name = value), {
    placeholder: "Untitled",
    label: "Project name",
  });

  const styleSeg = optionSegmented(
    [
      { value: "topdown", label: "Top Down" },
      { value: "platformer", label: "Platformer" },
    ],
    genre,
    (value) => (genre = value as Genre),
  );

  const templateSeg = optionSegmented(
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
    },
  );

  const scaleSeg = optionSegmented(
    SCALES.map((scale) => ({ value: String(scale), label: String(scale) })),
    String(gridSize),
    (value) => (gridSize = Number(value)),
  );

  const zoomSeg = optionSegmented(
    ZOOMS.map((zoom) => ({ value: String(zoom), label: `${zoom}×` })),
    String(options.defaultZoom),
    (value) => (options.defaultZoom = Number(value)),
  );

  // Pixel perfect is the pair of settings that go together: nearest-neighbour
  // textures, and drawing on whole pixels. One switch, because a project that
  // wants one and not the other is a project that wants Project Options, where
  // they are two.
  const pixelPerfect = optionSwitch(
    options.pixelArt,
    (on) => {
      options.pixelArt = on;
      options.roundPixels = on;
    },
    "Pixel perfect",
  );

  const character = optionSwitch(
    options.character,
    (on) => (options.character = on),
    "Character controller",
  );

  sheet.body.appendChild(
    optionsPage(
      [
        optionGroup({
          rows: [
            optionRow({
              title: "Name",
              hint:
                "What the project is called on the home screen, and the name an " +
                "export takes. It can be renamed at any time — long-press its card.",
              control: nameInput,
            }),
          ],
        }),
        optionGroup({
          title: "Template",
          rows: [
            optionRow({
              title: "Template",
              hint:
                "The shape of the space you build in. Isometric is a diamond " +
                "lattice, Orthogonal a square one, and Blank has no lattice at " +
                "all — nothing snaps, and a selection is the exact rectangle you " +
                "dragged. This is a fact about the project afterwards: the " +
                "document is addressed in it and the scaffold is written for it.",
              control: templateSeg.root,
            }),
            optionRow({
              title: "Style",
              hint:
                "The game that comes out of it. Top Down walks the grid; " +
                "Platformer runs and jumps along it under gravity. Not offered " +
                "with Isometric, because gravity has no direction on a diamond " +
                "grid seen from above.",
              control: styleSeg.root,
            }),
            optionRow({
              title: "Grid scale",
              hint: () => scaleNote(projection),
              control: scaleSeg.root,
            }),
          ],
        }),
        optionGroup({
          title: "Rendering",
          rows: [
            optionRow({
              title: "Default zoom",
              hint:
                "What a scene opens at, here and in the game — 8px art usually " +
                "wants 3× or 4×.",
              control: zoomSeg.root,
            }),
            optionRow({
              title: "Pixel perfect",
              hint:
                "Nearest-neighbour textures and whole-pixel drawing. Both can be " +
                "toggled separately later, in Project Options.",
              control: pixelPerfect.root,
            }),
            optionRow({
              title: "Character controller",
              hint:
                "A prefab that walks the grid, or runs and jumps along it, and " +
                "the line in the scene that puts it down. Off, the project places " +
                "the document and nothing moves.",
              control: character.root,
            }),
          ],
        }),
      ],
      true,
    ),
  );

  const create = () => {
    sheet.close();
    onCreate({
      name: name.trim() || "Untitled",
      projection,
      genre,
      gridSize,
      options: { ...options },
    });
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
    ? "Nothing snaps on a blank canvas, so this is not the size of anything you " +
        "will see. It is still the project's unit: how big the character is, and " +
        "how coarse the lattice play mode walks."
    : "The size of one space, in pixels.";
}
