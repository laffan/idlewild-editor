/**
 * A name in a list that takes a double tap to start typing into.
 *
 * The layer list's names, a placed PSD's, and a PSD layer's in the inspector
 * are all fields in place, and they used to take the caret on the first tap.
 * With a mouse that is a click on the name to rename it; with an Apple Pencil
 * it is every tap that happens to land on a name on its way to selecting the
 * row — the keyboard came up and the row went into editing more often than it
 * was meant to. So a single tap now only selects, as it does anywhere else on
 * the row, and a second tap in the same place soon after opens the field.
 *
 * **Read-only until opened, and not focused either.** Read-only alone keeps
 * the iPad's keyboard down but still lets the tap focus the field, and a field
 * with the caret in it is one the shortcuts stand aside for — see `isTyping`,
 * which a read-only field does not count as. So the press that would focus it
 * is refused as well, and the field is only focused once it is opened.
 *
 * **The second tap may land on a different element.** Selecting a row is a
 * re-render of the list, so the field the first tap landed on can be gone by
 * the second: the pair is matched by `key` rather than by element, and the
 * field opened is whichever one carries the key when the second tap arrives.
 *
 * Enter opens a field that has the focus from the keyboard, so a name can
 * still be reached without a pointer.
 */

/**
 * How long after a tap a second one still counts as a double. A little longer
 * than the canvas's 320 ms, because a second tap of the Pencil's tip on a name
 * is a deliberate one and nothing else here is waiting on the answer.
 */
const DOUBLE_TAP_MS = 400;

/** The last tap on a name: which one, and when. */
let lastTap: { key: string; at: number } | null = null;

/**
 * Make `input` read-only until it is double-tapped. `key` names what it is a
 * name of — a layer's id, a file's key — and has to be the same on the field
 * a re-render draws in its place. Returns the input, for use inline.
 */
export function renameOnDoubleTap(input: HTMLInputElement, key: string): HTMLInputElement {
  input.readOnly = true;
  input.dataset.nameKey = key;
  input.classList.add("tap-name");
  // When this field was last closed, so the Enter that closed it does not
  // open it again — see the keydown below.
  let closedAt = -Infinity;

  // The press is what focuses a field; a single tap must not.
  input.addEventListener("mousedown", (event) => {
    if (input.readOnly) event.preventDefault();
  });
  input.addEventListener("click", (event) => {
    if (!input.readOnly) return;
    const doubled =
      lastTap !== null &&
      lastTap.key === key &&
      event.timeStamp - lastTap.at <= DOUBLE_TAP_MS;
    lastTap = doubled ? null : { key, at: event.timeStamp };
    if (doubled) open(key, input);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !input.readOnly) return;
    // The field's own Enter, which commits by blurring, runs first and closes
    // it within this same event; that is not a request to open it again.
    if (closedAt >= event.timeStamp) return;
    event.preventDefault();
    open(key, input);
  });
  input.addEventListener("blur", () => {
    input.readOnly = true;
    closedAt = performance.now();
  });
  return input;
}

/**
 * Open the field for typing, with its name selected so it can be typed over.
 *
 * Here and now rather than deferred: the iPad brings its keyboard up only for
 * a focus inside the tap's own handler. The row's click — which selects it,
 * and may have re-rendered the list — has already run by this point, since
 * every caller's own handler is attached before this one; so the field to open
 * is whichever carries the key now.
 */
function open(key: string, fallback: HTMLInputElement): void {
  const live = fallback.isConnected
    ? fallback
    : document.querySelector<HTMLInputElement>(
        `input.tap-name[data-name-key="${CSS.escape(key)}"]`,
      );
  if (!live) return;
  live.readOnly = false;
  live.focus();
  live.select();
}
