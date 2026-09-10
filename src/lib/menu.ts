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
    root.appendChild(
      h(
        "button",
        {
          class: "menu-item",
          role: "menuitem",
          onClick: () => {
            close();
            item.onSelect();
          },
        },
        item.glyph ? icon(item.glyph, 17) : null,
        h("span", { text: item.label }),
      ),
    );
  }

  document.body.appendChild(root);
  position(root, anchor);

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);

  return { close };
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
