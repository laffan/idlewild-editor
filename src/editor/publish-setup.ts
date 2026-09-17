/**
 * Where this project publishes to — the two destinations, side by side.
 *
 * **Two columns because there are two answers**, and the shape of the sheet is
 * the shape of the choice: GitHub on the left, a server on the right, one of
 * them lit. There is no *Nowhere*: a project that publishes nowhere is a
 * project that has not opened this sheet, and offering it as a third option
 * would be offering somebody the state they are already in.
 *
 * ## The relationship this sheet has to keep clear
 *
 * Publishing is made of two things that change at different rates, and
 * confusing them is the whole way this gets hard to use:
 *
 * - A **login** belongs to the device and is entered once — a GitHub account,
 *   a server you have a key on. That is `publish-accounts.ts`, reached from
 *   either column and shared by every project.
 * - A **destination** belongs to the project — which repository, which
 *   directory. That is this sheet.
 *
 * So each column is laid out as *login → destination*, top to bottom, and the
 * login half is the same control on both sides: a picker of things this device
 * already knows, with a way through to the list that manages them. A column
 * with no login yet shows the way through and nothing else, because a
 * repository picker for an account that does not exist is a box that can only
 * disappoint.
 *
 * ## Why the repositories are searched rather than typed
 *
 * `owner` and `repo` were two text fields. A name typed from memory is a name
 * typed wrong, and the failure arrived at the far end of a network round trip
 * as a 404. The token can already see every repository it can write to, so the
 * list is fetched and searched — see `lib/fuzzy.ts` for why the matching is a
 * subsequence rather than a substring, and why the score rewards what it does.
 *
 * Whatever was already typed lives in the target object rather than in the
 * inputs, so switching between the two columns does not lose the other one's
 * answers: a project that was a server and is now GitHub still has its
 * directory, and switching back is switching back.
 */

import { h, ICONS, icon } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import {
  publish,
  type GithubAccount,
  type GithubRepo,
  type PublishServer,
  type PublishSettings,
} from "../lib/ipc";
import { EMPTY_TARGET, type PublishTarget } from "../lib/publish-target";
import { fuzzyRank, highlight } from "../lib/fuzzy";
import { openMenu } from "../lib/menu";
import * as log from "../lib/log";
import { optionField } from "../lib/options-list";
import { openPublishAccounts } from "./publish-accounts";

/**
 * Open the sheet. `onSaved` is how whatever opened it finds out there is a
 * destination now — the Publish sheet turns into the review screen on it.
 */
export function openPublishSetup(
  projectId: string,
  onSaved: (target: PublishTarget) => void = () => {},
): void {
  const sheet = openSheet({
    title: "Publish to",
    subtitle: "the login is shared by every project; the destination is this one's",
    width: 860,
  });

  let target: PublishTarget = { ...EMPTY_TARGET };
  let settings: PublishSettings | null = null;
  /** Repositories per account, once fetched. A sheet's worth of cache. */
  const repos = new Map<string, GithubRepo[]>();
  /** Branches per `owner/repo`, likewise. */
  const branches = new Map<string, string[]>();
  let loading = "";

  const columns = h("div", { class: "publish-split" });
  sheet.body.appendChild(columns);

  const save = h("button", {
    class: "btn btn-primary",
    text: "Use this",
    onClick: () => {
      void publish
        .saveTarget(projectId, target)
        .then(() => {
          sheet.close();
          onSaved(target);
        })
        .catch((err) => log.error("Could not save the publish target:", err));
    },
  }) as HTMLButtonElement;
  sheet.actions.append(
    save,
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  /**
   * Take a value without redrawing.
   *
   * **Typing must not re-render.** Every field used to go through the same
   * handler as the pickers, which rebuilt both columns — so the input the
   * caret was in was replaced by a new one on every keystroke, and the caret
   * went with it. The Branch box lost focus after each character.
   *
   * Nothing a field can change alters the *shape* of the sheet, so nothing a
   * field changes needs a redraw. The only thing that has to follow a
   * keystroke is whether Use this is available.
   */
  const set = (next: Partial<PublishTarget>) => {
    target = { ...target, ...next };
    save.disabled = !ready(target);
  };

  /** Take a value that *does* change the shape: a kind, an account, a repo. */
  const choose = (next: Partial<PublishTarget>) => {
    set(next);
    draw();
  };

  const toAccounts = () => {
    // A login added in there has to appear in here without the project being
    // reopened, which is what the callback is for.
    openPublishAccounts(() => void refresh());
  };

  const draw = () => {
    columns.replaceChildren(
      githubColumn({
        target,
        accounts: settings?.accounts ?? [],
        repos,
        branches,
        loading,
        onChoose: choose,
        onEdit: set,
        onAccounts: toAccounts,
        onNeedRepos: (id) => void fetchRepos(id),
        onNeedBranches: (accountId, owner, repo) =>
          void fetchBranches(accountId, owner, repo),
      }),
      serverColumn({
        target,
        servers: settings?.servers ?? [],
        onChoose: choose,
        onEdit: set,
        onAccounts: toAccounts,
      }),
    );
    save.disabled = !ready(target);
  };

  const fetchRepos = async (accountId: string) => {
    if (repos.has(accountId) || loading === accountId) return;
    loading = accountId;
    draw();
    try {
      repos.set(accountId, await publish.repos(accountId));
    } catch (err) {
      log.error("Could not list repositories:", err);
      repos.set(accountId, []);
    }
    loading = "";
    draw();
  };

  /**
   * The branches a repository has.
   *
   * Failing is not an error anybody needs told about: the branch box works
   * without the list — it is a text field, and a name that is not there is a
   * branch the publish creates — so a token that cannot read branches costs
   * the menu and nothing else.
   */
  const fetchBranches = async (accountId: string, owner: string, repo: string) => {
    const key = `${owner}/${repo}`;
    if (branches.has(key)) return;
    branches.set(key, []);
    try {
      branches.set(key, await publish.branches(accountId, owner, repo));
    } catch {
      branches.set(key, []);
    }
    draw();
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

/** Whether there is enough here to publish with. */
function ready(target: PublishTarget): boolean {
  if (target.kind === "github") return !!target.owner && !!target.repo;
  if (target.kind === "rsync") return !!target.server && !!target.directory.trim();
  return false;
}

// ── GitHub ──────────────────────────────────────────────────────────────────

interface GithubColumn {
  target: PublishTarget;
  accounts: GithubAccount[];
  repos: Map<string, GithubRepo[]>;
  /** Branches per `owner/repo`, for the branch box to offer. */
  branches: Map<string, string[]>;
  loading: string;
  /** A pick that changes the sheet's shape, and redraws it. */
  onChoose: (next: Partial<PublishTarget>) => void;
  /** A typed value, which must not redraw — see `set` in `openPublishSetup`. */
  onEdit: (next: Partial<PublishTarget>) => void;
  onAccounts: () => void;
  onNeedRepos: (accountId: string) => void;
  onNeedBranches: (accountId: string, owner: string, repo: string) => void;
}

function githubColumn(state: GithubColumn): HTMLElement {
  const { target, accounts } = state;
  const active = target.kind === "github";
  const column = side("GitHub", "a branch of a repository", active);

  if (!accounts.length) {
    column.append(
      empty("No GitHub account on this device yet."),
      h("button", {
        class: "btn btn-primary",
        text: "Login",
        onClick: state.onAccounts,
      }),
    );
    return column;
  }

  // Which account. One is not a choice, so it is stated rather than offered.
  const accountId = target.account || accounts[0].id;
  column.appendChild(
    accounts.length === 1
      ? loginLine(`Signed in as ${accounts[0].login}`, state.onAccounts)
      : chooser(
          accounts.map((account) => ({
            id: account.id,
            label: account.login,
            active: account.id === accountId,
          })),
          (id) => state.onChoose({ kind: "github", account: id, owner: "", repo: "" }),
          state.onAccounts,
        ),
  );

  const list = state.repos.get(accountId);
  if (!list) {
    state.onNeedRepos(accountId);
    column.appendChild(
      empty(state.loading === accountId ? "Asking GitHub…" : "Reading your repositories…"),
    );
    return column;
  }
  if (!list.length) {
    column.append(
      empty("That token cannot see any repositories."),
      h("button", { class: "btn btn-ghost", text: "Logins…", onClick: state.onAccounts }),
    );
    return column;
  }

  column.appendChild(
    repoPicker(list, target, (repo) =>
      state.onChoose({
        kind: "github",
        account: accountId,
        owner: repo.owner,
        repo: repo.name,
      }),
    ),
  );

  if (active && target.repo) {
    state.onNeedBranches(accountId, target.owner, target.repo);
    column.appendChild(
      githubFields(target, state.onEdit, state.branches.get(`${target.owner}/${target.repo}`)),
    );
  }
  return column;
}

/**
 * The searchable list.
 *
 * Its own input, filtered as you type, rather than a `select`: a `select` of
 * two hundred repositories is a scroll, and the whole reason this is a list
 * rather than two text fields is that nobody remembers which of `-` and `_`
 * they used.
 */
function repoPicker(
  repos: GithubRepo[],
  target: PublishTarget,
  onPick: (repo: GithubRepo) => void,
): HTMLElement {
  const rows = h("div", { class: "publish-list scroll" });
  const search = h("input", {
    class: "input publish-search",
    type: "search",
    placeholder: "Search repositories",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
    "aria-label": "Search repositories",
    onInput: (event: Event) => render((event.currentTarget as HTMLInputElement).value),
  }) as HTMLInputElement;

  const chosen = target.kind === "github" ? `${target.owner}/${target.repo}` : "";
  const render = (query: string) => {
    const ranked = fuzzyRank(repos, query, (repo) => repo.fullName);
    rows.replaceChildren(
      ...(ranked.length
        ? ranked.map(({ item, match }) =>
            repoRow(item, match.hits, item.fullName === chosen, onPick),
          )
        : [empty("Nothing matches that.")]),
    );
  };
  render("");

  return h("div", { class: "publish-picker" }, search, rows);
}

function repoRow(
  repo: GithubRepo,
  hits: readonly number[],
  active: boolean,
  onPick: (repo: GithubRepo) => void,
): HTMLElement {
  // The matched letters, as elements with their text set — a repository name
  // is text off the network and never becomes markup. See `lib/fuzzy.ts`.
  const name = h("span", { class: "publish-row-name" });
  for (const piece of highlight(repo.fullName, hits)) {
    name.appendChild(
      piece.hit
        ? h("mark", { class: "fuzzy-hit", text: piece.text })
        : document.createTextNode(piece.text),
    );
  }

  const marks: HTMLElement[] = [];
  if (repo.private) marks.push(h("span", { class: "publish-tag m", text: "private" }));
  // Shown and refused rather than hidden: a repository somebody can see and
  // cannot write to is one they will look for, and an empty list is a worse
  // answer than a row that says why.
  if (!repo.canPush) marks.push(h("span", { class: "publish-tag warn m", text: "read only" }));

  return h(
    "button",
    {
      class: `publish-row${active ? " active" : ""}${repo.canPush ? "" : " disabled"}`,
      type: "button",
      disabled: repo.canPush ? undefined : "true",
      title: repo.canPush ? repo.fullName : `${repo.fullName} — this token cannot write to it`,
      onClick: () => onPick(repo),
    },
    name,
    ...marks,
  );
}

/**
 * Branch and path: the part of a GitHub destination that is the project's.
 *
 * **The branch box offers and accepts.** Existing branches are on a menu
 * beside it, because a typo in a branch name is the least visible mistake here
 * — publishing to `gh_pages` *succeeds*, it makes the branch, and then nothing
 * is where anybody looks for it. And a name that is not on the list is not
 * refused: starting a branch by naming one is how you publish to a fresh
 * `gh-pages`, and the line under the box says which of the two is about to
 * happen rather than leaving it to be found out.
 */
function githubFields(
  target: PublishTarget,
  onEdit: (next: Partial<PublishTarget>) => void,
  branches: string[] | undefined,
): HTMLElement {
  const known = branches ?? [];
  const note = h("div", { class: "field-hint" });

  const branch = optionField({
    label: "Branch",
    placeholder: "gh-pages",
    value: target.branch,
    ...(known.length
      ? {
          button: {
            label: "Branches",
            onSelect: () =>
              openMenu(
                branch.root.querySelector("button") as HTMLElement,
                known.map((name) => ({
                  label: name,
                  onSelect: () => {
                    branch.input.value = name;
                    onEdit({ branch: name });
                    say();
                  },
                })),
              ),
          },
        }
      : {}),
  });

  /**
   * Whether the branch named is one that exists. Written on every keystroke
   * rather than by redrawing, because redrawing is what takes the caret out of
   * the box — see `set` in `openPublishSetup`.
   */
  const say = () => {
    const name = branch.input.value.trim() || "gh-pages";
    if (!known.length) {
      note.textContent =
        "Publishing commits onto that branch — it does not rewrite it. A branch " +
        "that does not exist yet is created by the first publish.";
      return;
    }
    note.textContent = known.includes(name)
      ? `${name} exists. Publishing commits onto it — it does not rewrite it.`
      : `${name} does not exist yet. The first publish starts it.`;
  };

  const path = optionField({
    label: "Path",
    placeholder: "the repository root, if empty",
    value: target.path,
  });
  branch.input.addEventListener("input", () => {
    onEdit({ branch: branch.input.value });
    say();
  });
  path.input.addEventListener("input", () => onEdit({ path: path.input.value }));
  say();

  return h("div", { class: "publish-fields" }, branch.root, path.root, note);
}

// ── a server ────────────────────────────────────────────────────────────────

interface ServerColumn {
  target: PublishTarget;
  servers: PublishServer[];
  onChoose: (next: Partial<PublishTarget>) => void;
  onEdit: (next: Partial<PublishTarget>) => void;
  onAccounts: () => void;
}

function serverColumn(state: ServerColumn): HTMLElement {
  const { target, servers } = state;
  const active = target.kind === "rsync";
  const column = side("Server", "a directory, over SSH", active);

  if (!servers.length) {
    column.append(
      empty("No server on this device yet."),
      h("button", {
        class: "btn btn-primary",
        text: "Add Server",
        onClick: state.onAccounts,
      }),
    );
    return column;
  }

  const rows = h(
    "div",
    { class: "publish-list scroll" },
    ...servers.map((server) =>
      h(
        "button",
        {
          class: `publish-row${active && server.id === target.server ? " active" : ""}`,
          type: "button",
          title: server.host,
          onClick: () => state.onChoose({ kind: "rsync", server: server.id }),
        },
        h("span", { class: "publish-row-name", text: server.label || server.host }),
        server.hasKey
          ? null
          : h("span", { class: "publish-tag warn m", text: "no key" }),
      ),
    ),
  );

  column.append(
    h("div", { class: "publish-picker" }, rows),
    loginLine(`${servers.length} bookmarked`, state.onAccounts),
  );
  if (active && target.server) column.appendChild(serverFields(target, state.onEdit));
  return column;
}

/** The directory, and whether a publish may tidy up after itself. */
function serverFields(
  target: PublishTarget,
  onEdit: (next: Partial<PublishTarget>) => void,
): HTMLElement {
  const directory = optionField({
    label: "Directory",
    placeholder: "/var/www/example.com",
    value: target.directory,
  });
  directory.input.addEventListener("input", () =>
    onEdit({ directory: directory.input.value }),
  );
  const prune = h("input", {
    class: "check-box",
    type: "checkbox",
    checked: target.prune ? "checked" : undefined,
    onChange: (event: Event) =>
      onEdit({ prune: (event.currentTarget as HTMLInputElement).checked }),
  }) as HTMLInputElement;

  return h(
    "div",
    { class: "publish-fields" },
    directory.root,
    h(
      "label",
      { class: "check" },
      prune,
      h("span", { class: "check-label", text: "Offer to delete what the site drops" }),
    ),
    h("div", {
      class: "field-hint",
      text:
        "Publishing lists what is there beside what is here, and sends what " +
        "you tick. With this on, files at the far end that the site no longer " +
        "has are offered for removal too.",
    }),
  );
}

// ── the furniture both columns share ────────────────────────────────────────

/** One half of the split, lit when it is the one in force. */
function side(title: string, hint: string, active: boolean): HTMLElement {
  return h(
    "div",
    { class: `publish-side${active ? " active" : ""}` },
    h(
      "div",
      { class: "publish-side-head" },
      icon(title === "GitHub" ? ICONS.code : ICONS.publish, 16),
      h("span", { class: "publish-side-title", text: title }),
      h("span", { class: "publish-side-hint m", text: hint }),
    ),
  );
}

/** A line naming the login in force, with the way through to the list. */
function loginLine(text: string, onAccounts: () => void): HTMLElement {
  return h(
    "div",
    { class: "publish-login" },
    h("span", { class: "m", text }),
    h("button", { class: "link-btn", type: "button", text: "Logins…", onClick: onAccounts }),
  );
}

/** Several logins of one kind, as a row of choices. */
function chooser(
  options: Array<{ id: string; label: string; active: boolean }>,
  onPick: (id: string) => void,
  onAccounts: () => void,
): HTMLElement {
  return h(
    "div",
    { class: "publish-login" },
    h(
      "div",
      { class: "seg" },
      ...options.map((option) =>
        h("button", {
          class: "seg-opt",
          type: "button",
          text: option.label,
          "aria-pressed": String(option.active),
          onClick: () => onPick(option.id),
        }),
      ),
    ),
    h("button", { class: "link-btn", type: "button", text: "Logins…", onClick: onAccounts }),
  );
}

function empty(text: string): HTMLElement {
  return h("div", { class: "publish-empty m", text });
}
