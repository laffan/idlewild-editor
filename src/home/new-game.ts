/**
 * The New Game sheet: pick a template and a grid scale, name the project.
 * Both templates are codebase selections — see src-tauri/templates/.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import type { Projection } from "../lib/types";

const SCALES = [32, 64, 128, 256];

export interface NewGameChoice {
  name: string;
  projection: Projection;
  gridSize: number;
}

export function openNewGame(
  onCreate: (choice: NewGameChoice) => void,
): void {
  let projection: Projection = "isometric";
  let gridSize = 64;

  const sheet = openSheet({
    title: "New Game",
    subtitle: "Template and grid scale",
    light: true,
    width: 620,
  });

  const nameInput = h("input", {
    class: "input",
    placeholder: "Untitled",
    maxlength: "60",
  });

  const templateSeg = segmented(
    [
      { value: "isometric", label: "Isometric" },
      { value: "orthogonal", label: "Orthogonal" },
    ],
    projection,
    (value) => {
      projection = value as Projection;
    },
  );

  const scaleSeg = segmented(
    SCALES.map((s) => ({ value: String(s), label: `${s} px` })),
    String(gridSize),
    (value) => {
      gridSize = Number(value);
    },
  );

  sheet.body.append(
    field("Name", nameInput),
    field("Template", templateSeg),
    field("Grid scale", scaleSeg),
  );

  const create = () => {
    const name = nameInput.value.trim() || "Untitled";
    sheet.close();
    onCreate({ name, projection, gridSize });
  };

  nameInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") create();
  });

  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Create Game", onClick: create }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  nameInput.focus();
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "field" },
    h("span", { class: "field-label m", text: label }),
    control,
  );
}

function segmented(
  options: Array<{ value: string; label: string }>,
  initial: string,
  onPick: (value: string) => void,
): HTMLElement {
  const buttons: HTMLButtonElement[] = [];
  const wrap = h("div", { class: "seg" });

  for (const option of options) {
    const button = h("button", {
      class: "seg-opt",
      type: "button",
      text: option.label,
      "aria-pressed": String(option.value === initial),
      onClick: () => {
        for (const b of buttons) b.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-pressed", "true");
        onPick(option.value);
      },
    });
    buttons.push(button);
    wrap.appendChild(button);
  }
  return wrap;
}
