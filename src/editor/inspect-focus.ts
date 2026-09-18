/**
 * Keeping the caret where it was when the panel was rebuilt under it.
 *
 * The properties sidebar rebuilds on every document change, and two of its
 * controls are fields somebody types into — a placed PSD's filename, and the
 * words of a note. Anything that touches the document while the caret is in
 * one throws away what has been typed, so both are read off before the rebuild
 * and put back after it.
 *
 * **The note is the hard case**, and it is what made this worth a file of its
 * own. A filename commits on Enter or blur, so the rebuild that eats it is
 * some *other* edit landing mid-typing — rare, and infuriating when it
 * happens. A note commits on every keystroke, because the canvas is its
 * preview and text whose shape only appears on blur is text laid out by
 * guesswork: so every keystroke rebuilds the panel under the caret that
 * produced it, and without this, typing a note gets one character in and
 * stops.
 *
 * One pair of functions for both, keyed by class. What varies between them is
 * the element type, and both of the two carry `value`, `selectionStart` and
 * `selectionEnd` — so the difference is a `querySelector` argument rather than
 * a second copy of the same eight lines.
 */

/** A field's contents and caret, as they stood. */
export interface FieldFocus {
  selector: string;
  value: string;
  start: number;
  end: number;
}

/** The fields this looks after, in the order they are asked about. */
const FIELDS = [".inspect-name", ".inspect-textarea"] as const;

/**
 * The field being typed into inside `body`, or null when none is.
 *
 * `document.activeElement` rather than a listener, because what is wanted is
 * the state at the moment of the rebuild and nothing before it: a field that
 * lost focus five seconds ago is not a caret to put back.
 */
export function captureFocus(body: HTMLElement): FieldFocus | null {
  const el = document.activeElement;
  if (!isField(el) || !body.contains(el)) return null;
  const selector = FIELDS.find((name) => el.classList.contains(name.slice(1)));
  if (!selector) return null;
  return {
    selector,
    value: el.value,
    start: el.selectionStart ?? el.value.length,
    end: el.selectionEnd ?? el.value.length,
  };
}

/**
 * Put it back into the field of the same kind in the rebuilt panel.
 *
 * By class rather than by identity, because the element the caret was in has
 * been destroyed — what this finds is the new one drawn in its place. A panel
 * rebuilt about something else has no such field, and nothing happens.
 */
export function restoreFocus(body: HTMLElement, memo: FieldFocus | null): void {
  if (!memo) return;
  const field = body.querySelector(memo.selector);
  if (!isField(field)) return;
  field.value = memo.value;
  field.focus();
  field.setSelectionRange(memo.start, memo.end);
}

function isField(
  el: EventTarget | Element | null,
): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}
