/**
 * Markdown to HTML, for the documents the docs panel shows.
 *
 * Ported from phaser-bench's `web-docs-renderer.js`. It is deliberately not a
 * markdown library: what it has to read is a known corpus — MDN's reference
 * pages, Phaser's concept guides and psd-to-phaser's MDX — and the parts of
 * markdown they use are headings, lists, blockquotes, fenced code, links and
 * inline emphasis. A dependency that handled the rest would be a dependency
 * to ship to an iPad for no visible gain.
 *
 * **Everything is escaped on the way in.** Text goes through `esc` before any
 * tag is added, so the only HTML in the output is the HTML this file wrote.
 * That matters because the result is assigned with `innerHTML`: the corpus is
 * vendored rather than typed by anyone, but a renderer that passed source
 * HTML through would still be a renderer that could.
 *
 * MDN's macros — `{{jsxref("Array")}}`, `{{EmbedInteractiveExample}}` and the
 * rest — are stripped or reduced to their first argument first, because they
 * are KumaScript rather than markdown and there is nothing on the other end
 * of them here.
 */

/** Escape text for HTML. Everything rendered here goes through it. */
export function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shorten a string for a one-line summary. */
export function truncate(str: string, max: number): string {
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}

/** Render a whole markdown document. */
export function renderMarkdown(raw: string): string {
  return convert(cleanMacros(stripFrontmatter(raw)));
}

/** Take the YAML block off the top of an MDN or MDX page. */
export function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : raw;
}

/**
 * Reduce MDN's KumaScript macros to something a reader can use.
 *
 * The cross-reference macros carry the name of the thing they point at, so
 * they become inline code; the embedding ones point at live examples that are
 * not here, so they go entirely.
 */
export function cleanMacros(text: string): string {
  let out = text;
  out = out.replace(
    /\{\{(?:InteractiveExample|EmbedInteractiveExample|EmbedLiveSample)\([^)]*\)\}\}/g,
    "",
  );
  out = out.replace(
    /\{\{(?:cssxref|jsxref|HTMLElement|domxref|HTMLAttrDef|htmlattrxref|SVGElement|mathMLElement|httpheader|glossary|RFC)\(["']([^"']+)["'](?:,\s*["'][^"']*["'])?\)\}\}/gi,
    (_, name: string) => `\`${name}\``,
  );
  out = out.replace(
    /\{\{Glossary\(["'][^"']+["'],\s*["']([^"']+)["']\)\}\}/gi,
    "$1",
  );
  // Anything left with no argument worth keeping.
  out = out.replace(/\{\{[^}]*\}\}/g, "");
  // GitHub-style callouts, which markdown proper has no idea about.
  out = out.replace(/^>\s*\[!(NOTE|WARNING|CALLOUT)\]\s*$/gm, "> **$1:**");
  return out;
}

/** MDX component tags, which psd-to-phaser's docs carry and this cannot run. */
export function stripComponents(text: string): string {
  return text.replace(/<\w+[^>]*\/>/g, "");
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function convert(md: string): string {
  const parts: string[] = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(md))) {
    if (match.index > last) parts.push(convertBlock(md.slice(last, match.index)));
    // "js interactive-example-choice" and "js-nolint" are both JavaScript.
    const lang = match[1].trim().split(/[\s-]/)[0];
    parts.push(
      `<pre><code class="lang-${esc(lang || "text")}">` +
        `${highlight(match[2].trim(), lang)}</code></pre>`,
    );
    last = match.index + match[0].length;
  }
  if (last < md.length) parts.push(convertBlock(md.slice(last)));
  return parts.join("");
}

function convertBlock(text: string): string {
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  let quoting = false;

  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  const openList = (kind: "ul" | "ol") => {
    if (list === kind) return;
    closeList();
    html.push(`<${kind}>`);
    list = kind;
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      if (quoting) {
        html.push("</blockquote>");
        quoting = false;
      }
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      // One level down: the panel's own heading is above all of this.
      const level = Math.min(heading[1].length + 1, 6);
      const text = heading[2]
        .replace(/\[?​?\]\(#[\w-]+(?: "[^"]*")?\)\s*$/, "")
        .trim();
      html.push(
        `<h${level} id="${esc(anchorFor(text))}">${inline(text)}</h${level}>`,
      );
      continue;
    }

    if (trimmed.startsWith("> ")) {
      if (!quoting) {
        html.push("<blockquote>");
        quoting = true;
      }
      html.push(`<p>${inline(trimmed.slice(2))}</p>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      openList("ul");
      html.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.*)/);
    if (ordered) {
      openList("ol");
      html.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inline(trimmed)}</p>`);
  }

  closeList();
  if (quoting) html.push("</blockquote>");
  return html.join("\n");
}

/** The id a heading gets, so its own table of contents can reach it. */
export function anchorFor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * Inline markdown: code, emphasis, links.
 *
 * A link to an anchor scrolls inside the panel; anything else opens outside
 * it, because the panel is a reader rather than a browser.
 */
export function inline(text: string): string {
  let html = esc(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, url: string) =>
      url.startsWith("#")
        ? `<a href="${url}" class="docs-internal-link">${label}</a>`
        : `<a href="${url}" target="_blank" rel="noopener">${label}</a>`,
  );
  return html;
}

// ── Syntax highlighting ─────────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "new", "this", "class",
  "extends", "import", "export", "default", "throw", "try", "catch",
  "finally", "typeof", "instanceof", "in", "of", "async", "await", "yield",
]);
const JS_LITERALS = new Set([
  "true", "false", "null", "undefined", "NaN", "Infinity",
]);

/** Colour a code block. Unlabelled fences are taken as JavaScript. */
export function highlight(code: string, lang?: string): string {
  if (lang === "css") return highlightCSS(code);
  if (lang === "html") return highlightHTML(code);
  return highlightJS(code);
}

export function highlightJS(code: string): string {
  const re =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[a-zA-Z_$][\w$]*/g;
  return paint(code, re, (token, source, at) => {
    if (token.startsWith("//") || token.startsWith("/*")) return "hl-cmt";
    if (/^["'`]/.test(token)) return "hl-str";
    if (/^\d/.test(token)) return "hl-num";
    if (JS_KEYWORDS.has(token)) return "hl-kw";
    if (JS_LITERALS.has(token)) return "hl-const";
    if (source[at + token.length] === "(") return "hl-fn";
    return null;
  });
}

function highlightCSS(code: string): string {
  const re =
    /\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b|@[\w-]+|[a-zA-Z][\w-]*(?=\s*:)|:[a-zA-Z][\w-]*/g;
  return paint(code, re, (token) => {
    if (token.startsWith("/*")) return "hl-cmt";
    if (/^["']/.test(token)) return "hl-str";
    if (token.startsWith("#") || /^\d/.test(token)) return "hl-num";
    if (token.startsWith("@")) return "hl-kw";
    if (token.startsWith(":")) return "hl-const";
    return "hl-fn";
  });
}

function highlightHTML(code: string): string {
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*|>|"[^"]*"|'[^']*'|\b[a-zA-Z][\w-]*(?==)/g;
  return paint(code, re, (token) => {
    if (token.startsWith("<!--")) return "hl-cmt";
    if (token.startsWith("<") || token === ">") return "hl-kw";
    if (/^["']/.test(token)) return "hl-str";
    return "hl-fn";
  });
}

/** Walk a code string with one regex, wrapping what the classifier names. */
function paint(
  code: string,
  re: RegExp,
  classify: (token: string, source: string, at: number) => string | null,
): string {
  const out: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code))) {
    if (match.index > last) out.push(esc(code.slice(last, match.index)));
    const token = match[0];
    const cls = classify(token, code, match.index);
    out.push(cls ? `<span class="${cls}">${esc(token)}</span>` : esc(token));
    last = match.index + token.length;
  }
  if (last < code.length) out.push(esc(code.slice(last)));
  return out.join("");
}
