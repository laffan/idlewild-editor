import { describe, expect, it } from "vitest";
import {
  artboardsOf,
  currentArtboards,
  DEFAULT_OUTPUT,
  FIRST_ARTBOARD,
  setOpenProject,
  type Output,
} from "../../lib/print";
import { placeNewArtboard, ARTBOARD_GAP } from "../artboards-panel";
import { gameScreen } from "../screen-guide";
import { DEFAULT_PRESENTATION, type ProjectMeta } from "../../lib/types";

const print = (extra: Partial<Output> = {}): Output => ({
  ...DEFAULT_OUTPUT,
  kind: "print",
  ...extra,
});

const meta = (output: Output): ProjectMeta => ({
  id: "p",
  name: "Page",
  projection: "blank",
  genre: "p2p",
  gridSize: 64,
  createdAt: 0,
  updatedAt: 0,
  layerCount: 1,
  output,
});

describe("artboards", () => {
  it("reads a project from before artboards as one, made of its page", () => {
    const boards = artboardsOf(print({ paper: "a4", x: 30 }));
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ id: FIRST_ARTBOARD, paper: "a4", x: 30 });
  });

  it("places every artboard of the open project, sized", () => {
    setOpenProject(
      meta(
        print({
          artboards: [
            { ...artboardsOf(print())[0] },
            { ...artboardsOf(print())[0], id: "b", name: "Back", paper: "a5", x: 700 },
          ],
        }),
      ),
    );
    const placed = currentArtboards();
    expect(placed.map((b) => [b.name, b.width, b.height, b.x])).toEqual([
      ["Artboard 1", 612, 792, 0],
      ["Back", 420, 595, 700],
    ]);
    setOpenProject(null);
    expect(currentArtboards()).toEqual([]);
  });

  it("puts a new artboard to the right of all of them, level with its source", () => {
    const boards = [
      { ...artboardsOf(print())[0], width: 612, height: 792, x: 0, y: 0 },
      { ...artboardsOf(print())[0], id: "b", width: 400, height: 400, x: 700, y: 50 },
    ];
    expect(placeNewArtboard(boards, boards[0])).toEqual({ x: 1100 + ARTBOARD_GAP, y: 0 });
  });
});

describe("the game's screen, from Page Setup", () => {
  const row = { width: 1200, height: 800 };
  it("is the row when the game fills the window", () => {
    expect(gameScreen(row, DEFAULT_PRESENTATION)).toEqual(row);
    expect(gameScreen(row)).toEqual(row);
  });
  it("is the fixed box when there is one, whatever the row", () => {
    const page = { ...DEFAULT_PRESENTATION, fixed: true, width: 320, height: 568 };
    expect(gameScreen(row, page)).toEqual({ width: 320, height: 568 });
  });
  it("loses the margin on every side otherwise", () => {
    expect(gameScreen(row, { ...DEFAULT_PRESENTATION, margin: 40 })).toEqual({
      width: 1120,
      height: 720,
    });
  });
});
