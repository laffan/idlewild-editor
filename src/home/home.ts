/**
 * Home screen: the project list. A card per project showing its current
 * state as a thumbnail; long-press for rename and delete; Select, Import and
 * New Project top right.
 *
 * **Import** reads a `.idlewild` file — the archive Export's *Project* row
 * writes — back in as a project of its own. It lands in the list like any
 * other, with a fresh id, because an id is a fact about this install's store
 * rather than about the project.
 *
 * It was called **Open** for as long as it has existed, and that was the wrong
 * word on this screen. A grid of project cards is already a screen about
 * opening things, so Open read as "open one of these" and the way *in* for a
 * backup was the one door nobody found. Import is what the person is looking
 * for, and it pairs with the editor's own **Import Assets**: one brings a
 * project in, the other brings artwork into the project you are in.
 *
 * **Select** is a mode of the grid rather than a modifier on a press. There is
 * no ⌘-click on an iPad and no rubber band over a grid of cards, so the honest
 * shape is a switch: while it is on, a tap picks a card instead of opening it,
 * the long-press menu stands down, and the row that normally says how to reach
 * that menu carries Duplicate and Delete instead. What those two do is
 * `home-select.ts`; the mode itself is here, because it is a fact about how this
 * screen reads a press.
 */

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { clear, h, ICONS, icon } from "../lib/dom";
import { onLongPress } from "../lib/gestures";
import { platform, projects } from "../lib/ipc";
import { isMobile } from "../lib/platform";
import { confirmSheet, openSheet } from "../lib/sheet";
import type { ProjectMeta } from "../lib/types";
import * as log from "../lib/log";
import {
  deleteProjects,
  describeCount,
  duplicateProjects,
} from "./home-select";
import { openNewProject } from "./new-project";

export interface HomeCallbacks {
  onOpenProject: (meta: ProjectMeta) => void;
}

export function renderHome(
  container: HTMLElement,
  callbacks: HomeCallbacks,
): void {
  const count = h("div", { class: "home-count m" });
  const grid = h("div", { class: "project-grid" });

  // What the row above the grid says. Off, it is how to reach a card's own
  // menu; on, it is what the cards you have picked can be done to — the same
  // strip of screen either way, so turning the mode on does not move the grid
  // under the finger that turned it on.
  const hint = h("div", {
    class: "home-hint m",
    text: "Long-press a card to rename or delete",
  });
  const tally = h("div", { class: "home-hint m" });
  const actions = h("div", { class: "home-actions hidden" });

  const body = h(
    "div",
    { class: "home-body scroll" },
    h("div", { class: "home-hint-row" }, hint, actions),
    grid,
  );

  /** Which projects are picked, and what is listed, so All has a set to take. */
  const picked = new Set<string>();
  let listed: ProjectMeta[] = [];
  let selecting = false;

  const selectButton = h(
    "button",
    {
      class: "btn btn-ghost push-right",
      "aria-pressed": "false",
      title: "Pick several projects to duplicate or delete",
      onClick: () => setSelecting(!selecting),
    },
    icon(ICONS.select, 17),
    h("span", { text: "Select" }),
  ) as HTMLButtonElement;

  const importButton = h(
    "button",
    {
      class: "btn btn-ghost",
      title: "Import a project from a .idlewild or .zip backup",
      onClick: () => void importProject(),
    },
    // The same glyph as the editor's Import Assets, because they are the same
    // verb at two scales — a door inward, for a project or for artwork.
    icon(ICONS.folder, 17),
    h("span", { text: "Import" }),
  );

  const duplicateButton = h(
    "button",
    {
      class: "btn btn-ghost",
      onClick: () => void runDuplicate(),
    },
    icon(ICONS.copy, 16),
    h("span", { text: "Duplicate" }),
  ) as HTMLButtonElement;

  const deleteButton = h(
    "button",
    {
      class: "btn btn-ghost danger",
      onClick: () => void runDelete(),
    },
    icon(ICONS.trash, 16),
    h("span", { text: "Delete" }),
  ) as HTMLButtonElement;

  actions.append(
    h("button", {
      class: "btn btn-ghost",
      text: "All",
      onClick: () => {
        for (const meta of listed) picked.add(meta.id);
        refreshSelection();
      },
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "None",
      onClick: () => {
        picked.clear();
        refreshSelection();
      },
    }),
    tally,
    duplicateButton,
    deleteButton,
    h("button", {
      class: "btn btn-ghost",
      text: "Done",
      onClick: () => setSelecting(false),
    }),
  );

  const newButton = h(
    "button",
    {
      class: "btn btn-primary",
      onClick: () =>
        openNewProject(async (choice) => {
          try {
            const meta = await projects.create(
              choice.name,
              choice.projection,
              choice.gridSize,
              choice.genre,
              choice.options,
            );
            const notes = [
              meta.projection,
              choice.genre,
              `${meta.gridSize}px`,
              ...(choice.options.pixelArt ? ["pixel perfect"] : []),
              ...(choice.options.defaultZoom === 1
                ? []
                : [`${choice.options.defaultZoom}× zoom`]),
              ...(choice.options.character ? [] : ["no character"]),
            ];
            log.info(`Created ${meta.name} (${notes.join(", ")})`);
            callbacks.onOpenProject(meta);
          } catch (err) {
            log.error("Could not create project:", err);
            void reload();
          }
        }),
    },
    icon(ICONS.plus, 17, "#fff"),
    h("span", { text: "New Project" }),
  );

  clear(container);
  container.appendChild(
    h(
      "div",
      { class: "home" },
      h(
        "div",
        { class: "home-bar" },
        h("div", { class: "home-brand", text: "IDLEWILD" }),
        count,
        selectButton,
        importButton,
        newButton,
      ),
      body,
    ),
  );

  /**
   * Turn the mode on or off.
   *
   * Leaving it drops what was picked: a selection held over an absence of any
   * way to see it is a selection that acts on the next press somebody makes.
   * Entering it with nothing listed is refused rather than shown empty.
   */
  function setSelecting(on: boolean): void {
    selecting = on && listed.length > 0;
    picked.clear();
    selectButton.setAttribute("aria-pressed", String(selecting));
    actions.classList.toggle("hidden", !selecting);
    hint.classList.toggle("hidden", selecting);
    grid.classList.toggle("selecting", selecting);
    refreshSelection();
  }

  /** The tally, the two buttons' reach, and every card's own mark. */
  function refreshSelection(): void {
    tally.textContent = selecting
      ? picked.size === 0
        ? "Nothing selected"
        : `${describeCount(picked.size)} selected`
      : "";
    duplicateButton.disabled = picked.size === 0;
    deleteButton.disabled = picked.size === 0;
    for (const card of grid.querySelectorAll<HTMLElement>(".project-card")) {
      const id = card.dataset.project ?? "";
      const on = selecting && picked.has(id);
      card.classList.toggle("picked", on);
      // Only while it is a toggle. A card that opens a project is a button
      // with a destination, and `aria-pressed` on one of those describes a
      // state it has not got.
      if (selecting) card.setAttribute("aria-pressed", String(on));
      else card.removeAttribute("aria-pressed");
    }
  }

  async function runDuplicate(): Promise<void> {
    const ids = [...picked];
    if (ids.length === 0) return;
    await duplicateProjects(ids);
    // Cleared rather than carried: the copies are what is new on the screen,
    // and leaving the originals lit invites a second Duplicate nobody meant.
    picked.clear();
    await reload();
  }

  async function runDelete(): Promise<void> {
    const ids = [...picked];
    if (ids.length === 0) return;
    const names = listed.filter((m) => picked.has(m.id)).map((m) => m.name);
    const gone = await deleteProjects(ids, names);
    // Declined leaves the selection exactly as it was — the question was about
    // these projects, and answering no is not a reason to lose them.
    if (gone === null) return;
    picked.clear();
    await reload();
  }

  /**
   * Take a `.idlewild` file into the store, and open what came out.
   *
   * Unfiltered on a touch device, filtered on a desktop — the same split as
   * the editor's Add Image, and for the same reason: iPadOS reads the filter
   * list to decide *which picker* to show, and an extension it has never
   * heard of is not a reliable way to ask for the document browser.
   *
   * **`.zip` is on the desktop filter too, because a `.idlewild` *is* a zip.**
   * The extension is this app's name for it and nothing else on a machine
   * knows that name, so a backup that went through mail, a chat client, a
   * download or somebody's own Compress comes back as `.zip` more often than
   * not. The importer decides what a file is by reading its manifest rather
   * than its extension, so the filter was the only thing refusing those — and
   * a backup you cannot see in the picker is a backup you have lost. A zip
   * that turns out to be a site or an assets export is refused by name on the
   * other side, which is a better answer than never offering it.
   */
  async function importProject(): Promise<void> {
    try {
      const os = await platform();
      const picked = await openFileDialog({
        multiple: false,
        pickerMode: "document",
        filters: isMobile(os)
          ? undefined
          : [{ name: "Idlewild project", extensions: ["idlewild", "zip"] }],
      });
      if (typeof picked !== "string") return;
      const meta = await projects.import(picked);
      log.info(`Imported ${meta.name} from ${picked}`);
      callbacks.onOpenProject(meta);
    } catch (err) {
      log.error("Could not import that file:", err);
      void reload();
    }
  }

  async function reload(): Promise<void> {
    let list: ProjectMeta[] = [];
    try {
      list = await projects.list();
    } catch (err) {
      log.error("Could not read the project list:", err);
    }

    listed = list;
    count.textContent = describeCount(list.length);
    clear(grid);

    // A project that has gone is not selected any more, however it went — a
    // bulk delete, or the card menu while the mode was off.
    for (const id of [...picked]) {
      if (!list.some((meta) => meta.id === id)) picked.delete(id);
    }
    selectButton.disabled = list.length === 0;

    if (list.length === 0) {
      if (selecting) setSelecting(false);
      grid.appendChild(
        h("div", {
          class: "home-empty",
          text: "No projects yet. Start one with New Project.",
        }),
      );
      refreshSelection();
      return;
    }

    for (const meta of list) {
      grid.appendChild(
        projectCard(meta, reload, {
          onOpen: () => {
            // The mode decides what a tap means, and it is read here rather
            // than wired in: the cards are rebuilt on every reload, and a
            // handler that captured the mode would be a card built in one mode
            // and pressed in another.
            if (!selecting) return callbacks.onOpenProject(meta);
            if (picked.has(meta.id)) picked.delete(meta.id);
            else picked.add(meta.id);
            refreshSelection();
          },
          // The card's own menu is the single-project path; while the mode is
          // on, a long press is a press that has gone on a bit.
          onMenu: () => selecting,
        }),
      );
    }
    refreshSelection();
  }

  void reload();
}

/** How a card behaves, which depends on whether the grid is selecting. */
interface CardBehaviour {
  onOpen: () => void;
  /** Whether to swallow the long press rather than open the card's menu. */
  onMenu: () => boolean;
}

function projectCard(
  meta: ProjectMeta,
  reload: () => Promise<void>,
  behaviour: CardBehaviour,
): HTMLElement {
  const thumb = h(
    "div",
    { class: "project-thumb" },
    h("span", { class: "project-thumb-empty m", text: "No preview yet" }),
    // The tick a picked card carries, drawn whether or not it is picked so the
    // thumbnail does not reflow when one is. The stylesheet shows it.
    h("span", { class: "project-tick" }, icon(ICONS.check, 15, "#fff")),
  );

  // Thumbnails are written by the editor from the live canvas, so a project
  // that has never been opened simply has none.
  void projects
    .thumbnail(meta.id)
    .then((url) => {
      if (!url) return;
      thumb.style.backgroundImage = `url(${url})`;
      clear(thumb);
    })
    .catch(() => {});

  const card = h(
    "button",
    {
      class: "project-card",
      dataset: { project: meta.id },
      onClick: () => behaviour.onOpen(),
    },
    thumb,
    h(
      "div",
      { class: "project-info" },
      h("div", { class: "project-name", text: meta.name }),
      h("div", {
        class: "project-meta m",
        text:
          `${meta.projection} · ${meta.genre ?? "topdown"} · ` +
          `${meta.gridSize} px · ${describeEdited(meta.updatedAt)}`,
      }),
    ),
  );

  onLongPress(card, (event) => {
    if (behaviour.onMenu()) return;
    openCardMenu(event, meta, reload);
  });

  return card;
}

function openCardMenu(
  event: PointerEvent,
  meta: ProjectMeta,
  reload: () => Promise<void>,
): void {
  const menu = h("div", { class: "ctx-menu" });

  const dismiss = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onOutside, true);
  };
  const onOutside = (e: Event) => {
    if (!menu.contains(e.target as Node)) dismiss();
  };

  menu.append(
    item(ICONS.rename, "Rename", () => {
      dismiss();
      openRename(meta, reload);
    }),
    item(ICONS.copy, "Duplicate", async () => {
      dismiss();
      try {
        await projects.duplicate(meta.id);
        await reload();
      } catch (err) {
        log.error("Could not duplicate:", err);
      }
    }),
    item(
      ICONS.trash,
      "Delete",
      async () => {
        dismiss();
        const ok = await confirmSheet(
          "Delete project",
          `“${meta.name}” and everything in it will be removed. This cannot be undone.`,
        );
        if (!ok) return;
        try {
          await projects.remove(meta.id);
          await reload();
        } catch (err) {
          log.error("Could not delete:", err);
        }
      },
      true,
    ),
  );

  document.body.appendChild(menu);

  // Keep the menu on screen when the press lands near an edge.
  const rect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  // Defer so the press that opened the menu does not immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
  }, 0);
}

function item(
  path: string | readonly string[],
  label: string,
  onClick: () => void,
  danger = false,
): HTMLElement {
  return h(
    "button",
    { class: danger ? "ctx-item danger" : "ctx-item", onClick },
    icon(path, 15),
    h("span", { text: label }),
  );
}

function openRename(meta: ProjectMeta, reload: () => Promise<void>): void {
  const sheet = openSheet({ title: "Rename project", light: true, width: 480 });
  const input = h("input", { class: "input", value: meta.name, maxlength: "60" });
  sheet.body.appendChild(input);

  const save = async () => {
    const name = input.value.trim();
    sheet.close();
    if (!name || name === meta.name) return;
    try {
      await projects.rename(meta.id, name);
      await reload();
    } catch (err) {
      log.error("Could not rename:", err);
    }
  };

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") void save();
  });
  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Save", onClick: () => void save() }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
  input.focus();
  input.select();
}

function describeEdited(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Edited ${days}d ago`;
  return `Edited ${new Date(timestamp).toLocaleDateString()}`;
}
