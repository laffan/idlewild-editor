/**
 * When the text panel shows a size field, and when it shows only the menu.
 *
 * The panel itself is DOM and this suite has none, by choice — but the one
 * decision in it that is not markup is worth pinning, because it is the answer
 * to a question the menu cannot ask. Six sizes are offered; a note can be any
 * size at all; and a menu that closed showing `31 px` with no row inside it
 * marked as chosen would be a control saying it does not know what it is set
 * to. So the field appears by itself for a size the menu cannot represent, and
 * on request for one it can.
 *
 * It is module state rather than document state on purpose: asking to see the
 * number changes nothing about the note, so there is nothing to undo and
 * nothing to save.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { openSizeField, sizeFieldOpen } from "../inspect-text";

beforeEach(() => openSizeField(null));

describe("the text size field", () => {
  it("stays shut for a size the menu offers", () => {
    for (const size of [12, 16, 24, 32, 48, 64]) {
      expect(sizeFieldOpen("t1", size)).toBe(false);
    }
  });

  /**
   * A note dragged to 31px, or one made when the presets were a different six.
   * Nobody asked for the field, and it has to be there anyway: it is the only
   * control that can say what the size actually is.
   */
  it("opens by itself for a size it does not", () => {
    expect(sizeFieldOpen("t1", 31)).toBe(true);
    expect(sizeFieldOpen("t1", 400)).toBe(true);
  });

  it("opens on request for a size it does", () => {
    openSizeField("t1");
    expect(sizeFieldOpen("t1", 24)).toBe(true);
  });

  /**
   * The request is about the note that was in front of you when you made it.
   * A field that stayed open across selections would be a panel remembering
   * something nobody said twice.
   */
  it("is asked for one note at a time", () => {
    openSizeField("t1");
    expect(sizeFieldOpen("t2", 24)).toBe(false);
    openSizeField("t2");
    expect(sizeFieldOpen("t1", 24)).toBe(false);
  });

  /** Picking a size from the menu shuts it again. */
  it("shuts when the menu is used instead", () => {
    openSizeField("t1");
    openSizeField(null);
    expect(sizeFieldOpen("t1", 24)).toBe(false);
  });
});
