/**
 * A hint attached to a label: the sentence a control needs and the row it sits
 * on has no line for.
 *
 * **Hover is not the whole of it, and on the platform this editor is mostly
 * used on it is none of it.** An iPad has no pointer to rest on something, so a
 * tooltip that only answers `mouseenter` would take every explanation in a
 * sheet and hide it from the people most likely to need one. So the trigger is
 * a real button: hover opens it on a machine that has hovering, a tap opens it
 * anywhere, and a keyboard reaches it because it was a button all along.
 *
 * It is a button rather than a `title` attribute for the same reason. The
 * native tooltip is a desktop affordance with no touch equivalent, no styling
 * and a delay nobody can tune, and it is invisible to a finger.
 *
 * **Positioned against the viewport, in `position: fixed`.** A sheet's body
 * scrolls and clips, so a bubble laid out inside a row would be cut off by the
 * first thing with `overflow: hidden` above it — which, in the options design
 * system, is every group. It is appended to `document.body`, placed from the
 * trigger's rectangle, and flipped above the trigger when there is no room
 * below.
 *
 * One at a time: opening a second closes the first, because two explanations
 * on screen at once is a screen where neither is being read.
 */

import { h } from "./dom";

/** The bubble that is up, if any. Module-level, because only one ever is. */
let open: { bubble: HTMLElement; dismiss: () => void } | null = null;

/** Names each trigger's bubble, so a trigger can tell its own from another's. */
let counter = 0;

/** How long a pointer has to rest before a hover counts as a question. */
const HOVER_DELAY = 350;
/** Clear of the trigger, and of the viewport edge. */
const GAP = 8;
const EDGE = 10;

/** Close whatever is open. Exported so a sheet can close one as it goes. */
export function closeTooltip(): void {
  open?.dismiss();
}

/** What a hint says, or a way of asking at the moment it is opened. */
export type HintText = string | (() => string);

/**
 * A `?` button carrying `text`, to sit beside a label.
 *
 * `label` names what is being explained, so a screen reader reads "What Pixel
 * perfect does" rather than a lone question mark repeated down the sheet.
 *
 * **A function for a hint whose answer depends on something else on the
 * sheet.** What the grid scale *means* is different under Blank — nothing
 * snaps to it there, so it is the unit the character is measured in rather
 * than the size of a space — and the template is picked two rows above it. A
 * fixed string would have to be either wrong half the time or vague enough to
 * be wrong always, and the alternative, rebuilding the row when its neighbour
 * changes, throws away a control somebody may be part-way through using. Read
 * at the moment it opens, which is the moment the answer is wanted.
 */
export function hintButton(text: HintText, label: string): HTMLElement {
  const id = `tip-${(counter += 1)}`;
  const trigger = h("button", {
    class: "tip-trigger",
    type: "button",
    "aria-label": `What ${label} does`,
    text: "?",
  }) as HTMLButtonElement;

  let hoverTimer: number | undefined;

  const show = (): void => {
    if (open?.bubble.dataset.owner === id) return;
    closeTooltip();

    const bubble = h("div", {
      class: "tip",
      role: "tooltip",
      dataset: { owner: id },
      text: typeof text === "function" ? text() : text,
    });
    document.body.appendChild(bubble);
    place(bubble, trigger);

    const dismiss = () => {
      window.clearTimeout(hoverTimer);
      bubble.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", dismiss);
      // Capture, so a scroll inside the sheet's body closes it too: the bubble
      // is fixed and the row under it is not, so a scroll would slide the row
      // out from under an explanation that stayed put.
      window.removeEventListener("scroll", dismiss, true);
      trigger.setAttribute("aria-expanded", "false");
      if (open?.bubble === bubble) open = null;
    };
    const onOutside = (event: Event) => {
      if (!trigger.contains(event.target as Node)) dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      // Swallowed, so Escape closes the bubble without also closing the sheet
      // underneath it. One press, one dismissal, innermost first.
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismiss();
    };

    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    trigger.setAttribute("aria-expanded", "true");
    open = { bubble, dismiss };
  };

  // A press toggles, which is the touch answer and is also what a keyboard
  // does with a button. `pointerdown` rather than `click` so the outside
  // handler above does not close it in the same gesture that opened it.
  trigger.addEventListener("pointerdown", (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (open?.bubble.dataset.owner === id) closeTooltip();
    else show();
  });

  // And hovering, where there is a pointer that can hover. `mouseenter` fires
  // on a tap in WKWebView too, which is why the tap path above is a toggle
  // rather than an open — the two must not fight over one gesture.
  trigger.addEventListener("mouseenter", () => {
    hoverTimer = window.setTimeout(show, HOVER_DELAY);
  });
  trigger.addEventListener("mouseleave", () => {
    window.clearTimeout(hoverTimer);
    if (open?.bubble.dataset.owner === id) closeTooltip();
  });
  trigger.addEventListener("focus", show);
  trigger.addEventListener("blur", () => {
    if (open?.bubble.dataset.owner === id) closeTooltip();
  });

  trigger.setAttribute("aria-expanded", "false");
  return trigger;
}

/**
 * Put the bubble under the trigger, or above it when the sheet is near the
 * bottom of the screen — and never off either side.
 */
function place(bubble: HTMLElement, trigger: HTMLElement): void {
  const anchor = trigger.getBoundingClientRect();
  const box = bubble.getBoundingClientRect();

  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - box.height;
  const top = below + box.height <= window.innerHeight - EDGE || above < EDGE ? below : above;

  const wanted = anchor.left + anchor.width / 2 - box.width / 2;
  const left = Math.max(
    EDGE,
    Math.min(wanted, window.innerWidth - box.width - EDGE),
  );

  bubble.style.top = `${Math.max(EDGE, top)}px`;
  bubble.style.left = `${left}px`;
}
