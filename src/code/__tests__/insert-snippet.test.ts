/**
 * Lines dropped at the caret: indented to the code around it, on a line of
 * their own, and never splitting the line the caret is in.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { caretInsertion } from "../insert-snippet";

function dropInto(doc: string, caret: number, lines: string[]): string {
  const state = EditorState.create({ doc, selection: { anchor: caret } });
  return state.update({ changes: caretInsertion(state, lines) }).state.doc.toString();
}

const scene = "  create() {\n    // Place PSDs here.\n  }\n";

describe("a drop at the caret", () => {
  it("goes on the line after the caret's, at its indent", () => {
    const caret = scene.indexOf("here.") + 2;
    expect(dropInto(scene, caret, ["const a = 1;", "a.go();"])).toBe(
      "  create() {\n    // Place PSDs here.\n    const a = 1;\n    a.go();\n  }\n",
    );
  });

  it("takes the place of a blank line, one deeper inside a brace", () => {
    const doc = "  create() {\n\n  }\n";
    expect(dropInto(doc, doc.indexOf("\n") + 1, ["const a = 1;"])).toBe(
      "  create() {\n    const a = 1;\n  }\n",
    );
  });
});
