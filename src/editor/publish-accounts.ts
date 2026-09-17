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
 * **Drawn as a settings list rather than in the app's own design system.** See
 * `styles/options.css` for what that departs on and why — rounded groups,
 * sentence case, two lines to a row. This page is the first thing built on
 * that vocabulary and is meant not to be the last, so nothing here styles
 * anything: it hands `lib/options-list.ts` rows and gets a page back. A second
 * options page should be able to copy the *shape* of this file and share none
 * of its content.
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
 * **The keys are offered rather than hunted for.** They live in `~/.ssh`, a
 * directory starting with a dot, and macOS's open panel hides those — there is
 * a keystroke, ⇧⌘., and it is not something anybody should have to know to
 * publish a website. So `ssh_keys::list_ssh_keys` lists what is there and the
 * sheet shows them as a menu; the file dialog stays for a key kept elsewhere,
 * and opens *inside* `~/.ssh` when there is one.
 *
 * **A server can be tried before it is saved.** A row that has never been
 * tried looks exactly like one that works, and the first time anybody finds
 * out otherwise used to be in the middle of a publish — where reaching the
 * host, the host key, the key being accepted, SFTP starting and the directory
 * existing are five different failures that all read as "publishing is
 * broken". Test does those five and says which one stopped.
 *
 * **The host key is shown once there is one.** With its own SSH client the app
 * owns the check `ssh` would have done, and it is trust-on-first-use with no
 * terminal to ask at — so the fingerprint is put on the row afterwards, where
 * somebody can compare it against what the server says about itself. *Forget*
 * is the only way past one that has changed, and it is deliberately a separate
 * act rather than a button on the publish that failed.
 */

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { h, ICONS } from "../lib/dom";
import { openMenu } from "../lib/menu";
import { confirmSheet, openSheet } from "../lib/sheet";
import {
  optionAddRow,
  optionField,
  optionGroup,
  optionNotice,
  optionRow,
  optionsForm,
  optionsPage,
} from "../lib/options-list";
import {
  publish,
  type GithubAccount,
  type PublishServer,
  type PublishSettings,
  type SshKey,
} from "../lib/ipc";
import * as log from "../lib/log";

/**
 * The sheet, over whatever opened it.
 *
 * `onChanged` is how the sheet that opened this one finds out a login appeared:
 * the destination sheet lists them, and one added here has to show up there
 * without the project being reopened.
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
    const again = () => void reload();
    body.replaceChildren(
      optionsPage([
        optionGroup({
          title: "GitHub",
          note:
            "A personal access token with Contents write on the repositories " +
            "you publish to. Kept on this device, in a file only you can read.",
          rows: [
            ...settings.accounts.map((account) => accountRow(account, again, onChanged)),
            optionAddRow("Add an account", () => void signIn(again, onChanged)),
          ],
        }),
        optionGroup({
          title: "Servers",
          note:
            "Publishing uses your ssh key. Its public half needs to be in the " +
            "account's authorized_keys already — ssh-copy-id is the usual way.",
          rows: [
            ...settings.servers.map((server) => serverRow(server, again, onChanged)),
            optionAddRow("Add a server", () => void editServer(null, again, onChanged)),
          ],
        }),
      ]),
    );
  };
  void reload();
}

// ── GitHub ──────────────────────────────────────────────────────────────────

function accountRow(
  account: GithubAccount,
  reload: () => void,
  onChanged: () => void,
): HTMLElement {
  return optionRow({
    title: account.login,
    sub: "Publishes to any repository this token can write to",
    glyph: ICONS.code,
    actions: [
      {
        label: "New token",
        title: "Replace this account's token",
        onSelect: () => void signIn(reload, onChanged),
      },
      {
        label: "Sign out",
        danger: true,
        onSelect: () => void signOut(account, reload, onChanged),
      },
    ],
  });
}

/**
 * Sign in: one box.
 *
 * GitHub is asked whose the token is rather than the person being asked to
 * type a username the app could have looked up — and the lookup doubles as the
 * check that the token works at all, which is why the notice says what it is
 * doing rather than the sheet simply closing.
 */
async function signIn(reload: () => void, onChanged: () => void): Promise<void> {
  const sheet = openSheet({
    title: "Add a GitHub account",
    subtitle: "a personal access token",
    width: 560,
  });
  const notice = optionNotice();

  const submit = () => {
    notice.textContent = "Asking GitHub whose token that is…";
    void publish
      .signInToGithub(token.input.value.trim())
      .then((account) => {
        sheet.close();
        log.info(`Signed in to GitHub as ${account.login}`);
        onChanged();
        reload();
      })
      .catch((err) => {
        notice.textContent = String(err);
      });
  };

  const token = optionField({
    label: "Token",
    placeholder: "ghp_… or github_pat_…",
    secret: true,
    hint:
      "A fine-grained token has to list the repositories you publish to " +
      "explicitly, and needs Contents write on them. It is never sent " +
      "anywhere but github.com.",
    onSubmit: submit,
  });

  sheet.body.appendChild(optionsForm(token.root, notice));
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

// ── servers ─────────────────────────────────────────────────────────────────

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

  return optionRow({
    title: server.label || server.host,
    // The fingerprint on the row rather than behind a disclosure: the whole
    // value of trust-on-first-use is that somebody can check afterwards what
    // was trusted, and a fact nobody is shown is a check nobody makes.
    sub: [
      where,
      {
        text: server.hostKey || "Host key learned on the first publish.",
        mono: !!server.hostKey,
      },
    ],
    glyph: ICONS.publish,
    actions: [
      ...(server.hostKey
        ? [
            {
              label: "Forget key",
              title: "Trust whatever key this server offers next time",
              onSelect: () => void forgetHostKey(server, reload, onChanged),
            },
          ]
        : []),
      { label: "Edit", onSelect: () => void editServer(server, reload, onChanged) },
      {
        label: "Delete",
        danger: true,
        onSelect: () => void removeServer(server, reload, onChanged),
      },
    ],
  });
}

/**
 * Add a server, or change one.
 *
 * A sheet of its own rather than fields in the row, because five of them do not
 * fit on a row and because a half-typed hostname that saved as you went would
 * be a server a project might be pointed at mid-edit.
 */
async function editServer(
  server: PublishServer | null,
  reload: () => void,
  onChanged: () => void,
): Promise<void> {
  const sheet = openSheet({
    title: server ? `Edit ${server.label || server.host}` : "Add a server",
    subtitle: "published to over SSH",
    width: 560,
  });

  const label = optionField({ label: "Name", placeholder: "Live", value: server?.label ?? "" });
  const host = optionField({ label: "Host", placeholder: "example.com", value: server?.host ?? "" });
  const user = optionField({
    label: "User",
    placeholder: "your login on that server",
    value: server?.user ?? "",
  });
  const port = optionField({
    label: "Port",
    placeholder: "22",
    value: server?.port ? String(server.port) : "",
  });

  // The key path is held here rather than in a field: it is read once, on
  // Save, and what is kept afterwards is the key rather than the path. A box
  // showing a path that nothing will ever read again would be a box that lies.
  let keyFile: string | null = null;
  // Read once when the sheet opens. An empty answer is an iPad, or a machine
  // with no `~/.ssh` — both mean the file dialog is the only route, which is
  // what it already was there.
  let found: SshKey[] = [];

  const take = (path: string) => {
    keyFile = path;
    key.input.value = `Importing ${path.split("/").pop() ?? path}`;
  };

  const browse = () => {
    void openFileDialog({
      multiple: false,
      pickerMode: "document",
      // Open *inside* `~/.ssh` when there is one, so even the dialog route
      // starts somewhere the keys are visible.
      defaultPath: found[0]?.path.replace(/\/[^/]+$/, "") || undefined,
    })
      .then((picked) => {
        if (typeof picked === "string") take(picked);
      })
      .catch((err) => log.error("Could not pick a key file:", err));
  };

  const key = optionField({
    label: "SSH key",
    value: server?.hasKey ? `Using ${server.keySource || "an imported key"}` : "",
    placeholder: "no key yet",
    hint:
      "Your private key — id_ed25519, not id_ed25519.pub. It is copied onto " +
      "this device so it works on an iPad, where there is no ~/.ssh to read at " +
      "publish time.",
    button: {
      label: server?.hasKey ? "Replace…" : "Choose…",
      onSelect: () => {
        const button = key.root.querySelector("button") as HTMLElement;
        // Straight to the dialog where there is nothing to offer: a menu whose
        // only item is "Browse…" is a menu that wastes a press.
        if (!found.length) {
          browse();
          return;
        }
        openMenu(button, [
          ...found.map((candidate) => ({
            label: candidate.hasPublic ? candidate.name : `${candidate.name} (no .pub)`,
            onSelect: () => take(candidate.path),
          })),
          { label: "Browse…", onSelect: browse },
        ]);
      },
    },
  });
  // Named by the file it came from, not typed into.
  key.input.readOnly = true;

  void publish
    .sshKeys()
    .then((keys) => {
      found = keys;
    })
    .catch(() => {
      found = [];
    });

  const passphrase = optionField({
    label: "Passphrase",
    placeholder: "only if the key has one",
    secret: true,
  });

  /**
   * A directory to check, which is not saved anywhere.
   *
   * The destination is a project's, not a server's — see `publish-setup.ts` —
   * so this box exists only for Test to have something to look for. Checking a
   * login without checking it can reach anything is half a test, and "does
   * that directory exist" is the failure that cost the most to diagnose.
   */
  const directory = optionField({
    label: "Directory to check",
    placeholder: "/var/www/example.com — optional, not saved",
    value: "",
  });
  const notice = optionNotice();

  /**
   * Try the details as they stand, without saving them.
   *
   * The whole point is *before* saving: a bad hostname saved is a server row
   * that looks like every other one. What comes back is the five steps it got
   * through, so a failure names the one that stopped rather than the publish.
   */
  const test = () => {
    const parsed = Number(port.input.value.trim());
    notice.textContent = `Connecting to ${host.input.value.trim() || "…"}`;
    void publish
      .testServer({
        id: server?.id,
        host: host.input.value.trim(),
        user: user.input.value.trim(),
        port: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
        keyFile: keyFile ?? undefined,
        passphrase: passphrase.input.value || undefined,
        directory: directory.input.value.trim() || undefined,
      })
      .then((report) => {
        notice.textContent = `${report.summary}\n${report.log}`;
      })
      .catch((err) => {
        notice.textContent = String(err);
      });
  };

  const save = () => {
    const parsed = Number(port.input.value.trim());
    notice.textContent = "";
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
      .catch((err) => {
        notice.textContent = String(err);
      });
  };

  sheet.body.appendChild(
    optionsForm(
      label.root,
      host.root,
      user.root,
      port.root,
      key.root,
      passphrase.root,
      directory.root,
      notice,
    ),
  );
  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Save", onClick: save }),
    h("button", {
      class: "btn btn-ghost",
      title: "Connect with these details and say what happened",
      text: "Test",
      onClick: test,
    }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
  host.input.focus();
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
