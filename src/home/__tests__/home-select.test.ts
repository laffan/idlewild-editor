/**
 * Acting on several projects at once.
 *
 * Two things matter here and neither is the happy path. **One question, not
 * six** — a bulk delete asks once, because six confirmations for one decision is
 * what made clearing out a shelf of experiments feel like six decisions. And
 * **a failure part-way through does not abandon the rest**: five projects copied
 * and one refused is a better answer than one copied and five silently dropped,
 * which is what a `Promise.all` would have given.
 *
 * The third is the distinction the caller depends on. Declining the question and
 * failing every delete both leave nothing deleted, and the home screen has to
 * tell them apart: one keeps the selection lit, the other has nothing left to
 * keep.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const duplicate = vi.fn<(id: string) => Promise<unknown>>();
const remove = vi.fn<(id: string) => Promise<void>>();
let answer = true;
const asked: Array<{ title: string; message: string }> = [];

vi.mock("../../lib/ipc", () => ({
  projects: {
    duplicate: (id: string) => duplicate(id),
    remove: (id: string) => remove(id),
  },
}));

vi.mock("../../lib/sheet", () => ({
  confirmSheet: (title: string, message: string) => {
    asked.push({ title, message });
    return Promise.resolve(answer);
  },
}));

import {
  deleteProjects,
  describeCount,
  duplicateProjects,
} from "../home-select";

beforeEach(() => {
  duplicate.mockReset();
  duplicate.mockResolvedValue(undefined);
  remove.mockReset();
  remove.mockResolvedValue(undefined);
  asked.length = 0;
  answer = true;
});

describe("counting projects out loud", () => {
  it("says it in the singular for one", () => {
    expect(describeCount(1)).toBe("1 project");
    expect(describeCount(0)).toBe("0 projects");
    expect(describeCount(4)).toBe("4 projects");
  });
});

describe("duplicating several", () => {
  it("copies each of them, and says how many landed", async () => {
    expect(await duplicateProjects(["a", "b", "c"])).toBe(3);
    expect(duplicate.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  /** One refusal must not take the other two with it. */
  it("carries on past one that fails", async () => {
    duplicate.mockImplementation((id: string) =>
      id === "b" ? Promise.reject(new Error("no room")) : Promise.resolve(undefined),
    );
    expect(await duplicateProjects(["a", "b", "c"])).toBe(2);
    expect(duplicate).toHaveBeenCalledTimes(3);
  });

  it("has nothing to do with an empty selection", async () => {
    expect(await duplicateProjects([])).toBe(0);
    expect(duplicate).not.toHaveBeenCalled();
  });
});

describe("deleting several", () => {
  it("asks once, then deletes each of them", async () => {
    expect(await deleteProjects(["a", "b"], ["Cave", "Overworld"])).toBe(2);
    expect(asked).toHaveLength(1);
    expect(remove.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });

  /** Named while the list is short enough to read. */
  it("names a short list in the question", async () => {
    await deleteProjects(["a", "b"], ["Cave", "Overworld"]);
    expect(asked[0].title).toBe("Delete 2 projects");
    expect(asked[0].message).toContain("“Cave”, “Overworld”");
  });

  /** And counted when it is not — fourteen titles is a wall nobody reads. */
  it("counts a long list instead", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    await deleteProjects(ids, ids.map((id) => `Project ${id}`));
    expect(asked[0].message).toContain("5 projects");
    expect(asked[0].message).not.toContain("Project a");
  });

  it("keeps the singular for one, so the card menu's wording still fits", async () => {
    await deleteProjects(["a"], ["Cave"]);
    expect(asked[0].title).toBe("Delete project");
  });

  /**
   * Declined is not the same answer as "all of them failed", and the home
   * screen reads the difference: one keeps the selection lit for another try,
   * the other has nothing left to keep.
   */
  it("answers null when the question is declined, and deletes nothing", async () => {
    answer = false;
    expect(await deleteProjects(["a", "b"], ["Cave", "Overworld"])).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("carries on past one that fails", async () => {
    remove.mockImplementation((id: string) =>
      id === "a" ? Promise.reject(new Error("in use")) : Promise.resolve(),
    );
    expect(await deleteProjects(["a", "b"], ["Cave", "Overworld"])).toBe(1);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  /** Nothing selected is nothing to ask about. */
  it("does not ask about an empty selection", async () => {
    expect(await deleteProjects([], [])).toBe(0);
    expect(asked).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
