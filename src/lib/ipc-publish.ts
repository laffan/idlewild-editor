/**
 * Leaving with a project: the three exports, and the two ways of publishing
 * somewhere real.
 *
 * Split from `ipc.ts` for the 700-line rule, along its own seam — this is
 * every call about *getting the project out*, where the rest of that file is
 * about working on one. `ipc.ts` re-exports all of it, so nothing that imports
 * `publish` from there has to know the split happened.
 *
 * The shape to keep in mind is that a **login is app-wide and a destination is
 * per project**: the person signs in once, then points each project somewhere.
 * See `publish_targets.rs` for that split and `deploy.rs` for what pushes.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProjectMeta } from "./types";
import type { PublishTarget } from "./publish-target";

/** One of a project's PSDs, as the Export Assets picker lists it. */
export interface PsdSummary {
  key: string;
  bytes: number;
  /** Whether the pipeline has run over it, so there is output to export. */
  hasAssets: boolean;
}

export const publish = {
  /**
   * A zip you can serve: the game, its assets and both runtimes.
   *
   * Written straight to the path rather than handed back as base64 — an
   * archive carrying every processed asset has no business crossing this
   * boundary as a string first.
   */
  site: (id: string, path: string) => invoke<void>("publish_site", { id, path }),
  /** The project itself, as `.idlewild` — source PSDs included. */
  project: (id: string, path: string) =>
    invoke<void>("export_project", { id, path }),
  /**
   * Some of a project's PSDs on their own: the pipeline's output, the source
   * files, or both. The third exit, and the only one that hands back artwork
   * rather than a program.
   */
  assets: (
    id: string,
    path: string,
    keys: readonly string[],
    assets: boolean,
    psds: boolean,
  ) =>
    invoke<void>("export_assets_zip", { id, path, keys, assets, psds }),
  /** Every PSD in the project, for the picker Export Assets opens with. */
  listPsds: (id: string) => invoke<PsdSummary[]>("list_project_psds", { id }),
  saveBytes: (path: string, dataBase64: string) =>
    invoke<void>("save_bytes", { path, dataBase64 }),

  // ── publishing somewhere real ────────────────────────────────────────────
  //
  // The login is app-wide and entered once; the destination is per project.
  // See `publish_targets.rs` for why those are two different things, and
  // `deploy.rs` for what actually pushes.

  /**
   * The servers and the GitHub account's name.
   *
   * **No secret comes back** — not the token, not the ssh key, not its
   * passphrase. A secret handed to a webview is a secret in a webview's memory
   * for as long as a sheet is open, and nothing here needs one: both publishes
   * run in Rust.
   */
  settings: () => invoke<PublishSettings>("read_publish_settings"),
  /**
   * Add a server or change one. Answers with its id, which Rust makes.
   *
   * `keyFile` is a path to read **now**, not a path to keep: Rust reads it,
   * checks it parses as an ssh private key, and stores the key itself. That is
   * what makes an iPad work — there is no `~/.ssh` there to point into, and a
   * file picked out of Files hands back a URL that is not readable again on
   * the next launch. Leaving it out on an edit keeps the key already stored.
   */
  saveServer: (server: {
    id?: string;
    label: string;
    host: string;
    user: string;
    port?: number;
    keyFile?: string;
    passphrase?: string;
  }) => invoke<string>("save_publish_server", server),
  deleteServer: (id: string) => invoke<void>("delete_publish_server", { id }),
  /**
   * Forget a server's host key, which is the only way past one that changed.
   *
   * Deliberately a separate, deliberate act rather than a checkbox on the
   * publish that failed: a changed host key is either a rebuilt server or
   * somebody standing in the middle of the connection, and the difference is
   * not something this app can work out.
   */
  forgetHostKey: (id: string) => invoke<void>("forget_host_key", { id }),
  /**
   * Keep a GitHub personal access token, and answer with whose it is.
   *
   * **No username is asked for.** The token is checked against GitHub, which
   * says who it belongs to — one fewer box to type into, and the difference
   * between finding out a token is bad now and finding out at the far end of
   * a publish.
   */
  signInToGithub: (token: string) => invoke<GithubAccount>("save_github_login", { token }),
  signOutOfGithub: (id: string) => invoke<void>("delete_github_login", { id }),
  /** Every repository an account can see, for the picker to search. */
  repos: (id: string) => invoke<GithubRepo[]>("list_github_repos", { id }),
  /** Every branch a repository has, so the branch box offers rather than asks. */
  branches: (id: string, owner: string, repo: string) =>
    invoke<string[]>("list_github_branches", { id, owner, repo }),
  /** The private keys already in `~/.ssh`, so the picker offers them. */
  sshKeys: () => invoke<SshKey[]>("list_ssh_keys"),
  /**
   * Try a server with what is in the form, before it is saved.
   *
   * Five things can fail and they have five different fixes; a row that has
   * never been tried looks exactly like one that works.
   */
  testServer: (server: {
    id?: string;
    host: string;
    user: string;
    port?: number;
    keyFile?: string;
    passphrase?: string;
    directory?: string;
  }) => invoke<PublishReport>("test_publish_server", server),

  /** Where this project publishes to. */
  target: (id: string) => invoke<PublishTarget>("read_publish_target", { id }),
  saveTarget: (id: string, target: PublishTarget) =>
    invoke<ProjectMeta>("save_publish_target", { id, target }),
  /**
   * What is already published, beside what this project would publish.
   *
   * The two panes of the Publish sheet, and the reason publishing is something
   * you can do to one file.
   */
  compare: (id: string) => invoke<Comparison>("compare_target", { id }),
  /**
   * Publish.
   *
   * `chosen` is the right pane's ticks and `remove` is the left pane's;
   * leaving `chosen` out means everything that differs. Progress arrives on
   * the `publish-line` event as it happens — see `watchPublish`.
   */
  toTarget: (id: string, chosen?: readonly string[], remove?: readonly string[]) =>
    invoke<PublishReport>("publish_to_target", { id, chosen, remove }),
};

/** One private key found in `~/.ssh`. */
export interface SshKey {
  path: string;
  name: string;
  /** Whether a matching `.pub` sits beside it. */
  hasPublic: boolean;
}

/**
 * Follow a publish, line by line, until the returned function is called.
 *
 * The same channel carries progress and trace, because they are the same
 * sentences: what the publish is doing now is exactly what you want written
 * down when it stops doing it. See `deploy::PUBLISH_LINE`.
 */
export function watchPublish(onLine: (line: string) => void): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;
  void listen<string>("publish-line", (event) => onLine(event.payload)).then((off) => {
    // Stopped before the listener was even registered — which happens when a
    // publish fails in its first moments.
    if (stopped) off();
    else unlisten = off;
  });
  return () => {
    stopped = true;
    unlisten?.();
  };
}

/** One GitHub account this device can publish as. Never its token. */
export interface GithubAccount {
  id: string;
  login: string;
}

/** One repository an account can see, as the picker lists it. */
export interface GithubRepo {
  /** `owner/name` — what the list searches and what a target stores. */
  fullName: string;
  owner: string;
  name: string;
  /** What the repository itself calls default. A hint, not the publish default. */
  defaultBranch: string;
  private: boolean;
  /** Whether this token can write to it. Shown and refused, rather than hidden. */
  canPush: boolean;
  updatedAt: number;
}

/** What a local file is, relative to what is already published. */
export type FileStatus = "new" | "changed" | "same" | "unknown";

export interface RemoteEntry {
  path: string;
  size: number;
  /** Whether the site still has a file of this name. */
  inSite: boolean;
}

export interface LocalEntry {
  path: string;
  size: number;
  status: FileStatus;
}

/** The two panes, and where they are about. */
export interface Comparison {
  remote: RemoteEntry[];
  local: LocalEntry[];
  /** The destination, as a person reads it. */
  destination: string;
  /** Nothing at the far end yet — a new branch, an empty directory. */
  fresh: boolean;
  /** Reachable but not comparable, when that happens. Empty otherwise. */
  note: string;
}

/** One server this install can publish to over SSH. */
export interface PublishServer {
  id: string;
  label: string;
  host: string;
  user: string;
  port?: number | null;
  /** The name of the file the key was imported from, for the row to say so. */
  keySource: string;
  /** Whether there is a key at all. A server without one cannot publish. */
  hasKey: boolean;
  /**
   * The host key fingerprint, learned on the first connection, or empty
   * before there has been one. Not a secret: it is shown, because comparing it
   * against what the server says about itself is the only way anybody can
   * check that the first connection was not already the wrong one.
   */
  hostKey: string;
}

/** What the app knows about who is publishing — never a secret itself. */
export interface PublishSettings {
  servers: PublishServer[];
  accounts: GithubAccount[];
}

/** What a publish did. */
export interface PublishReport {
  summary: string;
  /** The detail, redacted and trimmed to its last lines. */
  log: string;
}
