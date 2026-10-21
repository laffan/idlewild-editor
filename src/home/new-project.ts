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
 * made every project a commitment to one. It is four categories now, in order
 * of progressive simplicity, and only the first asks a second question —
 *
 * - **Game**: **Top Down** or **Platformer**, those whole games, unchanged.
 * - **PSD to Phaser**: psd-to-phaser wired up, every PSD loaded, and each
 *   scene placing its artwork with `this.P2P.place` in its own `create`. No
 *   character, no pathfinder, no physics, and none of the editor's own code.
 * - **Phaser**: a Phaser game running, and nothing loaded into it.
 * - **Vanilla**: not a Phaser project at all — an `index.html`, a `style.css`
 *   and a `script.js` beside the exported `assets/`.
 *
 * **Nothing here changes what drawing is like.** All of them get the same
 * canvas, the same tools, the same selection and the same PSD pipeline; what a
 * project gives up by scaffolding less is code it would have had to read past,
 * not anything on the screen it is drawn on. And the choice can be changed
 * later, in Project Options — see `scaffold-switch.ts`.
 *
 * The one combination that is not offered is an isometric platformer. A
 * platformer is a side-on view of a plane with gravity pulling down it, and
 * an isometric projection is a view of the ground from above; there is no
 * scaffold that could honestly be written for the pair, so picking Isometric
 * puts the scaffolding back to Top Down and takes Platformer away rather than
 * generating something that does not work. The scaffolds with no character
 * have nothing to fall, so they pair with any template.
 *
 * Everything under Rendering is a `GameOptions`, and all of it can be changed
 * later in Project Options. **Character controller is the row that comes and
 * goes**: only a Game has a `js/shared/character.js` for the switch to reach,
 * so elsewhere it is not offered rather than offered and ignored. Default zoom and Pixel perfect stay for all four, because both
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
 * Scaffolding's is on the **group's heading** rather than on a row, because
 * its first row has no title: a label inside saying the same word as the
 * heading above it would spend half the row repeating it, and four categories
 * want the width. So the heading is the label, and the `?` goes where the
 * question is being asked.
 *
 * **There is no title.** The sheet is opened by a button that says *New
 * Project* and nothing else on the screen opens it, so a 22px heading saying
 * the same word spends the best line on the one thing nobody needed telling.
 * The dialog still carries the name for anything reading the page.
 *
 * ## Output, after the name
 *
 * The question after the name is what the project is *for*, because it
 * decides which of the others are asked. **Web** is everything below as it has always been:
 * a game, played and published (`code` on disk — both kinds are code, and the
 * sheet names the one that is different by where it ends up). **Print** points
 * the same canvas and the same code at a sheet of paper: the page is a fixed
 * rectangle of world, one world pixel to the point, and `ExportForPrint()` in
 * the project's own code is the moment it is written out. Print asks for the
 * **resolution**, because every PSD the project writes is written at it — 150,
 * 300 or 600 DPI, fixed once the project exists, like the template — and for its
 * **Dimensions**: a standard sheet and its orientation, or Custom, a width and
 * a height in inches or centimetres. Page Setup can change those later.
 *
 * Under Print the **Scaffolding** and **Rendering** groups go away. A print
 * project is always PSD to Phaser: `ExportForPrint()` reads the page off a
 * running Phaser scene with the PSDs placed in it, so neither Phaser nor
 * Vanilla can print, and a character or gravity is a game's. A page is looked at one point to the pixel, so it has no
 * default zoom. What Export writes — PDF, PSD or both — is asked where the
 * files are made, in the Export bar.
 */

import { gridPreview } from "./grid-preview";
import { openSheet } from "../lib/sheet";
import { dimensionRows } from "../lib/print-dimensions";
import { imageSize } from "../lib/image-size";
import { clipboardImage } from "../editor/clipboard";
import { h } from "../lib/dom";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import { scaffoldPicker } from "../lib/scaffold-picker";
import {
  optionSegmented,
  optionSwitch,
  optionText,
} from "../lib/options-controls";
import {
  DEFAULT_OUTPUT,
  DPIS,
  type Output,
  type OutputKind,
} from "../lib/print";
import {
  DEFAULT_OPTIONS,
  hasCharacter,
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
  output: Output;
}

export function openNewProject(
  onCreate: (choice: NewProjectChoice) => void,
): void {
  let projection: Projection = "isometric";
  let scaffold: Scaffold = "topdown";
  let gridSize = 64;
  let name = "";
  const options: GameOptions = { ...DEFAULT_OPTIONS };
  const output: Output = { ...DEFAULT_OUTPUT };

  const sheet = openSheet({
    title: "New Project",
    titled: false,
    width: 620,
  });

  const nameInput = optionText(name, (value) => (name = value), {
    placeholder: "Untitled",
    label: "Project name",
  });

  const scaffoldPick = scaffoldPicker(scaffold, (value) => {
    scaffold = value;
    setCharacterOffered();
  });

  // ── output ────────────────────────────────────────────────────────────────

  const dpiSeg = optionSegmented(
    DPIS.map((dpi) => ({ value: String(dpi), label: `${dpi} DPI` })),
    String(output.dpi),
    (value) => (output.dpi = Number(value)),
  );
  const dpiRow = optionRow({
    title: "Resolution",
    hint:
      "How many pixels to the inch every PSD in the project is written at. " +
      "The canvas and your code work with a lighter copy of each file; the " +
      "PDF is drawn from these. Fixed once the project exists, because a file " +
      "made at 300 has no 600's worth of pixels to give.",
    control: dpiSeg.root,
  });
  // The sheet: a standard size and its orientation, or Custom in inches or
  // centimetres — the same rows Page Setup shows. See `lib/print-dimensions`.
  // Under Custom, Clipboard sizes the page to the image on the clipboard at
  // the DPI picked above.
  const dimensions = dimensionRows(output, (patch) => Object.assign(output, patch), {
    dpi: () => output.dpi,
    read: async () => imageSize(await clipboardImage()),
  });
  const outputSeg = optionSegmented(
    [
      // "Web" on the sheet, `code` on disk: both kinds of project are code,
      // and what tells them apart is where the work ends up.
      { value: "code", label: "Web" },
      { value: "print", label: "Print" },
    ],
    output.kind,
    (value) => {
      output.kind = value as OutputKind;
      setOutputShown();
    },
  );

  /**
   * Show the print rows under Print, and take away the two groups a print
   * project does not ask.
   *
   * **A print project is always PSD to Phaser.** `ExportForPrint()` reads
   * the page off a running Phaser scene with the PSDs placed in it, so Phaser
   * and Vanilla cannot print, and a character walking a page or a
   * platformer's gravity is a game rather than a page. What is left is the artwork placed and the code you write over it,
   * which is the whole of a print project. **Rendering goes too**: a page is
   * looked at one point to the pixel, so it has no default zoom, and pixel
   * snapping and a character controller are a game's questions.
   *
   * What was picked under Web is kept, so going to Print and back loses
   * nothing.
   */
  function setOutputShown(): void {
    const print = output.kind === "print";
    dpiRow.hidden = !print;
    dimensions.setShown(print);
    // The class rather than the attribute: a group is laid out with its own
    // `display`, which outranks `hidden`.
    createButton.textContent = print ? "Create Page" : "Create Game";
    scaffoldGroup.classList.toggle("hidden", print);
    renderingGroup.classList.toggle("hidden", print);
    redrawPreview();
    if (print && !webChoice) {
      webChoice = { scaffold, options: { ...options } };
      scaffold = "p2p";
      Object.assign(options, DEFAULT_OPTIONS, { character: false });
    } else if (!print && webChoice) {
      scaffold = webChoice.scaffold;
      Object.assign(options, webChoice.options);
      webChoice = null;
    }
  }
  let webChoice: { scaffold: Scaffold; options: GameOptions } | null = null;

  const templateSeg = optionSegmented(
    [
      { value: "isometric", label: "Isometric" },
      { value: "orthogonal", label: "Orthogonal" },
      { value: "blank", label: "Blank" },
    ],
    projection,
    (value) => {
      projection = value as Projection;
      redrawPreview();
      setPlatformerOffered();
      if (projection === "isometric" && scaffold === "platformer") {
        scaffold = "topdown";
        scaffoldPick.set("topdown");
        setCharacterOffered();
      }
    },
  );

  /**
   * Grey Platformer out under Isometric. Gravity has no direction on a
   * diamond grid seen from above, and the other scaffolds have nothing that
   * falls, so they pair with any template.
   *
   * Called **now as well as on every change**, which it was not: the sheet
   * opens on Isometric, and until something else was picked and put back the
   * one combination `create_project` refuses was the one combination the sheet
   * let you choose first. Greyed rather than gone, because greyed says "not
   * with that" where gone says "never existed".
   */
  function setPlatformerOffered(): void {
    scaffoldPick.setPlatformerEnabled(projection !== "isometric");
  }
  setPlatformerOffered();

  const scaleSeg = optionSegmented(
    SCALES.map((scale) => ({ value: String(scale), label: String(scale) })),
    String(gridSize),
    (value) => {
      gridSize = Number(value);
      redrawPreview();
    },
  );

  // What the canvas will look like: the lattice this template and scale make,
  // at the zoom the project opens at — see `grid-preview.ts`.
  const preview = gridPreview();
  function redrawPreview(): void {
    preview.update(projection, gridSize, output.kind === "print" ? 1 : options.defaultZoom);
  }

  const zoomSeg = optionSegmented(
    ZOOMS.map((zoom) => ({ value: String(zoom), label: `${zoom}×` })),
    String(options.defaultZoom),
    (value) => {
      options.defaultZoom = Number(value);
      redrawPreview();
    },
  );

  const zoomRow = optionRow({
    title: "Default zoom",
    hint:
      "What a scene opens at, here and in the game — 8px art usually " +
      "wants 3× or 4×.",
    control: zoomSeg.root,
  });

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
  // switching from Top Down to PSD to Phaser and back does not silently
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
   * number you typed. This one has nothing to come back to — only a Game
   * writes a `js/shared/character.js` at all — so a greyed
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

  // And the program the drawing is handed to, which is a separate
  // question from the space it was drawn in.
  //
  // The category row has no title: the heading above it has already said
  // the word, and a second copy inside would spend half the row repeating
  // it. So the `?` is on the heading — where the question is being asked —
  // and the four buttons take the width. Under Game, a second row asks
  // which one.
  const scaffoldGroup = optionGroup({
    title: "Scaffolding",
    hint: () => scaffoldNote(scaffold),
    rows: scaffoldPick.rows,
  });
  const renderingGroup = optionGroup({
    title: "Rendering",
    rows: [
      zoomRow,
      optionRow({
        title: "Pixel perfect",
        hint:
          "Nearest-neighbour textures and whole-pixel drawing. Both can be " +
          "toggled separately later, in Project Options.",
        control: pixelPerfect.root,
      }),
      characterRow,
    ],
  });

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
        // Straight after the name, because it decides which of the questions
        // below are asked at all: a page has no scaffolding to choose and no
        // rendering to set.
        optionGroup({
          title: "Output",
          hint: () => outputNote(output.kind),
          rows: [optionRow({ control: outputSeg.root }), dpiRow, ...dimensions.rows],
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
            preview.root,
          ],
        }),
        scaffoldGroup,
        renderingGroup,
      ],
    ),
  );
  redrawPreview();
  const create = () => {
    sheet.close();
    onCreate({
      name: name.trim() || "Untitled",
      projection,
      scaffold,
      gridSize,
      options: { ...options },
      output: { ...output },
    });
  };

  nameInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") create();
  });

  // A page is not a game, and the button that makes one should not say so.
  const createButton = h("button", {
    class: "btn btn-primary",
    text: "Create Game",
    onClick: create,
  });
  setOutputShown();

  sheet.actions.append(
    createButton,
    h("button", {
      class: "btn btn-ghost",
      text: "Cancel",
      onClick: sheet.close,
    }),
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

/** The half of the answer that is true whichever one is picked. */
const SCAFFOLD_NOTE =
  "How much of a project is written for you, from a whole game down to a " +
  "blank page. Drawing is the same whichever you pick — this is the code your " +
  "artwork is handed to, it is yours to edit or delete from the moment it is " +
  "written, and Project Options can switch it later.\n\n";

/**
 * What the picked scaffold writes, behind the `?` on the group's heading.
 *
 * The general sentence first and then *this* answer, rather than a list of
 * all of them: the question a hint is opened to settle is the one in front of
 * you. Read at the moment it opens, so it follows the buttons under it — see
 * `hintButton`, which takes a function for exactly this.
 */
export function scaffoldNote(scaffold: Scaffold): string {
  return SCAFFOLD_NOTE + writes(scaffold);
}

/** The one sentence about the scaffold that is picked. */
function writes(scaffold: Scaffold): string {
  switch (scaffold) {
    case "platformer":
      return (
        "A whole game, seen from the side: gravity, ground and a jump. It " +
        "reads the document as data, taking every non-walkable fill and " +
        "blocking boundary as the ground it stands on. Not offered with " +
        "Isometric, because gravity has no direction on a diamond grid seen " +
        "from above."
      );
    case "p2p":
      return (
        "Phaser 4 with psd-to-phaser wired up: every PSD is loaded before the " +
        "first scene starts, and each scene places its artwork with " +
        "this.P2P.place in its own create. None of the editor's own code is in " +
        "the project. Drag a PSD or a layer from the sidebar into a scene to " +
        "have its placement written for you."
      );
    case "phaser":
      return (
        "Vanilla with a Phaser 4 game running in it: an index.html, a " +
        "style.css and a script.js, and no psd-to-phaser and no assets " +
        "loaded. The exported artwork is in assets/, for Phaser's own loader."
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

/** What the picked output means, behind the `?` on its heading. */
function outputNote(kind: OutputKind): string {
  return kind === "print"
    ? "A page rather than a game. The canvas, the tools and the code are the " +
        "same; the game's screen is the sheet, one point to the world pixel " +
        "from the origin, and calling ExportForPrint() in your code stops " +
        "everything and writes the page out — a PDF, a layered PSD or both — at " +
        "the resolution below. Every PSD is written at that resolution, and the " +
        "canvas and your code work with a lighter copy. Code runs it, with the " +
        "page previewed beside the game. Always PSD to Phaser."
    : "A game for the web: played in the editor, published as a site. What " +
        "every project has always been.";
}
