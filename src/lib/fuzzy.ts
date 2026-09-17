/**
 * Fuzzy matching, for the one list in this app that is long enough to need it:
 * the repositories a GitHub token can see.
 *
 * A **subsequence** match, not a substring one — `iwed` finds
 * `laffan/idlewild-editor` — because the useful thing to type is the letters
 * you remember in the order you remember them, and a substring search makes
 * you remember where the hyphens are.
 *
 * Scoring is what makes a subsequence match usable, because nearly everything
 * matches nearly everything: with three letters typed, half a hundred
 * repositories are a legal match and only two of them are the answer. So the
 * score rewards the things that distinguish a real match from a coincidence:
 *
 * - **Runs.** Letters found next to each other are worth more than the same
 *   letters scattered, and increasingly so the longer the run.
 * - **Boundaries.** A letter at the start of a word — after a `/`, `-`, `_`,
 *   `.` or a space, or at a capital in `camelCase` — is worth more than one in
 *   the middle of one, which is why `ie` ranks `idlewild-editor` over
 *   `pipeline`.
 * - **Earliness.** A match near the front of the name beats the same match
 *   near the back, gently. It is a tiebreak rather than a rule.
 *
 * The matched positions come back with the score so the list can show *why* a
 * row matched. A fuzzy list that does not underline what it matched is one
 * where the fourth result looks like a bug.
 */

export interface FuzzyMatch {
  /** Higher is better. Only meaningful against other scores for one query. */
  score: number;
  /** Which characters of the haystack matched, in order — for highlighting. */
  hits: number[];
}

/** Awarded once per matched character, so a longer match always beats a shorter. */
const BASE = 8;
/**
 * Added per character of an unbroken run, growing with the run's length.
 *
 * Deliberately worth more than a boundary once a run reaches two, because a
 * separator-heavy name otherwise wins on boundaries alone: with `RUN` at 6,
 * `ide` ranked `i-d-e-a` — three word-starts — above `ideal`, which is the
 * answer anybody typing `ide` meant.
 */
const RUN = 10;
/** A match at the start of a word. The strongest single-character signal. */
const BOUNDARY = 12;
/** Taken off per character of head start, to a floor — a tiebreak, not a rule. */
const LATE = 1;
const LATE_FLOOR = 20;

/**
 * Score `haystack` against `needle`, or null if the letters are not in it.
 *
 * Case-insensitive, and an empty needle matches everything with a score of
 * zero — which is what makes an empty search box show the whole list in its
 * own order rather than nothing.
 *
 * **Greedy, not optimal.** It takes the first place each letter fits rather
 * than searching every arrangement for the best one, which can score a name
 * slightly below its true best. The alternative is exponential in the length
 * of the needle for an answer nobody could tell apart from this one.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (!needle) return { score: 0, hits: [] };

  const query = needle.toLowerCase();
  const target = haystack.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let run = 0;
  let at = 0;

  for (const letter of query) {
    // A space in the query means "and also", not a character to find: typing
    // two words should narrow rather than fail on the gap between them.
    if (letter === " ") {
      run = 0;
      continue;
    }
    const found = target.indexOf(letter, at);
    if (found === -1) return null;

    run = found === at && hits.length > 0 ? run + 1 : 0;
    score += BASE + run * RUN;
    if (isBoundary(haystack, found)) score += BOUNDARY;
    hits.push(found);
    at = found + 1;
  }

  const head = hits[0] ?? 0;
  score -= Math.min(head * LATE, LATE_FLOOR);
  return { score, hits };
}

/** Whether a position starts a word, by separator or by camel case. */
function isBoundary(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text[at - 1];
  if (before === "/" || before === "-" || before === "_" || before === "." || before === " ") {
    return true;
  }
  // `idlewildEditor` — a capital after a lower case starts a word.
  return before === before.toLowerCase() && text[at] !== text[at].toLowerCase();
}

/**
 * The items whose `key` matches, best first.
 *
 * A stable sort on an equal score, so an empty query — every score zero —
 * leaves the list in whatever order it arrived in, which for repositories is
 * most recently updated first. That is the right list to see before typing
 * anything, and re-sorting it alphabetically the moment the box is focused
 * would throw away the only ordering that knows what you are working on.
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
): Array<{ item: T; match: FuzzyMatch }> {
  const scored: Array<{ item: T; match: FuzzyMatch; index: number }> = [];
  items.forEach((item, index) => {
    const match = fuzzyMatch(query, key(item));
    if (match) scored.push({ item, match, index });
  });
  scored.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
  return scored.map(({ item, match }) => ({ item, match }));
}

/** A stretch of a name, and whether the search found it. */
export interface Piece {
  text: string;
  hit: boolean;
}

/**
 * A name split into matched and unmatched stretches, for the row to draw.
 *
 * Pieces rather than elements, for two reasons. It is testable without a DOM,
 * which this suite does not have by choice. And it keeps the rule that text off
 * the network never becomes markup — the caller makes a `mark` and sets
 * `textContent`, so a repository called `<img src=x onerror=…>` is a
 * repository with a silly name rather than a script.
 */
export function highlight(text: string, hits: readonly number[]): Piece[] {
  const marked = new Set(hits);
  const out: Piece[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = marked.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}
