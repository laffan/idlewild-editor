/**
 * Home screen: the project list. A card per project showing its current
 * state as a thumbnail; long-press for rename and delete; New Game top right.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { onLongPress } from "../lib/gestures";
import { projects } from "../lib/ipc";
import { confirmSheet, openSheet } from "../lib/sheet";
import type { ProjectMeta } from "../lib/types";
import * as log from "../lib/log";
import { openNewGame } from "./new-game";

export interface HomeCallbacks {
  onOpenProject: (meta: ProjectMeta) => void;
}

export function renderHome(
  container: HTMLElement,
  callbacks: HomeCallbacks,
): void {
  const count = h("div", { class: "home-count m" });
  const grid = h("div", { class: "project-grid" });
  const body = h(
    "div",
    { class: "home-body scroll" },
    h("div", {
      class: "home-hint m",
      text: "Long-press a card to rename or delete",
    }),
    grid,
  );

  const newButton = h(
    "button",
    {
      class: "btn btn-primary push-right",
      onClick: () =>
        openNewGame(async (choice) => {
          try {
            const meta = await projects.create(
              choice.name,
              choice.projection,
              choice.gridSize,
            );
            log.info(`Created ${meta.name} (${meta.projection}, ${meta.gridSize}px)`);
            callbacks.onOpenProject(meta);
          } catch (err) {
            log.error("Could not create project:", err);
            void reload();
          }
        }),
    },
    icon(ICONS.plus, 17, "#fff"),
    h("span", { text: "New Game" }),
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
        newButton,
      ),
      body,
    ),
  );

  async function reload(): Promise<void> {
    let list: ProjectMeta[] = [];
    try {
      list = await projects.list();
    } catch (err) {
      log.error("Could not read the project list:", err);
    }

    count.textContent = `${list.length} ${list.length === 1 ? "project" : "projects"}`;
    clear(grid);

    if (list.length === 0) {
      grid.appendChild(
        h("div", {
          class: "home-empty",
          text: "No projects yet. Start one with New Game.",
        }),
      );
      return;
    }

    for (const meta of list) {
      grid.appendChild(projectCard(meta, callbacks, reload));
    }
  }

  void reload();
}

function projectCard(
  meta: ProjectMeta,
  callbacks: HomeCallbacks,
  reload: () => Promise<void>,
): HTMLElement {
  const thumb = h(
    "div",
    { class: "project-thumb" },
    h("span", { class: "project-thumb-empty m", text: "No preview yet" }),
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
      onClick: () => callbacks.onOpenProject(meta),
    },
    thumb,
    h(
      "div",
      { class: "project-info" },
      h("div", { class: "project-name", text: meta.name }),
      h("div", {
        class: "project-meta m",
        text: `${meta.projection} · ${meta.gridSize} px · ${describeEdited(meta.updatedAt)}`,
      }),
    ),
  );

  onLongPress(card, (event) => {
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
