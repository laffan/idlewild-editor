/**
 * Who this install publishes as — the half that is not a project's.
 *
 * Entered once and shared by every project: the servers you have an ssh key
 * on, and the GitHub account your token is for. A project then says *which*
 * server and which repository, in `publish-where.ts`. That split is the whole
 * shape of the feature — log in once, then point each project somewhere — and
 * the alternative, a password box inside every project's publish sheet, is
 * what makes people export a zip and upload it by hand instead.
 *
 * **No secret is ever read back into this sheet.** Rust answers with the
 * account's name and nothing else; signing in again is how a token is
 * replaced, and the row says whether there is one. A token handed to a webview
 * so a field could be pre-filled is a token in a webview's memory for as long
 * as the sheet is open, and nothing here needs it: the publishes run in Rust.
 *
 * **rsync authenticates over ssh, and nothing here stores a password.** The
 * identity is a key — the agent's, or a file named on the row — and a server
 * that wants a password is refused rather than waited on. `ssh-copy-id` is the
 * answer everybody already has, and storing an ssh password would mean either
 * `sshpass` or writing one to disk.
 */

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { h } from "../lib/dom";
import { confirmSheet, openSheet } from "../lib/sheet";
import { publish, type PublishServer, type PublishSettings } from "../lib/ipc";
import * as log from "../lib/log";

/**
 * The sheet, over whatever opened it.
 *
 * `onChanged` is how the sheet that opened this one finds out a server
 * appeared or an account signed in: the destination sheet lists servers, and
 * one added here has to show up there without the project being reopened.
 */
export function openPublishLogins(onChanged: () => void = () => {}): void {
  const sheet = openSheet({
    title: "Servers and accounts",
    subtitle: "shared by every project on this device",
    width: 620,
  });

  const body = h("div");
  sheet.body.appendChild(body);
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Done", onClick: sheet.close }),
  );

  const reload = async () => {
    let settings: PublishSettings;
    try {
      settings = await publish.settings();
    } catch (err) {
      log.error("Could not read the publish settings:", err);
      return;
    }
    body.replaceChildren(
      ...(settings.canDeploy ? [] : [note(settings.reason)]),
      ...github(settings, reload, onChanged),
      ...servers(settings, reload, onChanged),
    );
  };
  void reload();
}

/**
 * A platform that cannot publish says so once, at the top.
 *
 * Shown rather than hiding the sheet: the settings are still worth typing on
 * an iPad — they are on the same device the project is on — and a sheet that
 * simply was not there would read as a feature that does not exist.
 */
function note(text: string): HTMLElement {
  return h("div", { class: "publish-note", text });
}

// ── GitHub ──────────────────────────────────────────────────────────────────

function github(
  settings: PublishSettings,
  reload: () => void,
  onChanged: () => void,
): HTMLElement[] {
  const heading = h("div", { class: "sheet-row-key m", text: "GITHUB" });

  if (settings.github) {
    return [
      h(
        "div",
        { class: "sheet-row" },
        heading,
        h("div", { class: "sheet-row-value", text: `Signed in as ${settings.github}` }),
        h("button", {
          class: "btn btn-ghost",
          text: "Sign out",
          onClick: () => {
            void publish
              .signOutOfGithub()
              .then(() => {
                onChanged();
                reload();
              })
              .catch((err) => log.error("Could not sign out:", err));
          },
        }),
      ),
    ];
  }

  const login = field("Account", "your GitHub username");
  const token = field("Token", "ghp_… or github_pat_…");
  token.input.type = "password";

  return [
    h("div", { class: "sheet-row" }, heading, h("div", { class: "sheet-row-value", text: "Not signed in" })),
    login.row,
    token.row,
    h(
      "div",
      { class: "publish-actions" },
      h(
        "div",
        { class: "field-hint" },
        h("span", {
          text:
            "A personal access token with Contents write on the repositories " +
            "you publish to. It is kept on this device, in a file only you can " +
            "read, and is never sent anywhere but github.com.",
        }),
      ),
      h("button", {
        class: "btn btn-primary",
        text: "Sign in",
        onClick: () => {
          void publish
            .signInToGithub(login.input.value.trim(), token.input.value.trim())
            .then(() => {
              onChanged();
              reload();
            })
            .catch((err) => log.error("Could not save the GitHub login:", err));
        },
      }),
    ),
  ];
}

// ── rsync servers ───────────────────────────────────────────────────────────

function servers(
  settings: PublishSettings,
  reload: () => void,
  onChanged: () => void,
): HTMLElement[] {
  const rows = settings.servers.map((server) => serverRow(server, reload, onChanged));
  return [
    h(
      "div",
      { class: "sheet-row" },
      h("div", { class: "sheet-row-key m", text: "SERVERS" }),
      h("div", {
        class: "sheet-row-value m",
        text: rows.length ? "" : "None yet — rsync publishes to one of these",
      }),
      h("button", {
        class: "btn btn-ghost",
        text: "Add a server",
        onClick: () => void editServer(null, reload, onChanged),
      }),
    ),
    ...rows,
  ];
}

function serverRow(
  server: PublishServer,
  reload: () => void,
  onChanged: () => void,
): HTMLElement {
  const where = [
    server.user ? `${server.user}@${server.host}` : server.host,
    server.port ? `port ${server.port}` : "",
    server.identityFile ? "key on file" : "agent key",
  ]
    .filter(Boolean)
    .join(" · ");

  return h(
    "div",
    { class: "sheet-row" },
    h("div", { class: "sheet-row-key m", text: server.label || server.host }),
    h("div", { class: "sheet-row-value m", text: where }),
    h("button", {
      class: "btn btn-ghost",
      text: "Edit",
      onClick: () => void editServer(server, reload, onChanged),
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Delete",
      onClick: () => void removeServer(server, reload, onChanged),
    }),
  );
}

/**
 * Add a server, or change one.
 *
 * A sheet of its own rather than fields in the row, because five of them do
 * not fit on a row and because a half-typed hostname that saved as you went
 * would be a server a project might be pointed at mid-edit.
 */
async function editServer(
  server: PublishServer | null,
  reload: () => void,
  onChanged: () => void,
): Promise<void> {
  const sheet = openSheet({
    title: server ? `Edit ${server.label || server.host}` : "Add a server",
    subtitle: "rsync over ssh",
    width: 560,
  });

  const label = field("Name", "Live", server?.label ?? "");
  const host = field("Host", "example.com", server?.host ?? "");
  const user = field("User", "your login on that server", server?.user ?? "");
  const port = field("Port", "22", server?.port ? String(server.port) : "");
  const key = field("Key file", "leave empty to use the ssh agent", server?.identityFile ?? "");

  const choose = h("button", {
    class: "btn btn-ghost",
    text: "Choose…",
    onClick: () => {
      void openFileDialog({ multiple: false, pickerMode: "document" })
        .then((picked) => {
          if (typeof picked === "string") key.input.value = picked;
        })
        .catch((err) => log.error("Could not pick a key file:", err));
    },
  });
  key.row.appendChild(choose);

  sheet.body.append(
    label.row,
    host.row,
    user.row,
    port.row,
    key.row,
    h("div", {
      class: "field-hint",
      text:
        "Publishing uses your ssh key — set one up with ssh-copy-id first. A " +
        "server that asks for a password is refused rather than waited on, so " +
        "a publish fails in a second instead of hanging.",
    }),
  );

  sheet.actions.append(
    h("button", {
      class: "btn btn-primary",
      text: "Save",
      onClick: () => {
        const parsed = Number(port.input.value.trim());
        void publish
          .saveServer({
            id: server?.id,
            label: label.input.value.trim(),
            host: host.input.value.trim(),
            user: user.input.value.trim(),
            port: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
            identityFile: key.input.value.trim() || undefined,
          })
          .then(() => {
            sheet.close();
            onChanged();
            reload();
          })
          .catch((err) => log.error("Could not save the server:", err));
      },
    }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  host.input.focus();
}

/**
 * Forget a server.
 *
 * The projects pointing at it keep a target naming an id nothing matches, and
 * a publish from one of those says so by name. Walking every project to blank
 * a field would be this sheet rewriting documents it has no business in, and
 * the failure it would prevent is one sentence.
 */
async function removeServer(
  server: PublishServer,
  reload: () => void,
  onChanged: () => void,
): Promise<void> {
  const sure = await confirmSheet(
    `Forget ${server.label || server.host}?`,
    "Any project publishing to it will need a new destination.",
    "Forget",
    false,
  );
  if (!sure) return;
  try {
    await publish.deleteServer(server.id);
    onChanged();
    reload();
  } catch (err) {
    log.error("Could not delete the server:", err);
  }
}

// ── one labelled input ──────────────────────────────────────────────────────

/** A row on the sheet's own grid: a label, and a box to type in. */
export function field(
  label: string,
  placeholder: string,
  value = "",
): { row: HTMLElement; input: HTMLInputElement } {
  const input = h("input", {
    class: "input",
    value,
    placeholder,
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
    "aria-label": label,
  }) as HTMLInputElement;
  const row = h(
    "div",
    { class: "sheet-row control" },
    h("div", { class: "sheet-row-key m", text: label.toUpperCase() }),
    h("div", { class: "sheet-row-value" }, input),
  );
  return { row, input };
}
