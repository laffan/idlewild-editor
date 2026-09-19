/**
 * The New Project sheet: pick a template and a grid scale, pick how much
 * scaffold you want, say how the project renders, then name it.
 *
 * It was **New Game**, and the name was a claim the sheet does not make. What
 * comes out of it is a project — a grid, a pile of PSDs and a `game/` tree —
 * and plenty of them are a tileset, a background or a set of sprites for
 * somewhere else, which is the whole reason Export Assets exists. The button on
 * the home screen says *New Project* and so does this.
 *
 * ## Two axes, and they stopped being the same kind of question
 *
 * The *template* is the shape of the space you build in — diamonds, squares,
 * or nothing at all. It is the one choice the editor itself reads: the document
 * is addressed in it, a selection snaps to it or does not, and the grid scale
 * under it is what a space measures. So Template and Grid scale are one group,
 * in that order, because the second is a number about the first and reads as
 * nonsense on its own.
 *
 * The *scaffolding* is the program on the other side. It used to be called
 * Style and it used to have two answers, both of them whole games, and that
 * made every project a commitment to one: you drew a room and the only thing
 * to do with the room was the character the sheet had already written for you.
 * Two more answers sit beside them now and neither is a style —
 *
 * - **Top Down** and **Platformer** are those whole games, unchanged.
 * - **Blank PSD to Phaser** is the wiring and nothing above it: a Phaser 4
 *   project with psd-to-phaser registered, every PSD loaded and the document
 *   placed, and no character, no pathfinder and no physics.
 * - **Vanilla** is not a Phaser project at all — an `index.html`, a
 *   `style.css` and a `script.js` beside the exported `assets/`.
 *
 * **Nothing here changes what drawing is like.** All four get the same canvas,
 * the same tools, the same selection and the same PSD pipeline; what a project
 * gives up by scaffolding less is code it would have had to read past, not
 * anything on the screen it is drawn on. That distance is the point of the two
 * new answers.
 *
 * The one combination that is not offered is an isometric platformer. A
 * platformer is a side-on view of a plane with gravity pulling down it, and
 * an isometric projection is a view of the ground from above; there is no
 * scaffold that could honestly be written for the pair, so picking Isometric
 * puts the scaffolding back to Top Down and takes Platformer away rather than
 * generating something that does not work. The two that scaffold no character
 * have nothing to fall, so they pair with any template.
 *
 * Everything under Rendering is a `GameOptions`, and all of it can be changed
 * later in Project Options. **Character controller is the row that comes and
 * goes**: on the two scaffolds with no `js/shared/character.js` in them there
 * is nothing for the switch to reach, so it is not offered rather than offered
 * and ignored. Default zoom and Pixel perfect stay for all four, because both
 * of them are the *editor's* canvas as well as the game's.
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
import {
  DEFAULT_OPTIONS,
  hasCharacter,
  SCAFFOLDS,
  type GameOptions,
  type Projection,
  type Scaffold,
} from "../lib/types";

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
  scaffold: Scaffold;
  gridSize: number;
  options: GameOptions;
}

export function openNewProject(
  onCreate: (choice: NewProjectChoice) => void,
): void {
  let projection: Projection = "isometric";
  let scaffold: Scaffold = "topdown";
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

  const scaffoldSeg = optionSegmented(
    SCAFFOLDS.map((row) => ({ value: row.value, label: row.label })),
    scaffold,
    (value) => {
      scaffold = value as Scaffold;
      setCharacterOffered();
    },
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
      // Gravity has no direction on a diamond grid seen from above. The other
      // three scaffold no character, so nothing about them falls.
      scaffoldSeg.setEnabled("platformer", projection !== "isometric");
      if (projection === "isometric" && scaffold === "platformer") {
        scaffold = "topdown";
        scaffoldSeg.select("topdown");
        setCharacterOffered();
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

  // Kept beside `options.character` rather than read back off it, so that
  // switching from Top Down to Blank PSD to Phaser and back does not silently
  // re-tick a box somebody deliberately cleared.
  let wantsCharacter = options.character;

  const character = optionSwitch(
    options.character,
    (on) => {
      wantsCharacter = on;
      options.character = on;
    },
    "Character controller",
  );

  const characterRow = optionRow({
    title: "Character controller",
    hint:
      "A prefab that walks the grid, or runs and jumps along it, and " +
      "the line in the scene that puts it down. Off, the project places " +
      "the document and nothing moves.",
    control: character.root,
  });

  /**
   * Take the character row away on the scaffolds that have no character.
   *
   * Removed rather than greyed, which is the opposite of what Page Setup's
   * size rows do and is right for the opposite reason: those are a setting the
   * switch above them will come back to, so keeping them visible keeps the
   * number you typed. This one has nothing to come back to — Blank PSD to
   * Phaser and Vanilla write no `js/shared/character.js` at all — so a greyed
   * row would be a promise the scaffold cannot keep. The stored value goes to
   * `false` with it, and Rust clamps it again on the way in.
   */
  function setCharacterOffered(): void {
    const offered = hasCharacter(scaffold);
    characterRow.hidden = !offered;
    options.character = offered && wantsCharacter;
    character.set(options.character);
  }
  setCharacterOffered();

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
        // The template and the scale it is measured in. One group, in that
        // order, because the number means nothing without the shape above it.
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
                "document is addressed in it.",
              control: templateSeg.root,
            }),
            optionRow({
              title: "Grid scale",
              hint: () => scaleNote(projection),
              control: scaleSeg.root,
            }),
          ],
        }),
        // And the program the drawing is handed to, which is a separate
        // question from the space it was drawn in.
        optionGroup({
          title: "Scaffolding",
          rows: [
            optionRow({
              title: "Scaffolding",
              hint: () => scaffoldNote(scaffold),
              control: scaffoldSeg.root,
            }),
          ],
          note:
            "How much of a project is written for you. Drawing is the same " +
            "whichever you pick — this is the code the artwork is handed to, " +
            "and it is yours to edit or delete from the moment it is written.",
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
            characterRow,
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
      scaffold,
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

/**
 * What each scaffold writes, said in the one sentence the `?` has room for.
 *
 * Per-answer rather than one paragraph covering four, because the question a
 * hint is opened to settle is *this* one — and a hint that lists everything
 * makes you find your own answer inside it. The group's note carries the half
 * that is true of all four.
 */
function scaffoldNote(scaffold: Scaffold): string {
  switch (scaffold) {
    case "platformer":
      return (
        "A whole game, seen from the side: gravity, ground and a jump. It " +
        "reads the same document a top-down project does, taking every " +
        "non-walkable fill and blocking boundary as the ground it stands on " +
        "rather than as something to route around. Not offered with " +
        "Isometric, because gravity has no direction on a diamond grid seen " +
        "from above."
      );
    case "p2p":
      return (
        "A Phaser 4 project with psd-to-phaser wired up: every PSD loaded and " +
        "the document placed, and nothing above that. No character, no " +
        "pathfinder, no physics — what you drew, on screen, waiting for a " +
        "program. Page Setup still applies."
      );
    case "vanilla":
      return (
        "No Phaser at all: an index.html, a style.css and a script.js beside " +
        "the exported assets, and the document as data in game.config.json. " +
        "Nothing is wired up, because the point of it is that nothing is — " +
        "which is also why Page Setup, being about the page the scaffold " +
        "builds, is not offered on one."
      );
    default:
      return (
        "A whole game, seen from above: a character that walks the grid over " +
        "A*, with the camera following it. The prefab it spawns is yours from " +
        "the moment the project is made."
      );
  }
}
