/**
 * Where *this project* publishes to.
 *
 * The other half of `publish-logins.ts`: that one is who you are, shared by
 * every project on the device; this one is the destination, and it is the
 * project's. A server and a directory, or a repository, a branch and a path
 * inside it.
 *
 * **Changing the kind does not throw the other one's answers away.** The
 * target is stored flat — see `lib/publish-target.ts` — so a project that was
 * rsync and is now GitHub still has the directory it had, and switching back
 * is switching back rather than typing it again. The sheet rebuilds its rows
 * on the switch and keeps everything already typed in the object behind them.
 *
 * **The GitHub half says what it is about to replace.** A publish commits onto
 * a branch rather than force-pushing over it — see `deploy_github.rs` — but
 * everything *at the path being published to* is replaced, and a branch box
 * that quietly defaulted to `main` would be a game editor deleting somebody's
 * source from the tip of their default branch. So the default is `gh-pages`,
 * and the sentence under the fields names the exact place.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { publish, type PublishSettings } from "../lib/ipc";
import {
  EMPTY_TARGET,
  type PublishTarget,
  type TargetKind,
} from "../lib/publish-target";
import * as log from "../lib/log";
import { field, openPublishLogins } from "./publish-logins";

const KINDS: Array<{ value: TargetKind; label: string; hint: string }> = [
  { value: "none", label: "Nowhere", hint: "export a zip instead" },
  { value: "rsync", label: "A server", hint: "rsync over ssh" },
  { value: "github", label: "GitHub", hint: "a branch of a repository" },
];

/**
 * Open the sheet. `onSaved` is how the Publish sheet behind it finds out its
 * first row has a new destination to name.
 */
export function openPublishWhere(
  projectId: string,
  onSaved: (target: PublishTarget) => void = () => {},
): void {
  const sheet = openSheet({
    title: "Where this publishes",
    subtitle: "this project only — the login is shared",
    width: 620,
  });

  // Everything typed lives here rather than in the inputs, so a switch between
  // the two kinds does not lose what was in the other one's boxes.
  let target: PublishTarget = { ...EMPTY_TARGET };
  let settings: PublishSettings | null = null;

  const body = h("div");
  sheet.body.appendChild(body);

  const save = h("button", {
    class: "btn btn-primary",
    text: "Save",
    onClick: () => {
      void publish
        .saveTarget(projectId, target)
        .then(() => {
          sheet.close();
          onSaved(target);
        })
        .catch((err) => log.error("Could not save the publish target:", err));
    },
  });
  sheet.actions.append(
    save,
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  const draw = () => {
    body.replaceChildren(
      kindRow(target.kind, (kind) => {
        target = { ...target, kind };
        draw();
      }),
      ...rowsFor(target, settings, (next) => {
        target = { ...target, ...next };
      }, () => {
        // A server added from in here has to appear in the list behind it.
        openPublishLogins(() => void refresh());
      }),
    );
  };

  const refresh = async () => {
    try {
      settings = await publish.settings();
    } catch (err) {
      log.error("Could not read the publish settings:", err);
    }
    draw();
  };

  void (async () => {
    try {
      target = { ...EMPTY_TARGET, ...(await publish.target(projectId)) };
    } catch (err) {
      log.error("Could not read this project's publish target:", err);
    }
    await refresh();
  })();
}

/** The three, as one segmented control. */
function kindRow(current: TargetKind, onPick: (kind: TargetKind) => void): HTMLElement {
  const seg = h(
    "div",
    { class: "seg" },
    ...KINDS.map(({ value, label }) =>
      h("button", {
        class: "seg-opt",
        type: "button",
        text: label,
        "aria-pressed": String(value === current),
        onClick: () => onPick(value),
      }),
    ),
  );
  const chosen = KINDS.find((kind) => kind.value === current);
  return h(
    "div",
    { class: "sheet-row control" },
    h("div", { class: "sheet-row-key m", text: "PUBLISH TO" }),
    h(
      "div",
      { class: "sheet-row-value seg-stack" },
      seg,
      h("div", { class: "check-hint", text: chosen?.hint ?? "" }),
    ),
  );
}

function rowsFor(
  target: PublishTarget,
  settings: PublishSettings | null,
  onChange: (next: Partial<PublishTarget>) => void,
  openLogins: () => void,
): HTMLElement[] {
  if (target.kind === "rsync") return rsyncRows(target, settings, onChange, openLogins);
  if (target.kind === "github") return githubRows(target, settings, onChange, openLogins);
  return [
    h("div", {
      class: "field-hint",
      text:
        "Publish will hand you a zip, as it always has. Pick a server or " +
        "GitHub above to send the site somewhere directly instead.",
    }),
  ];
}

// ── a server ────────────────────────────────────────────────────────────────

function rsyncRows(
  target: PublishTarget,
  settings: PublishSettings | null,
  onChange: (next: Partial<PublishTarget>) => void,
  openLogins: () => void,
): HTMLElement[] {
  const list = settings?.servers ?? [];
  const chosen = list.some((server) => server.id === target.server)
    ? target.server
    : // One server is not a choice: a project pointed at a device with exactly
      // one server means that one, and making somebody tap it first is a step
      // with no decision in it.
      (list.length === 1 ? list[0].id : "");
  // Only once the settings have actually been read. A failed read leaves
  // `settings` null with an empty server list behind it, and clearing the
  // saved server on the strength of that would lose a working target because
  // one call did not come back.
  if (settings && chosen !== target.server) onChange({ server: chosen });

  const picker = list.length
    ? h(
        "div",
        { class: "seg" },
        ...list.map((server) =>
          h("button", {
            class: "seg-opt",
            type: "button",
            text: server.label || server.host,
            "aria-pressed": String(server.id === chosen),
            onClick: (event: Event) => {
              onChange({ server: server.id });
              for (const button of (event.currentTarget as HTMLElement)
                .parentElement?.children ?? []) {
                button.setAttribute("aria-pressed", String(button === event.currentTarget));
              }
            },
          }),
        ),
      )
    : h("div", { class: "check-hint", text: "No servers on this device yet." });

  const directory = field("Directory", "/var/www/example.com", target.directory);
  directory.input.addEventListener("input", () =>
    onChange({ directory: directory.input.value }),
  );

  const prune = h("input", {
    class: "check-box",
    type: "checkbox",
    checked: target.prune ? "checked" : undefined,
    onChange: (event: Event) =>
      onChange({ prune: (event.currentTarget as HTMLInputElement).checked }),
  }) as HTMLInputElement;

  return [
    h(
      "div",
      { class: "sheet-row control" },
      h("div", { class: "sheet-row-key m", text: "SERVER" }),
      h(
        "div",
        { class: "sheet-row-value seg-stack" },
        picker,
        h("button", {
          class: "btn btn-ghost",
          text: list.length ? "Servers and accounts…" : "Add a server…",
          onClick: openLogins,
        }),
      ),
    ),
    directory.row,
    h(
      "div",
      { class: "sheet-row control" },
      h("div", { class: "sheet-row-key m", text: "TIDY UP" }),
      h(
        "div",
        { class: "sheet-row-value" },
        h(
          "label",
          { class: "check" },
          prune,
          h("span", { class: "check-label", text: "Delete what the site no longer has" }),
        ),
        h("div", {
          class: "check-hint",
          text:
            "Right for a directory holding nothing but this site. Off by " +
            "default, because it is also how a neighbouring app's files go.",
        }),
      ),
    ),
  ];
}

// ── a repository ────────────────────────────────────────────────────────────

function githubRows(
  target: PublishTarget,
  settings: PublishSettings | null,
  onChange: (next: Partial<PublishTarget>) => void,
  openLogins: () => void,
): HTMLElement[] {
  const owner = field("Owner", settings?.github || "your account", target.owner);
  const repo = field("Repository", "my-game-site", target.repo);
  const branch = field("Branch", "gh-pages", target.branch);
  const path = field("Path", "the repository root, if empty", target.path);
  for (const [key, entry] of [
    ["owner", owner],
    ["repo", repo],
    ["branch", branch],
    ["path", path],
  ] as const) {
    entry.input.addEventListener("input", () => onChange({ [key]: entry.input.value }));
  }

  const signed = settings?.github
    ? h("div", { class: "sheet-row-value m", text: `Signed in as ${settings.github}` })
    : h("div", { class: "sheet-row-value m", text: "Not signed in to GitHub" });

  return [
    h(
      "div",
      { class: "sheet-row" },
      h("div", { class: "sheet-row-key m", text: "ACCOUNT" }),
      signed,
      h("button", {
        class: "btn btn-ghost",
        text: settings?.github ? "Change…" : "Sign in…",
        onClick: openLogins,
      }),
    ),
    owner.row,
    repo.row,
    branch.row,
    path.row,
    h("div", {
      class: "field-hint",
      text:
        "Publishing commits the site onto that branch — it does not rewrite " +
        "it — and everything at that path is replaced by what the site has. " +
        "gh-pages is the default because the alternative is the branch " +
        "holding your source.",
    }),
  ];
}
