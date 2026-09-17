/**
 * What is already published, beside what this project would publish — and the
 * chance to send some of it rather than all of it.
 *
 * **Two panes, in the order the question is asked.** Left is the far end as it
 * stands: the branch, or the directory on the server. Right is the site this
 * project builds, each file marked against what is over there. You read left
 * to right — *this is what is live, this is what I have* — and the ticks on the
 * right are the answer to *what should change*.
 *
 * A publish used to replace everything at the destination. That is the right
 * default and was the wrong only option, for two reasons that only show up
 * once: a file somebody put there by hand vanished without ever having been
 * shown to them, and there was no way to push one scene's fix without pushing
 * every asset again. So the panes came first, and the selection came with them.
 *
 * **The defaults are the old behaviour.** Everything that differs is ticked;
 * everything identical is not. Pressing Publish without reading a row does
 * what it always did, and the list is there for the times that is not what you
 * want.
 *
 * **Removals are the left pane's, and are off unless asked for.** A file at
 * the far end that the site no longer has is offered, not assumed — ticked to
 * begin with only when the destination says to tidy up. Deleting is the one
 * thing here that cannot be undone by publishing again.
 *
 * What a status means is `compare.rs`'s business, not this file's: **same** is
 * proved by a hash, and **unknown** is the honest answer for a file on a
 * server that the manifest has never heard of. Unknown is ticked, because
 * sending a file that did not need it costs a second and skipping one that did
 * costs a wrong site.
 */

import { clear, h } from "../lib/dom";
import { openSheet, type SheetHandle } from "../lib/sheet";
import {
  publish,
  type Comparison,
  type FileStatus,
  type LocalEntry,
  type RemoteEntry,
} from "../lib/ipc";
import * as log from "../lib/log";

/** Which statuses are ticked before anybody touches the list. */
const SEND_BY_DEFAULT: ReadonlySet<FileStatus> = new Set<FileStatus>([
  "new",
  "changed",
  "unknown",
]);

export interface ReviewOptions {
  projectId: string;
  /** The way back to the destination sheet, from the sheet's own head. */
  onChangeTarget: () => void;
}

export function openPublishReview(options: ReviewOptions): void {
  const sheet = openSheet({ title: "Publish", width: 900 });
  const body = h("div", { class: "publish-review" });
  sheet.body.appendChild(body);

  body.appendChild(h("div", { class: "publish-empty m", text: "Reading what is already there…" }));
  sheet.actions.appendChild(
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  void load(sheet, body, options);
}

async function load(
  sheet: SheetHandle,
  body: HTMLElement,
  options: ReviewOptions,
): Promise<void> {
  let comparison: Comparison;
  let prune = false;
  try {
    const [found, target] = await Promise.all([
      publish.compare(options.projectId),
      publish.target(options.projectId),
    ]);
    comparison = found;
    prune = target.prune ?? false;
  } catch (err) {
    clear(body);
    body.append(
      h("div", { class: "publish-note", text: String(err) }),
      h("button", {
        class: "btn btn-ghost",
        text: "Where this publishes…",
        onClick: () => {
          sheet.close();
          options.onChangeTarget();
        },
      }),
    );
    return;
  }

  draw(sheet, body, options, comparison, prune);
}

function draw(
  sheet: SheetHandle,
  body: HTMLElement,
  options: ReviewOptions,
  comparison: Comparison,
  prune: boolean,
): void {
  // The ticks. Held here rather than read off the checkboxes at the end, so a
  // re-render — All, None — does not lose what was already chosen.
  const sending = new Set(
    comparison.local.filter((f) => SEND_BY_DEFAULT.has(f.status)).map((f) => f.path),
  );
  const removing = new Set(
    prune ? comparison.remote.filter((f) => !f.inSite).map((f) => f.path) : [],
  );

  const left = h("div", { class: "publish-pane" });
  const right = h("div", { class: "publish-pane" });
  const action = h("button", { class: "btn btn-primary" }) as HTMLButtonElement;

  const render = () => {
    drawRemote(left, comparison, removing, render);
    drawLocal(right, comparison, sending, render);
    const count = sending.size + removing.size;
    action.textContent = count === 0 ? "Nothing to publish" : `Publish ${count}`;
    action.disabled = count === 0;
  };

  clear(body);
  body.append(
    h(
      "div",
      { class: "publish-review-head" },
      h("span", { class: "publish-destination", text: comparison.destination }),
      h("button", {
        class: "link-btn",
        type: "button",
        text: "Change…",
        onClick: () => {
          sheet.close();
          options.onChangeTarget();
        },
      }),
    ),
    ...(comparison.note ? [h("div", { class: "publish-note", text: comparison.note })] : []),
    h("div", { class: "publish-split" }, left, right),
  );
  render();

  clear(sheet.actions);
  sheet.actions.append(
    action,
    h("button", {
      class: "btn btn-ghost",
      title: "Say what would happen, and send nothing",
      text: "Check it first",
      onClick: () => {
        sheet.close();
        void send(options.projectId, comparison.destination, true, sending, removing);
      },
    }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
  action.onclick = () => {
    sheet.close();
    void send(options.projectId, comparison.destination, false, sending, removing);
  };
}

// ── the left pane: what is already there ────────────────────────────────────

function drawRemote(
  pane: HTMLElement,
  comparison: Comparison,
  removing: Set<string>,
  render: () => void,
): void {
  const gone = comparison.remote.filter((file) => !file.inSite);
  clear(pane);
  pane.appendChild(
    paneHead(
      "Already there",
      comparison.fresh
        ? "nothing yet"
        : `${comparison.remote.length} file${comparison.remote.length === 1 ? "" : "s"}`,
      // All / None only bears on the rows that have a box: the ones the site
      // has dropped. A control that appeared to select every remote file would
      // be offering to delete the site.
      gone.length
        ? {
            all: () => {
              gone.forEach((file) => removing.add(file.path));
              render();
            },
            none: () => {
              removing.clear();
              render();
            },
          }
        : null,
    ),
  );

  if (comparison.fresh) {
    pane.appendChild(
      h("div", {
        class: "publish-empty m",
        text: "Nothing is published here yet. Everything on the right is new.",
      }),
    );
    return;
  }

  const rows = h("div", { class: "publish-files scroll" });
  for (const file of comparison.remote) {
    rows.appendChild(remoteRow(file, removing, render));
  }
  pane.appendChild(rows);
  if (gone.length) {
    pane.appendChild(
      h("div", {
        class: "check-hint",
        text: `${gone.length} file${gone.length === 1 ? " is" : "s are"} no longer in the site. Ticking one removes it.`,
      }),
    );
  }
}

function remoteRow(file: RemoteEntry, removing: Set<string>, render: () => void): HTMLElement {
  // A box only where there is a decision. A file the site still has is about
  // to be dealt with by the right pane, and a tick here would be a second
  // opinion on the same file.
  const box = file.inSite
    ? h("span", { class: "check-box-gap" })
    : (h("input", {
        class: "check-box",
        type: "checkbox",
        checked: removing.has(file.path) ? "checked" : undefined,
        "aria-label": `Remove ${file.path}`,
        onChange: (event: Event) => {
          const on = (event.currentTarget as HTMLInputElement).checked;
          if (on) removing.add(file.path);
          else removing.delete(file.path);
          render();
        },
      }) as HTMLInputElement);

  return h(
    "label",
    { class: `publish-file${file.inSite ? "" : " dropped"}`, title: file.path },
    box,
    h("span", { class: "publish-file-name", text: file.path }),
    file.inSite
      ? h("span", { class: "publish-size m", text: bytes(file.size) })
      : h("span", { class: "publish-tag warn m", text: "not in site" }),
  );
}

// ── the right pane: what this project has ───────────────────────────────────

function drawLocal(
  pane: HTMLElement,
  comparison: Comparison,
  sending: Set<string>,
  render: () => void,
): void {
  const changed = comparison.local.filter((file) => file.status !== "same");
  clear(pane);
  pane.appendChild(
    paneHead(
      "This project",
      changed.length
        ? `${changed.length} of ${comparison.local.length} differ`
        : `${comparison.local.length} files, all identical`,
      {
        all: () => {
          comparison.local.forEach((file) => sending.add(file.path));
          render();
        },
        none: () => {
          sending.clear();
          render();
        },
      },
    ),
  );

  const rows = h("div", { class: "publish-files scroll" });
  for (const file of comparison.local) {
    rows.appendChild(localRow(file, sending, render));
  }
  pane.appendChild(rows);
}

function localRow(file: LocalEntry, sending: Set<string>, render: () => void): HTMLElement {
  const box = h("input", {
    class: "check-box",
    type: "checkbox",
    checked: sending.has(file.path) ? "checked" : undefined,
    "aria-label": `Publish ${file.path}`,
    onChange: (event: Event) => {
      const on = (event.currentTarget as HTMLInputElement).checked;
      if (on) sending.add(file.path);
      else sending.delete(file.path);
      render();
    },
  }) as HTMLInputElement;

  return h(
    "label",
    { class: `publish-file ${file.status}`, title: file.path },
    box,
    h("span", { class: "publish-file-name", text: file.path }),
    statusTag(file.status),
    h("span", { class: "publish-size m", text: bytes(file.size) }),
  );
}

/**
 * What a row is, in one word.
 *
 * *Same* gets no tag at all — most of a site is unchanged, and a column of
 * identical grey labels is a column nobody reads past. The words that mean
 * "look at this" are the ones that get one.
 */
function statusTag(status: FileStatus): HTMLElement | null {
  if (status === "same") return null;
  const said: Record<Exclude<FileStatus, "same">, string> = {
    new: "new",
    changed: "changed",
    unknown: "can't tell",
  };
  return h("span", { class: `publish-tag ${status} m`, text: said[status] });
}

// ── shared furniture ────────────────────────────────────────────────────────

function paneHead(
  title: string,
  count: string,
  bulk: { all: () => void; none: () => void } | null,
): HTMLElement {
  return h(
    "div",
    { class: "publish-pane-head" },
    h("span", { class: "publish-pane-title", text: title }),
    h("span", { class: "publish-pane-count m", text: count }),
    ...(bulk
      ? [
          h("button", { class: "link-btn", type: "button", text: "All", onClick: bulk.all }),
          h("button", { class: "link-btn", type: "button", text: "None", onClick: bulk.none }),
        ]
      : []),
  );
}

/**
 * Push, and say how it went in the console.
 *
 * The console rather than a sheet with a spinner, because that is where this
 * editor says everything else — and because a publish that takes a minute
 * behind a modal is a minute with nothing to read. The first line goes out
 * before the call, so the drawer says what is happening while it happens.
 */
async function send(
  projectId: string,
  where: string,
  dryRun: boolean,
  sending: Set<string>,
  removing: Set<string>,
): Promise<void> {
  const chosen = [...sending];
  const remove = [...removing];
  log.info(dryRun ? `Checking ${where}…` : `Publishing ${chosen.length} to ${where}…`);
  try {
    const report = await publish.toTarget(projectId, dryRun, chosen, remove);
    log.info(report.summary);
    if (report.log.trim()) log.info(report.log);
  } catch (err) {
    log.error(dryRun ? "That check failed:" : "Publishing failed:", err);
  }
}

/** A size, in the units a person reads. */
function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
