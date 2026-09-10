/** Modal plumbing shared by every sheet in the app. */

import { h } from "./dom";

export interface SheetOptions {
  title: string;
  subtitle?: string;
  /** Light sheets sit on the home screen; the default dark ones sit over the
   *  editor canvas. */
  light?: boolean;
  /** Tapping the backdrop dismisses unless this is false. */
  dismissable?: boolean;
  width?: number;
}

export interface SheetHandle {
  root: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  close: () => void;
}

export function openSheet(options: SheetOptions): SheetHandle {
  const body = h("div", { class: "sheet-body" });
  const actions = h("div", { class: "sheet-actions" });

  const panel = h(
    "div",
    {
      class: options.light ? "sheet light" : "sheet",
      style: options.width ? { maxWidth: `${options.width}px` } : undefined,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": options.title,
      onClick: (event: Event) => event.stopPropagation(),
    },
    h(
      "div",
      { class: "sheet-head" },
      h("div", { class: "sheet-title", text: options.title }),
      options.subtitle
        ? h("div", { class: "sheet-sub m", text: options.subtitle })
        : null,
    ),
    body,
    actions,
  );

  const backdrop = h("div", { class: "sheet-backdrop" }, panel);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  if (options.dismissable !== false) {
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
  }

  document.body.appendChild(backdrop);
  return { root: backdrop, body, actions, close };
}

/** A confirm dialog that resolves to the user's answer. */
export function confirmSheet(
  title: string,
  message: string,
  confirmLabel = "Delete",
  light = true,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sheet = openSheet({ title, light, width: 480 });
    sheet.body.appendChild(
      h("div", { style: { font: "500 15px var(--font-body)" }, text: message }),
    );
    let answered = false;
    const answer = (value: boolean) => {
      if (answered) return;
      answered = true;
      sheet.close();
      resolve(value);
    };
    sheet.root.addEventListener("click", () => answer(false));
    sheet.actions.append(
      h("button", {
        class: "btn btn-primary",
        text: confirmLabel,
        onClick: () => answer(true),
      }),
      h("button", {
        class: "btn btn-ghost",
        text: "Cancel",
        onClick: () => answer(false),
      }),
    );
  });
}

/**
 * Ask for one line of text, resolving to it or to null if the user backs out.
 *
 * The app's own sheet rather than `window.prompt`, for two reasons: every
 * other input here is a sheet, and a WKWebView only shows a JS prompt if the
 * host has wired up the panel delegate — which is not something to find out
 * on an iPad.
 */
export function promptSheet(options: {
  title: string;
  label: string;
  value?: string;
  confirmLabel?: string;
  light?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const sheet = openSheet({
      title: options.title,
      light: options.light,
      width: 520,
    });

    const field = h("input", {
      class: "input",
      value: options.value ?? "",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    });

    let answered = false;
    const answer = (value: string | null) => {
      if (answered) return;
      answered = true;
      sheet.close();
      resolve(value);
    };
    const submit = () => {
      const text = field.value.trim();
      answer(text ? text : null);
    };

    field.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") submit();
      // Escape reaches the sheet's own handler and closes it, which resolves
      // through the backdrop listener below.
    });

    sheet.body.append(
      h("div", { class: "sheet-row-key m", text: options.label }),
      field,
    );
    sheet.root.addEventListener("click", () => answer(null));
    sheet.actions.append(
      h("button", {
        class: "btn btn-primary",
        text: options.confirmLabel ?? "Create",
        onClick: submit,
      }),
      h("button", {
        class: "btn btn-ghost",
        text: "Cancel",
        onClick: () => answer(null),
      }),
    );

    // Selecting the stem rather than the whole path is what a rename wants:
    // the folder is usually right and the name is what is being changed.
    field.focus();
    const stem = stemRange(field.value);
    field.setSelectionRange(stem.start, stem.end);
  });
}

/** The part of a path a rename is usually aiming at: its base name's stem. */
function stemRange(value: string): { start: number; end: number } {
  const slash = value.lastIndexOf("/");
  const start = slash + 1;
  const dot = value.lastIndexOf(".");
  return { start, end: dot > start ? dot : value.length };
}
