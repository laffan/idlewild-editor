/**
 * How far a project's PSDs have got, from the scene to the veil over the
 * canvas — see `lib/psd-load-progress.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  loadInTurn,
  loading,
  onPsdLoad,
  type PsdLoadProgress,
} from "../psd-load-progress";
import { describeLoad } from "../../editor/psd-veil";

describe("loadInTurn", () => {
  it("says which file is on its way, then that the pass is over", async () => {
    const seen: PsdLoadProgress[] = [];
    const stop = onPsdLoad((p) => seen.push(p));
    seen.length = 0;
    const order: string[] = [];
    await loadInTurn(["tower", "roof"], async (key) => {
      order.push(key);
    });
    stop();
    expect(order).toEqual(["tower", "roof"]);
    expect(seen).toEqual([
      { done: 0, total: 2, key: "tower" },
      { done: 1, total: 2, key: "roof" },
      { done: 2, total: 2, key: null },
    ]);
    expect(loading(seen[1])).toBe(true);
    expect(loading(seen[2])).toBe(false);
  });

  it("tells a late listener where the pass stands", async () => {
    let release = () => {};
    const pass = loadInTurn(["a", "b", "c"], (key) =>
      key === "b" ? new Promise<void>((done) => (release = done)) : Promise.resolve(),
    );
    await Promise.resolve();
    await Promise.resolve();
    let now: PsdLoadProgress | null = null;
    const stop = onPsdLoad((p) => (now = p));
    expect(now).toEqual({ done: 1, total: 3, key: "b" });
    release();
    await pass;
    stop();
    expect(now).toEqual({ done: 3, total: 3, key: null });
  });

  it("is never loading for a scene that places nothing", async () => {
    let now: PsdLoadProgress | null = null;
    const stop = onPsdLoad((p) => (now = p));
    await loadInTurn([], async () => {});
    stop();
    expect(now).toEqual({ done: 0, total: 0, key: null });
    expect(loading(now!)).toBe(false);
  });
});

describe("describeLoad", () => {
  it("counts, and names the file on its way", () => {
    expect(describeLoad({ done: 3, total: 12, key: "tower" })).toBe("3 of 12 · tower");
    expect(describeLoad({ done: 12, total: 12, key: null })).toBe("12 of 12");
  });
});
