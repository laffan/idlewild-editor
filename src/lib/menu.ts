/**
 * A dropdown anchored under the control that opened it.
 *
 * Sheets are modal and cover the canvas; a menu is a short list of places to
 * go, so it stays a light overlay with no backdrop. It is appended to the
 * document rather than to the anchor, because the header clips its own
 * overflow and a menu inside it would be cut off at the first item.
 */

import { h, icon } from "./dom";

export interface MenuItem {
  label: string;
  /** A `ICONS` entry, drawn at the same size the header uses. */
  glyph?: string | readonly string[];
  /**
   * A CSS font stack to draw this row's label in.
   *
   * One use so far, and it is the whole reason a menu row can say anything
   * about its own typography: the font picker, where a list of family names
   * set in one face is a list nobody can choose from. A name is the specimen.
   */
  font?: string;
  /** Marked as the one currently chosen. */
  current?: boolean;
  /**
   * A setting rather than a place to go: the row carries a checkbox, a press
   * ticks or unticks it, and the menu stays open so the next one can be
   * changed too. `onSelect` is called after the box has flipped.
   */
  checked?: boolean;
  /** What the row says on hover — a checkbox row's explanation. */
  title?: string;
  onSelect: () => void;
}

export interface MenuHandle {
  close: () => void;
}

/**
 * Open a menu under `anchor`, right-aligned to it.
 *
 * Pointer-down outside dismisses, but events inside `anchor` are left alone:
 * the anchor is a toggle, and dismissing here would let its own click reopen
 * the menu it had just closed.
 */
export function openMenu(
  anchor: HTMLElement,
  items: readonly MenuItem[],
  onClose?: () => void,
): MenuHandle {
  const root = h("div", { class: "menu", role: "menu" });

  const close = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    root.remove();
    onClose?.();
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && (root.contains(target) || anchor.contains(target))) return;
    close();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  for (const item of items) {
    root.appendChild(item.checked === undefined ? row(item, close) : checkRow(item));
  }

  document.body.appendChild(root);
  position(root, anchor);

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);

  return { close };
}

/** A row that goes somewhere: the press closes the menu, then acts. */
function row(item: MenuItem, close: () => void): HTMLElement {
  return h(
    "button",
    {
      class: item.current ? "menu-item current" : "menu-item",
      role: "menuitem",
      title: item.title ?? null,
      ...(item.current ? { "aria-current": "true" } : {}),
      onClick: () => {
        close();
        item.onSelect();
      },
    },
    item.glyph ? icon(item.glyph, 17) : null,
    h("span", {
      text: item.label,
      ...(item.font ? { style: { fontFamily: item.font } } : {}),
    }),
  );
}

/**
 * A row that is a setting: the app's own checkbox, the item's glyph, its
 * label. The box is drawn rather than pressed — the whole row is the target,
 * as it is on every other menu row — so it is inert to the pointer and kept
 * in step with the row's `aria-checked` here.
 */
function checkRow(item: MenuItem): HTMLElement {
  let on = item.checked === true;
  const box = h("input", {
    type: "checkbox",
    tabindex: "-1",
    "aria-hidden": "true",
  }) as HTMLInputElement;
  box.checked = on;
  const button = h(
    "button",
    {
      class: "menu-item check",
      role: "menuitemcheckbox",
      "aria-checked": String(on),
      title: item.title ?? null,
      onClick: () => {
        on = !on;
        box.checked = on;
        button.setAttribute("aria-checked", String(on));
        item.onSelect();
      },
    },
    box,
    item.glyph ? icon(item.glyph, 17) : null,
    h("span", { text: item.label }),
  );
  return button;
}

/**
 * Right-align the menu under its anchor, then pull it back inside the
 * viewport. The header sits at the top of a full-height window, so only the
 * horizontal clamp ever does anything — but a narrow iPad in portrait is
 * exactly where it matters.
 */
function position(root: HTMLElement, anchor: HTMLElement): void {
  const from = anchor.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  const margin = 8;

  const left = Math.max(
    margin,
    Math.min(from.right - box.width, window.innerWidth - box.width - margin),
  );
  const top = Math.min(
    from.bottom,
    Math.max(margin, window.innerHeight - box.height - margin),
  );

  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
}
