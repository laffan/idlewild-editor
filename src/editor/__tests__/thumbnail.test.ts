/**
 * Which picture the home screen gets for a project.
 *
 * A game's is the canvas. A print project's is its Output preview; with no
 * page captured this time it keeps the thumbnail it has — the last preview —
 * and only a project with none at all falls back to the canvas.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";

const writeThumbnail = vi.fn(async (_id: string, _png: string) => undefined);
const thumbnail = vi.fn(async (_id: string): Promise<string | null> => null);
vi.mock("../../lib/ipc", () => ({
  projects: {
    writeThumbnail: (id: string, png: string) => writeThumbnail(id, png),
    thumbnail: (id: string) => thumbnail(id),
  },
}));
vi.mock("../../game/snapshot", () => ({
  snapshotPng: async () => "data:image/png;base64,CANVAS",
}));

import { saveThumbnail } from "../thumbnail";

const game = {} as Phaser.Game;
const preview = (png: string) => ({ isPrint: true, thumbnailPng: async () => png });

describe("saveThumbnail", () => {
  beforeEach(() => {
    writeThumbnail.mockClear();
    thumbnail.mockReset();
    thumbnail.mockResolvedValue(null);
  });

  it("writes the canvas for a game", async () => {
    await saveThumbnail(game, "p", { isPrint: false, thumbnailPng: async () => "PAGE" });
    expect(writeThumbnail).toHaveBeenCalledWith("p", "data:image/png;base64,CANVAS");
  });

  it("writes the preview for a print project with a page", async () => {
    await saveThumbnail(game, "p", preview("data:image/png;base64,PAGE"));
    expect(writeThumbnail).toHaveBeenCalledTimes(1);
    expect(writeThumbnail).toHaveBeenCalledWith("p", "data:image/png;base64,PAGE");
  });

  it("keeps the last preview when nothing was captured", async () => {
    thumbnail.mockResolvedValue("data:image/png;base64,OLD");
    await saveThumbnail(game, "p", preview(""));
    expect(writeThumbnail).not.toHaveBeenCalled();
  });

  it("falls back to the canvas for a page that has never had one", async () => {
    await saveThumbnail(game, "p", preview(""));
    expect(writeThumbnail).toHaveBeenCalledWith("p", "data:image/png;base64,CANVAS");
  });

  it("settles when the preview never does", async () => {
    vi.useFakeTimers();
    const done = saveThumbnail(game, "p", {
      isPrint: true,
      thumbnailPng: () => new Promise<string>(() => {}),
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    vi.useRealTimers();
    expect(writeThumbnail).toHaveBeenCalledWith("p", "data:image/png;base64,CANVAS");
  });
});
