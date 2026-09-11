/**
 * The scene dropdown, above the layer list.
 *
 * A scene is what Phaser means by one: a set of layers and a canvas of its
 * own. A project is several places — a title screen, a cave, the overworld —
 * sharing a grid, a genre and a pile of PSDs, but not a single thing standing
 * on them. So the left sidebar manages both, in the order you think about
 * them: which place am I in, then what is in it.
 *
 * A dropdown rather than a list, because scenes are switched between rather
 * than compared: a second list above the layers would cost the layers half
 * the panel for something you read once and then leave alone. The menu is the
 * same one the project cards use — every scene to switch to, then what you
 * can do to the one you are in.
 *
 * Renaming is inline, like a layer's, and commits on Enter or blur rather
 * than per keystroke.
 */

import type { DocStore } from "../lib/doc-store";
import { clear, h, ICONS, icon } from "../lib/dom";
import { openMenu } from "../lib/menu";
import { confirmSheet } from "../lib/sheet";

export class ScenesBar {
  readonly root: HTMLElement;
  private readonly store: DocStore;
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLElement;
  /** The scene whose name is being typed, if one is. */
  private renaming: string | null = null;

  constructor(store: DocStore) {
    this.store = store;
    this.label = h("span", { class: "scene-name" });
    this.button = h(
      "button",
      {
        class: "scene-pick",
        title: "Scenes",
        onClick: () => this.openScenes(),
      },
      this.label,
      icon(ICONS.chevronDown, 14),
    );

    this.root = h("div", { class: "scenes-bar" }, this.button);
    // `scene` as well as `change`: a switch is a commit, but a rename is
    // only a change, and both move what this shows.
    store.addEventListener("change", () => this.render());
    store.addEventListener("scene", () => this.render());
    this.render();
  }

  render(): void {
    if (this.renaming) return;
    clear(this.root);
    this.label.textContent = this.store.activeScene.name;
    this.root.appendChild(this.button);
  }

  private openScenes(): void {
    const active = this.store.activeSceneId;
    const items = this.store.scenes.map((scene) => ({
      // The one you are in is marked rather than omitted: a menu that drops
      // the current item makes the list jump as you move between scenes.
      label: scene.id === active ? `${scene.name} ✓` : scene.name,
      onSelect: () => this.store.setActiveScene(scene.id),
    }));

    openMenu(this.button, [
      ...items,
      { label: "New scene", glyph: ICONS.plus, onSelect: () => this.store.addScene() },
      {
        label: "Rename scene",
        glyph: ICONS.rename,
        onSelect: () => this.startRename(),
      },
      {
        label: "Duplicate scene",
        glyph: ICONS.copy,
        onSelect: () => this.store.duplicateScene(active),
      },
      {
        label: "Delete scene",
        glyph: ICONS.trash,
        onSelect: () => void this.confirmDelete(active),
      },
    ]);
  }

  /**
   * Swap the button for a field, in place.
   *
   * `renaming` holds the panel's re-render off while it is up: the sidebar
   * rebuilds on every document change, and one of those changes is whatever
   * the user does next on the canvas.
   */
  private startRename(): void {
    const scene = this.store.activeScene;
    this.renaming = scene.id;

    const field = h("input", {
      class: "scene-rename",
      value: scene.name,
      "aria-label": "Scene name",
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Enter") field.blur();
        if (event.key === "Escape") {
          field.value = scene.name;
          field.blur();
        }
      },
      onBlur: () => {
        const name = field.value.trim();
        this.renaming = null;
        if (name && name !== scene.name) this.store.renameScene(scene.id, name);
        else this.render();
      },
    });

    clear(this.root);
    this.root.appendChild(field);
    field.focus();
    field.select();
  }

  /**
   * Ask first. A scene holds every layer in it, and there is no undo — this
   * is the most expensive button in the sidebar.
   */
  private async confirmDelete(sceneId: string): Promise<void> {
    const scene = this.store.scene(sceneId);
    if (!scene) return;
    if (this.store.scenes.length <= 1) {
      await confirmSheet(
        "The last scene",
        "A project keeps at least one scene. Make another before deleting this one.",
        "OK",
        false,
      );
      return;
    }
    const layers = scene.layers.length;
    const ok = await confirmSheet(
      `Delete ${scene.name}?`,
      `Its ${layers} ${layers === 1 ? "layer" : "layers"} and everything on ` +
        `them goes with it. The PSDs stay in the project.`,
      "Delete",
      false,
    );
    if (ok) this.store.removeScene(sceneId);
  }
}
