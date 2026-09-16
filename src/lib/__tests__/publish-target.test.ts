/**
 * Where a project publishes to, as the sheet reads it back.
 *
 * Two small functions, and both are load-bearing for what the Publish sheet
 * offers. `targetIsSet` decides whether there is a Publish row at all — a kind
 * with no destination behind it would be a button that fails at the far end —
 * and `describeTarget` is the sentence that row carries, which is the only
 * place anybody checks where a publish is about to go.
 *
 * It mirrors `PublishTarget::describe` in the Rust, and the two are asserted
 * against the same examples on both sides on purpose: the frontend names the
 * destination before a publish and the backend names it afterwards, and the
 * two disagreeing would read as the publish having gone somewhere else.
 */

import { describe, expect, it } from "vitest";
import {
  describeTarget,
  EMPTY_TARGET,
  targetIsSet,
  type PublishTarget,
} from "../publish-target";

const target = (fields: Partial<PublishTarget>): PublishTarget => ({
  ...EMPTY_TARGET,
  ...fields,
});

describe("whether a target names somewhere", () => {
  it("is no, for a project that has never been pointed anywhere", () => {
    expect(targetIsSet(EMPTY_TARGET)).toBe(false);
  });

  /** A kind alone would offer a Publish that fails for want of a directory. */
  it("is no, for a kind with nothing behind it", () => {
    expect(targetIsSet(target({ kind: "rsync" }))).toBe(false);
    expect(targetIsSet(target({ kind: "rsync", server: "s1" }))).toBe(false);
    expect(targetIsSet(target({ kind: "github", owner: "laffan" }))).toBe(false);
  });

  it("is yes once both halves are there", () => {
    expect(targetIsSet(target({ kind: "rsync", server: "s1", directory: "/var/www" }))).toBe(true);
    expect(targetIsSet(target({ kind: "github", owner: "laffan", repo: "site" }))).toBe(true);
  });
});

describe("how a destination reads", () => {
  it("names the server by the name it was given, not by its id", () => {
    const where = target({ kind: "rsync", server: "s1", directory: "/var/www" });
    expect(describeTarget(where, "Live")).toBe("/var/www on Live");
    // A server this device no longer has: the directory is still worth saying.
    expect(describeTarget(where)).toBe("/var/www");
  });

  /**
   * `gh-pages` for anyone who has not said, matching the Rust's
   * `branch_or_default` — the alternative default is the branch holding
   * somebody's source.
   */
  it("fills in the branch, and the path only when there is one", () => {
    const repo = target({ kind: "github", owner: "laffan", repo: "site" });
    expect(describeTarget(repo)).toBe("laffan/site on gh-pages");
    expect(describeTarget({ ...repo, branch: "main" })).toBe("laffan/site on main");
    expect(describeTarget({ ...repo, path: "/game/" })).toBe("laffan/site on gh-pages/game");
  });

  it("says so plainly when there is nowhere", () => {
    expect(describeTarget(EMPTY_TARGET)).toBe("nowhere yet");
  });
});
