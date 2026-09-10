/**
 * The top bar. The spec asks for an Edit/Play toggle with Code and Publish
 * beside it; the design canvas folded Code and Publish into a hamburger. Both
 * are here — the buttons are visible per the spec, and the hamburger keeps
 * Project Options.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { EditorMode } from "../lib/types";

export interface TopbarCallbacks {
  onBack: () => void;
  onMode: (mode: EditorMode) => void;
  onCode: () => void;
  onPublish: () => void;
  onOptions: () => void;
}

export class Topbar {
  readonly root: HTMLElement;
  private readonly editButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;

  constructor(
    projectName: string,
    gridLabel: string,
    callbacks: TopbarCallbacks,
  ) {
    this.editButton = h("button", {
      class: "mode-btn",
      text: "Edit",
      "aria-pressed": "true",
      onClick: () => callbacks.onMode("edit"),
    });
    this.playButton = h("button", {
      class: "mode-btn",
      text: "Play",
      "aria-pressed": "false",
      onClick: () => callbacks.onMode("play"),
    });

    this.root = h(
      "div",
      { class: "editor-topbar" },
      h(
        "div",
        { class: "topbar-group topbar-project" },
        h(
          "button",
          { class: "icon-btn", title: "All projects", onClick: callbacks.onBack },
          icon(ICONS.chevronLeft, 17),
        ),
        h("div", { class: "topbar-name", text: projectName }),
        h("div", { class: "topbar-grid m", text: gridLabel }),
      ),
      h(
        "div",
        { class: "push-right", style: { display: "flex", gap: "12px", flexWrap: "wrap" } },
        h(
          "div",
          { class: "topbar-group mode-toggle" },
          this.editButton,
          this.playButton,
        ),
        h(
          "button",
          { class: "chrome-btn", onClick: callbacks.onCode },
          icon(ICONS.code, 17),
          h("span", { text: "Code" }),
        ),
        h(
          "button",
          { class: "chrome-btn", onClick: callbacks.onPublish },
          icon(ICONS.publish, 17),
          h("span", { text: "Publish" }),
        ),
        h(
          "button",
          {
            class: "chrome-btn chrome-btn-icon",
            title: "Project options",
            "aria-label": "Project options",
            onClick: callbacks.onOptions,
          },
          icon(ICONS.menu, 17),
        ),
      ),
    );
  }

  setMode(mode: EditorMode): void {
    this.editButton.setAttribute("aria-pressed", String(mode === "edit"));
    this.playButton.setAttribute("aria-pressed", String(mode === "play"));
  }
}
