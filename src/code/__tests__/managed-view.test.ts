import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { managedEdit, managedExtension } from "../managed-view";

const SCAFFOLD = [
  "before();",
  "// idlewild:begin block",
  "owned();",
  "// idlewild:end block",
  "after();",
].join("\n");

function editor(doc = SCAFFOLD) {
  return EditorState.create({
    doc,
    extensions: managedExtension({
      path: "js/WorldScene.js",
      canonical: SCAFFOLD,
      onReset: () => {},
      onRefused: () => {},
    }),
  });
}

/** The document after a change, or null if the filter refused it. */
function apply(
  state: EditorState,
  changes: { from: number; to?: number; insert?: string },
): string | null {
  const next = state.update({ changes }).state;
  const text = next.doc.toString();
  return text === state.doc.toString() ? null : text;
}

/** The offset of a line's start, 1-based line number. */
const at = (state: EditorState, line: number) => state.doc.line(line);

describe("the managed-line filter", () => {
  it("lets an edit outside a block through", () => {
    const state = editor();
    const line = at(state, 1);
    expect(apply(state, { from: line.to, insert: " // fine" })).toContain(
      "before(); // fine",
    );
  });

  it("refuses a character typed into an owned line", () => {
    const state = editor();
    const line = at(state, 3);
    expect(apply(state, { from: line.from + 2, insert: "X" })).toBeNull();
  });

  it("refuses a character appended to an owned line", () => {
    const state = editor();
    const line = at(state, 3);
    expect(apply(state, { from: line.to, insert: "X" })).toBeNull();
  });

  it("refuses deleting an owned line's text", () => {
    const state = editor();
    const line = at(state, 3);
    expect(apply(state, { from: line.from, to: line.to })).toBeNull();
  });

  it("refuses a backspace that would join an owned line to the line above", () => {
    const state = editor();
    const line = at(state, 3);
    expect(apply(state, { from: line.from - 1, to: line.from })).toBeNull();
  });

  it("refuses unmarking a block by editing its marker", () => {
    const state = editor();
    const line = at(state, 2);
    expect(apply(state, { from: line.from, to: line.to })).toBeNull();
    expect(apply(state, { from: line.from, insert: "x" })).toBeNull();
  });

  it("allows a break typed at the end of an owned line", () => {
    const state = editor();
    const line = at(state, 3);
    const next = apply(state, { from: line.to, insert: "\n" });
    expect(next).not.toBeNull();
    expect(next?.split("\n")[2]).toBe("owned();");
  });

  it("allows a break typed in front of an owned line", () => {
    const state = editor();
    const line = at(state, 3);
    const next = apply(state, { from: line.from, insert: "\n" });
    expect(next?.split("\n")[3]).toBe("owned();");
  });

  it("lets a line typed inside a block be edited and deleted again", () => {
    const state = editor();
    const line = at(state, 3);
    const withMine = editor(
      apply(state, { from: line.to, insert: "\nconsole.log('mine');" }) ?? "",
    );

    const mine = at(withMine, 4);
    expect(mine.text).toBe("console.log('mine');");
    // Its own text is the user's to change …
    expect(apply(withMine, { from: mine.to, insert: "X" })).not.toBeNull();
    // … and the whole line, newline included, is theirs to remove.
    expect(
      apply(withMine, { from: mine.from, to: mine.to + 1 }),
    ).toBe(SCAFFOLD);
  });

  it("lets the editor's own rewrite past the filter", () => {
    const state = editor();
    const broken = state.update({
      changes: { from: 0, to: state.doc.length, insert: "gone" },
      annotations: managedEdit.of(true),
    }).state;
    expect(broken.doc.toString()).toBe("gone");
  });

  it("locks a generated file end to end", () => {
    const config = '{\n  "grid": 64\n}';
    const state = EditorState.create({
      doc: config,
      extensions: managedExtension({
        path: "js/game.config.json",
        canonical: config,
        onReset: () => {},
        onRefused: () => {},
      }),
    });
    expect(apply(state, { from: 0, insert: "x" })).toBeNull();
    expect(apply(state, { from: state.doc.length, insert: "\n" })).toBeNull();
  });
});
