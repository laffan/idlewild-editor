/**
 * Who this device publishes as: **one list of logins**, GitHub accounts and
 * servers together.
 *
 * It is one list because they are one kind of thing. A publish needs a *login*
 * — an account with a token, a server with a key — and a *destination* — a
 * repository, a directory. The login belongs to the device and is entered
 * once; the destination belongs to the project. Splitting the sheets along
 * that seam rather than along "GitHub things / server things" is what keeps
 * the relationship legible: everything here is shared by every project, and
 * nothing here is about any one of them.
 *
 * So the rows interleave. A row is a login, whichever kind, with the same
 * shape: who it is, what it is for, and a way to change or forget it. The two
 * kinds differ only in what their popup asks for.
 *
 * **No secret is ever read back into this sheet.** Rust answers with names and
 * fingerprints and nothing else; signing in again is how a token is replaced,
 * and the row says whether there is one. A secret handed to a webview so a
 * field could be pre-filled is a secret in a webview's memory for as long as
 * the sheet is open, and nothing here needs one: both publishes run in Rust.
 *
 * **A GitHub login asks for a token and nothing else.** GitHub is asked whose
 * it is, which is one fewer box to type into and the difference between
 * finding out a token is bad now and finding out at the far end of a publish.
 *
 * **A server's key is imported, not pointed at.** That is what makes the iPad
 * work: there is no `~/.ssh` there to reference, and a file picked out of
 * Files hands back a security-scoped URL that is not readable again on the
 * next launch. So the picker's job is to name a file *once* — Rust reads it,
 * checks it parses, and keeps the key.
 *
 * **The host key is shown once there is one.** With its own SSH client the app
 * owns the check `ssh` would have done, and it is trust-on-first-use with no
 * terminal to ask at — so the fingerprint is put on the row afterwards, where
 * somebody can compare it against what the server says about itself. *Forget*
 * is the only way past one that has changed, and it is deliberately a separate
 * act rather than a button on the publish that failed.
 */

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { h } from "../lib/dom";
import { confirmSheet, openSheet } from "../lib/sheet";
import {
  publish,
  type GithubAccount,
  type PublishServer,
  type PublishSettings,
} from "../lib/ipc";
import * as log from "../lib/log";

/**
 * The sheet, over whatever opened it.
 *
 * `onChanged` is how the sheet that opened this one finds out a server
 * appeared or an account signed in: the destination sheet lists servers, and
 * one added here has to show up there without the project being reopened.
 */
export function openPublishAccounts(onChanged: () => void = () => {}): void {
  const sheet = openSheet({
    title: "Logins",
    subtitle: "shared by every project on this device",
    width: 640,
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
    const rows = [
      ...settings.accounts.map((account) => accountRow(account, reload, onChanged)),
      ...settings.servers.map((server) => serverRow(server, reload, onChanged)),
    ];
    body.replaceChildren(
      ...(rows.length
        ? rows
        : [
            h("div", {
              class: "field-hint",
              text:
                "Nothing yet. Add a GitHub account to publish to a repository, " +
                "or a server to publish over SSH. Either is shared by every " +
                "project on this device.",
            }),
          ]),
      addRow(reload, onChanged),
    );
  };
  void reload();
}

/** The two ways to add a login, on one row at the bottom of the list. */
function addRow(reload: () => void, onChanged: () => void): HTMLElement {
  return h(
    "div",
    { class: "sheet-row publish-add" },
    h("button", {
      class: "btn btn-ghost",
      text: "Add a GitHub account",
      onClick: () => void signIn(reload, onChanged),
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Add a server",
      onClick: () => void editServer(null, reload, onChanged),
    }),
  );
}

/** A signed-in GitHub account. */
function accountRow(
  account: GithubAccount,
  reload: () => void,
  onChanged: () => void,
): HTMLElement {
  return h(
    "div",
    { class: "sheet-row" },
    h("div", { class: "publish-kind m", text: "GITHUB" }),
    h(
      "div",
      { class: "sheet-row-value seg-stack" },
      h("span", { text: account.login }),
      h("span", { class: "check-hint", text: "Publishes to any repository this token can write" }),
    ),
    h("button", {
      class: "btn btn-ghost",
      title: "Replace this account's token",
      text: "New token",
      onClick: () => void signIn(reload, onChanged),
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Sign out",
      onClick: () => void signOut(account, reload, onChanged),
    }),
  );
}

/**
 * Sign in: one box.
 *
 * GitHub is asked whose the token is rather than the person being asked to
 * type a username the app could have looked up — and the lookup doubles as
 * the check that the token works at all.
 */
async function signIn(reload: () => void, onChanged: () => void): Promise<void> {
  const sheet = openSheet({
    title: "Add a GitHub account",
    subtitle: "a personal access token",
    width: 560,
  });
  const token = field("Token", "ghp_… or github_pat_…");
  token.input.type = "password";
  token.input.autocomplete = "off";
  const note = h("div", { class: "field-hint" });

  const submit = () => {
    note.textContent = "Asking GitHub whose token that is…";
    void publish
      .signInToGithub(token.input.value.trim())
      .then((account) => {
        sheet.close();
        log.info(`Signed in to GitHub as ${account.login}`);
        onChanged();
        reload();
      })
      .catch((err) => {
        note.textContent = String(err);
      });
  };
  token.input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") submit();
  });

  sheet.body.append(
    token.row,
    h("div", {
      class: "field-hint",
      text:
        "It needs Contents write on the repositories you publish to — a " +
        "fine-grained token has to list them explicitly. The token is kept on " +
        "this device, in a file only you can read, and is never sent anywhere " +
        "but github.com.",
    }),
    note,
  );
  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Sign in", onClick: submit }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
  token.input.focus();
}

async function signOut(
  account: GithubAccount,
  reload: () => void,
  onChanged: () => void,
): Promise<void> {
  const sure = await confirmSheet(
    `Sign out of ${account.login}?`,
    "The token is forgotten. Any project publishing as this account will need " +
      "another one.",
    "Sign out",
    false,
  );
  if (!sure) return;
  try {
    await publish.signOutOfGithub(account.id);
    onChanged();
    reload();
  } catch (err) {
    log.error("Could not sign out:", err);
  }
}

function serverRow(
  server: PublishServer,
  reload: () => void,
  onChanged: () => void,
): HTMLElement {
  const where = [
    server.user ? `${server.user}@${server.host}` : server.host,
    server.port ? `port ${server.port}` : "",
    server.hasKey ? `key: ${server.keySource || "imported"}` : "no key yet",
  ]
    .filter(Boolean)
    .join(" · ");

  return h(
    "div",
    { class: "sheet-row" },
    h("div", { class: "publish-kind m", text: "SERVER" }),
    h(
      "div",
      { class: "sheet-row-value seg-stack" },
      h("span", { text: server.label || server.host }),
      h("span", { class: "check-hint", text: where }),
      // The fingerprint, once there is one. On the row rather than behind a
      // disclosure, because the whole value of trust-on-first-use is that
      // somebody can check afterwards what was trusted.
      server.hostKey
        ? h("span", { class: "check-hint publish-fingerprint", text: server.hostKey })
        : h("span", { class: "check-hint", text: "Host key learned on the first publish." }),
    ),
    server.hostKey
      ? h("button", {
          class: "btn btn-ghost",
          title: "Trust whatever key this server offers next time",
          text: "Forget key",
          onClick: () => void forgetHostKey(server, reload, onChanged),
        })
      : null,
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
 * Stop insisting on the host key this server had.
 *
 * Asked about rather than done, and the question says what the two
 * possibilities are, because this is the one control here that can turn a
 * refused connection into a successful publish to the wrong machine.
 */
async function forgetHostKey(
  server: PublishServer,
  reload: () => void,
  onChanged: () => void,
): Promise<void> {
  const sure = await confirmSheet(
    `Forget the host key for ${server.host}?`,
    "The next publish will trust whatever answers on that address and record " +
      "it. Do this if you know the server was rebuilt — not to get past a " +
      "warning you were not expecting.",
    "Forget it",
    false,
  );
  if (!sure) return;
  try {
    await publish.forgetHostKey(server.id);
    onChanged();
    reload();
  } catch (err) {
    log.error("Could not forget the host key:", err);
  }
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
  const passphrase = field("Passphrase", "only if the key has one");
  passphrase.input.type = "password";
  passphrase.input.autocomplete = "off";

  // The path is held here rather than in a field: it is read once, on Save,
  // and what is kept afterwards is the key rather than the path. A box showing
  // a path that nothing will ever read again would be a box that lies.
  let keyFile: string | null = null;
  const keyState = h("div", {
    class: "sheet-row-value m",
    text: server?.hasKey
      ? `Using ${server.keySource || "an imported key"}`
      : "No key yet",
  });
  const keyRow = h(
    "div",
    { class: "sheet-row" },
    h("div", { class: "sheet-row-key m", text: "SSH KEY" }),
    keyState,
    h("button", {
      class: "btn btn-ghost",
      text: server?.hasKey ? "Replace…" : "Import…",
      onClick: () => {
        void openFileDialog({ multiple: false, pickerMode: "document" })
          .then((picked) => {
            if (typeof picked !== "string") return;
            keyFile = picked;
            keyState.textContent = `Importing ${picked.split("/").pop() ?? picked}`;
          })
          .catch((err) => log.error("Could not pick a key file:", err));
      },
    }),
  );

  sheet.body.append(
    label.row,
    host.row,
    user.row,
    port.row,
    keyRow,
    passphrase.row,
    h("div", {
      class: "field-hint",
      text:
        "Pick your private key — id_ed25519, not id_ed25519.pub — and its " +
        "public half needs to be in that account's authorized_keys already; " +
        "ssh-copy-id is the usual way. The key is copied onto this device so " +
        "it works on an iPad, where there is no ~/.ssh to read at publish time.",
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
            keyFile: keyFile ?? undefined,
            passphrase: passphrase.input.value || undefined,
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
