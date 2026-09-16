/**
 * Finding a string in the open file, and showing where the answers are.
 *
 * Two halves that belong together: the scan itself, which is plain text and
 * has nothing to do with CodeMirror, and the decoration field that paints
 * what it found. Keeping them in one module is what lets the scan be tested
 * without an editor — see `__tests__/find.test.ts`.
 *
 * **Plain substring, not a regular expression.** The ask was a simple Find,
 * and a box that quietly interprets `.` and `(` is a box that answers the
 * wrong question for anyone searching for `config.scenes` or `place(`, which
 * is most of what anyone searches for in here. Case is a switch instead,
 * because that one is genuinely wanted: `Scene` and `scene` are a class and a
 * variable in every file in this tree.
 *
 * The whole document is scanned on every keystroke. A file in `game/` is a
 * few hundred lines — the largest the scaffold writes is under a thousand —
 * and `indexOf` over that is not something a person can perceive, so there is
 * no index to keep in step with the buffer and nothing to go stale.
 */

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** One answer: a range in the document. */
export interface Match {
  from: number;
  to: number;
}

/**
 * Every place `query` appears in `doc`, in document order.
 *
 * Overlapping matches are not reported — the scan resumes after the match it
 * just took, which is what "next" means when you press it. An empty query has
 * no answers rather than one per character.
 */
export function findMatches(
  doc: string,
  query: string,
  caseSensitive: boolean,
): Match[] {
  if (!query) return [];
  const haystack = caseSensitive ? doc : doc.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Match[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    out.push({ from: at, to: at + needle.length });
    at = haystack.indexOf(needle, at + needle.length);
    // A file of one repeated character is a file somebody generated, and a
    // panel that stops answering is better than one that stops responding.
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

/**
 * How many answers are marked and counted.
 *
 * The count is shown as `12 / 500+` past this, because the point of the number
 * is to say whether you are near the end, and a minified bundle somebody
 * dropped into `js/` has no useful answer to give.
 */
export const MAX_MATCHES = 500;

/** Hand the editor a new set of answers, and which of them is in hand. */
export const setMatches = StateEffect.define<{
  ranges: readonly Match[];
  current: number;
}>();

const mark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-match cm-find-current" });

/**
 * The marks over the matches, and the one over the match you are on.
 *
 * Mapped through document changes rather than dropped, so typing in a file
 * with the panel open moves the marks with the text instead of leaving them
 * over whatever has slid under them. The panel re-scans on every edit anyway;
 * the mapping is what keeps the frame between the two honest.
 */
export const findHighlight: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMatches)) next = build(effect.value.ranges, effect.value.current);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function build(ranges: readonly Match[], current: number): DecorationSet {
  return Decoration.set(
    ranges.map((range, index) =>
      (index === current ? currentMark : mark).range(range.from, range.to),
    ),
    true,
  );
}
