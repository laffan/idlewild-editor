import { describe, expect, it } from "vitest";
import { canvasInWorld } from "../../lib/placing";
import { CHROME_DEPTH, CHROME_NAME, isMaterial } from "../../game/chrome";
import { carrySendChoice, sendChoiceOf } from "../psd-send";
import { setOpenProject } from "../../lib/print";
import { palette } from "../../lib/palette";
import type { Placement, ProjectMeta } from "../../lib/types";

describe("Include context's box", () => {
  it("is the file's whole canvas where the placement stands", () => {
    // A layer 20 px in from the canvas's corner, drawn at half size.
    const placement = {
      x: 100, y: 50, width: 32, height: 16, naturalWidth: 64, naturalHeight: 32,
    } as Placement;
    expect(canvasInWorld(placement, { x: 20, y: 10 }, { width: 128, height: 96 })).toEqual({
      x: 90, y: 45, width: 64, height: 48,
    });
  });

  it("draws canvas material and leaves the editor's chrome out", () => {
    expect(isMaterial({ depth: 2001 })).toBe(true);
    expect(isMaterial({ name: CHROME_NAME, depth: -10_000 })).toBe(false);
    expect(isMaterial({ depth: CHROME_DEPTH })).toBe(false);
    expect(isMaterial({ depth: 3, scrollFactorX: 0, scrollFactorY: 0 })).toBe(false);
    expect(isMaterial({ depth: 3, visible: false })).toBe(false);
  });
});

describe("what goes into a PSD", () => {
  const meta = (psdSend?: ProjectMeta["psdSend"]): ProjectMeta => ({
    id: "p", name: "P", projection: "blank", genre: "p2p", gridSize: 16,
    createdAt: 0, updatedAt: 0, layerCount: 1, ...(psdSend ? { psdSend } : {}),
  });

  it("follows the app-wide palette switch until the file has its own answer", () => {
    setOpenProject(meta({ door: { palette: false, context: true } }));
    expect(sendChoiceOf("tree")).toEqual({ palette: palette.attach, context: false });
    expect(sendChoiceOf("door")).toEqual({ palette: false, context: true });
    carrySendChoice("door", "gate", true);
    expect(sendChoiceOf("gate")).toEqual({ palette: false, context: true });
    expect(sendChoiceOf("door").context).toBe(false);
    setOpenProject(null);
  });
});
