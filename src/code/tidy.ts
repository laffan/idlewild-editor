/**
 * Tidying a file: Prettier, in the browser, over the file that is open.
 *
 * **Prettier rather than CodeMirror's own indenter**, which was the other
 * option and is a smaller thing than it sounds: `indentRange` fixes the left
 * edge of every line and nothing else, so a file somebody has been learning
 * in — a call broken across four lines in the middle of an argument list, a
 * stray double space, a missing semicolon — comes out of it exactly as
 * crooked as it went in. Prettier reprints the code from its own parse, which
 * is the thing "tidy" means to anybody who has used an editor before. It is
 * also the formatter this project's own templates are written to, so a
 * scaffolded file is already very nearly its output.
 *
 * **Loaded when it is first used, not when the panel opens.** Prettier and
 * its plugins are the better part of a megabyte and most sessions in the code
 * panel never tidy anything, so every parser is behind a dynamic `import`
 * and Vite gives each its own chunk.
 *
 * The editor's own lines are the one thing that makes this more than a call
 * into a library. A scaffolded file has runs the editor owns and rewrites —
 * see `managed-blocks.ts` — and ownership is decided by *the line still being
 * one of the lines the scaffold wrote*. A tidy that reprinted an owned line
 * would not break anything visibly: the line would simply stop being the
 * editor's, silently, and the block around it would start to dissolve. So the
 * result is checked before it is used, and a tidy that would move one of
 * those lines is declined rather than applied — see `ownedLinesSurvive`.
 */

import type { Plugin } from "prettier";

/** What Prettier is asked to parse a file as, or nothing for a file it cannot. */
export function parserFor(path: string): string | null {
  const name = path.toLowerCase();
  if (name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) {
    return "babel";
  }
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (name.endsWith(".md")) return "markdown";
  return null;
}

/** Whether Tidy has anything to offer this file at all. */
export function tidyable(path: string): boolean {
  return parserFor(path) !== null;
}

/**
 * The file, reprinted.
 *
 * Answers null for a file there is no parser for, and **throws** for a file
 * that does not parse — which is the ordinary case rather than a failure of
 * this function: a tidy is the first thing that reads the whole file as code,
 * so a missing brace turns up here. The caller says so in the bar; the error
 * Prettier throws names the line.
 */
export async function tidy(path: string, text: string): Promise<string | null> {
  const parser = parserFor(path);
  if (!parser) return null;
  const { format } = await import("prettier/standalone");
  return format(text, { parser, plugins: await pluginsFor(parser) });
}

/**
 * Whether a tidy left the editor's own lines alone.
 *
 * `owned` is 1-based line numbers into `before`, as `managed-blocks.ts`
 * counts them. Their **text** has to survive, in order, as lines of the
 * tidied file — not their numbers, which move as soon as anything above them
 * is reflowed, and not their indentation, which is Prettier's to decide and
 * the scaffold's own anyway.
 *
 * A subsequence rather than a set, because order is part of what a block is:
 * two owned lines that came out swapped would be a block that no longer says
 * what it did, and nothing else in the pipeline would notice.
 */
export function ownedLinesSurvive(
  before: string,
  after: string,
  owned: ReadonlySet<number>,
): boolean {
  if (owned.size === 0) return true;
  const source = before.split("\n");
  const wanted = [...owned]
    .sort((a, b) => a - b)
    .map((line) => source[line - 1]?.trim() ?? "")
    .filter((line) => line.length > 0);

  const lines = after.split("\n").map((line) => line.trim());
  let at = 0;
  for (const line of wanted) {
    const found = lines.indexOf(line, at);
    if (found < 0) return false;
    at = found + 1;
  }
  return true;
}

/**
 * The plugins one parser needs.
 *
 * `estree` is the printer every JavaScript-shaped parser hands its tree to,
 * which is why it rides with `babel` rather than being a parser of its own —
 * leaving it out is the mistake this function exists to make impossible.
 */
async function pluginsFor(parser: string): Promise<Plugin[]> {
  if (parser === "babel" || parser === "json") {
    const [babel, estree] = await Promise.all([
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    return [babel, estree] as Plugin[];
  }
  if (parser === "css") return [await import("prettier/plugins/postcss")] as Plugin[];
  if (parser === "html") return [await import("prettier/plugins/html")] as Plugin[];
  if (parser === "markdown") return [await import("prettier/plugins/markdown")] as Plugin[];
  return [];
}
