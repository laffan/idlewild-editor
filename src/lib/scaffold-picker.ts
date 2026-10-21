/**
 * The two-tier scaffold control: a category, and under Game, which game.
 *
 * Four categories of progressive simplicity — Game, PSD to Phaser, Phaser,
 * Vanilla — and only the first has a second question, Top Down or Platformer.
 * The second row is there only while Game is picked: under the other three it
 * would be a question with one answer. Which game was picked is remembered
 * across a trip to another category, so going to Vanilla and back does not
 * quietly turn a platformer into a top-down game.
 *
 * New Project and Project Options' Scaffolding both draw it, so the two sheets
 * ask the question the same way. See `CATEGORIES` in `project-types.ts`.
 */

import { optionRow } from "./options-list";
import { optionSegmented } from "./options-controls";
import {
  CATEGORIES,
  categoryOf,
  type Scaffold,
  type ScaffoldCategory,
} from "./project-types";

export interface ScaffoldPicker {
  /** The category row, and the Game row under it. */
  readonly rows: HTMLElement[];
  readonly value: Scaffold;
  /** Put the controls on `scaffold` without reporting a change. */
  set: (scaffold: Scaffold) => void;
  /** Grey Platformer out, or bring it back. */
  setPlatformerEnabled: (enabled: boolean) => void;
}

export function scaffoldPicker(
  initial: Scaffold,
  onChange: (scaffold: Scaffold) => void,
): ScaffoldPicker {
  let value = initial;
  let game: Scaffold = categoryOf(initial) === "game" ? initial : "topdown";

  const categorySeg = optionSegmented(
    CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    categoryOf(initial),
    (picked) => {
      const category = picked as ScaffoldCategory;
      value =
        category === "game"
          ? game
          : (CATEGORIES.find((c) => c.value === category)?.scaffolds[0]?.value ?? "p2p");
      gameRow.hidden = category !== "game";
      onChange(value);
    },
  );

  const games = CATEGORIES.find((c) => c.value === "game")?.scaffolds ?? [];
  const gameSeg = optionSegmented(
    games.map((g) => ({ value: g.value, label: g.label })),
    game,
    (picked) => {
      game = picked as Scaffold;
      value = game;
      onChange(value);
    },
  );
  const gameRow = optionRow({ title: "Game", control: gameSeg.root });
  gameRow.hidden = categoryOf(initial) !== "game";

  return {
    rows: [optionRow({ control: categorySeg.root }), gameRow],
    get value() {
      return value;
    },
    set: (scaffold) => {
      value = scaffold;
      const category = categoryOf(scaffold);
      categorySeg.select(category);
      if (category === "game") {
        game = scaffold;
        gameSeg.select(scaffold);
      }
      gameRow.hidden = category !== "game";
    },
    setPlatformerEnabled: (enabled) => gameSeg.setEnabled("platformer", enabled),
  };
}
