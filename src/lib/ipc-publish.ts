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
   * The servers, the GitHub account's name, and whether this platform can
   * publish at all.
   *
   * **No token comes back.** A secret handed to a webview is a secret in a
   * webview's memory, and nothing here needs it: the deploys run in Rust.
   */
  settings: () => invoke<PublishSettings>("read_publish_settings"),
  /** Add a server or change one. Answers with its id, which Rust makes. */
  saveServer: (server: {
    id?: string;
    label: string;
    host: string;
    user: string;
    port?: number;
    identityFile?: string;
  }) => invoke<string>("save_publish_server", server),
  deleteServer: (id: string) => invoke<void>("delete_publish_server", { id }),
  /**
   * Keep a GitHub personal access token.
   *
   * A token rather than an OAuth flow: OAuth needs a redirect the app can
   * receive and a client secret it would have to ship, and a fine-grained PAT
   * is both narrower and revocable from a page the person already knows.
   */
  signInToGithub: (login: string, token: string) =>
    invoke<void>("save_github_login", { login, token }),
  signOutOfGithub: () => invoke<void>("clear_github_login"),

  /** Where this project publishes to. */
  target: (id: string) => invoke<PublishTarget>("read_publish_target", { id }),
  saveTarget: (id: string, target: PublishTarget) =>
    invoke<ProjectMeta>("save_publish_target", { id, target }),
  /**
   * Publish, or rehearse one.
   *
   * `dryRun` is the same command deliberately: the useful question — "is this
   * set up right?" — is one people ask with a finger already on Publish.
   */
  toTarget: (id: string, dryRun: boolean) =>
    invoke<PublishReport>("publish_to_target", { id, dryRun }),
};

/** One server this install can rsync to. */
export interface PublishServer {
  id: string;
  label: string;
  host: string;
  user: string;
  port?: number | null;
  identityFile?: string | null;
}

/** What the app knows about who is publishing — never the token itself. */
export interface PublishSettings {
  servers: PublishServer[];
  /** The GitHub account's name, when one is signed in. */
  github: string | null;
  /** Whether rsync and git can be run here at all. False on iPadOS. */
  canDeploy: boolean;
  /** Why not, when they cannot. */
  reason: string;
}

/** What a publish did, or would have done. */
export interface PublishReport {
  summary: string;
  /** What rsync or git said, redacted and trimmed to its last lines. */
  log: string;
  dryRun: boolean;
}
