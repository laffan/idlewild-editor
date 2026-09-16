/**
 * Where a project publishes to, when publishing means somewhere real.
 *
 * Mirrors `project::PublishTarget` in the Rust, and lives beside `types.ts`
 * rather than in it for the 700-line rule — that file was exactly at the
 * limit. It is a clean seam either way: everything here is about one feature,
 * and the only thing `types.ts` needs from it is the field's type.
 *
 * The **credentials are not here and are not per project**. A login belongs to
 * the person and is entered once — see `PublishSettings` in `lib/ipc.ts` and
 * `publish_targets.rs`. What is per project is the destination: which server
 * and directory, or which repository, branch and path inside it.
 */

import type { ProjectMeta } from "./types";

/**
 * Which of the two ways of publishing somewhere real a project uses.
 *
 * `none` is what every project starts as and what the two zip exports have
 * always been enough for.
 */
export type TargetKind = "none" | "rsync" | "github";

/**
 * Where a project publishes to — the destination, not the login.
 *
 * The credentials are app-wide and entered once (`PublishSettings`); this is
 * the per-project half: which server and directory, or which repository,
 * branch and path inside it. `server` names a row in *this install's*
 * settings, which is why a target does not travel in a `.idlewild` file.
 *
 * Flat, with everything optional, because it is written into `meta.json`: a
 * project that was rsync and is now GitHub keeps what it had typed for the
 * other one.
 */
export interface PublishTarget {
  kind: TargetKind;
  /** The id of the rsync server this project pushes to. */
  server: string;
  /** The directory on that server the site's own files land in. */
  directory: string;
  /** Whether an rsync push may delete what the site no longer has. */
  prune: boolean;
  owner: string;
  repo: string;
  /** Empty means `gh-pages` — see the Rust's `branch_or_default`. */
  branch: string;
  /** A directory inside the repository, or empty for its root. */
  path: string;
}

export const EMPTY_TARGET: PublishTarget = {
  kind: "none",
  server: "",
  directory: "",
  prune: false,
  owner: "",
  repo: "",
  branch: "",
  path: "",
};

/** A saved target, with every field the frontend may have to fill in. */
export function publishTarget(meta: ProjectMeta): PublishTarget {
  return { ...EMPTY_TARGET, ...(meta.publish ?? {}) };
}

/** Whether a target names somewhere, rather than only a kind. */
export function targetIsSet(target: PublishTarget): boolean {
  if (target.kind === "rsync") return !!target.server && !!target.directory;
  if (target.kind === "github") return !!target.owner && !!target.repo;
  return false;
}

/**
 * The destination, as a person reads it.
 *
 * Mirrors `PublishTarget::describe` in the Rust, and takes the server's name
 * rather than looking it up: a target stores an id, and the list of servers is
 * the settings sheet's to know about.
 */
export function describeTarget(target: PublishTarget, serverName?: string): string {
  if (target.kind === "rsync") {
    return serverName ? `${target.directory} on ${serverName}` : target.directory;
  }
  if (target.kind === "github") {
    const branch = target.branch || "gh-pages";
    const inside = target.path ? `/${target.path.replace(/^\/+|\/+$/g, "")}` : "";
    return `${target.owner}/${target.repo} on ${branch}${inside}`;
  }
  return "nowhere yet";
}
