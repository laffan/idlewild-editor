/**
 * Reading a declaration out of a stylesheet, for the tests that assert one.
 *
 * Shared rather than local to `styles.test.ts` because that file is at the
 * 700-line limit and the rules worth asserting keep arriving — the guide's
 * own are in `guides.test.ts`. Text rather than a parsed stylesheet: these
 * tests read the same files the app ships, through Vite's `?raw`, and a real
 * CSS parser would be a dependency carried for a substring search.
 */

/**
 * The declarations of one rule, by property. Comments are stripped first.
 *
 * A grouped selector is found by its **last** member, since that is the one
 * followed by the brace.
 */
export function ruleIn(
  source: string,
  selector: string,
): Record<string, string> {
  const body = withoutComments(source);
  const at = body.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = body.indexOf("{", at);
  const close = body.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const line of body.slice(open + 1, close).split(";")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}
