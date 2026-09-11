/**
 * The Phaser API reference, rendered.
 *
 * Ported from phaser-bench's `docs-renderer.js`. What it is given is one
 * entry out of `phaser-docs.json` — a signature, a description, parameters,
 * a return — which is JSDoc as the generator left it, so the description may
 * carry fenced code and markdown links and is put through the same inline
 * pass the guide documents use.
 */

import { esc, highlightJS, inline, truncate } from "./markdown";

/** One argument of a documented method. */
export interface ApiParam {
  name?: string;
  type?: string;
  optional?: boolean;
  desc?: string;
}

/** One member of a documented class: a method, or a property. */
export interface ApiMember {
  desc?: string;
  /** Absent for a property, which is how the signature loses its parens. */
  params?: ApiParam[];
  returns?: { type?: string; desc?: string };
  since?: string;
}

/** One prefix's worth of the reference — `this.add.`, `Phaser.Math.`, … */
export interface ApiSection {
  className: string;
  classDesc?: string;
  members: Record<string, ApiMember>;
}

export type ApiDocs = Record<string, ApiSection>;

/** One hit from a search over the reference. */
export interface ApiHit {
  prefix: string;
  member: string;
  entry: ApiMember;
  className: string;
}

/**
 * The signature line.
 *
 * `gameobject` is the generator's key for the methods every game object has,
 * and there is no expression a user would type for it — `.setScale` is what
 * they see and what the search results are keyed on.
 */
export function signature(prefix: string, name: string, entry: ApiMember): string {
  const shown = prefix === "gameobject" ? "." : prefix;
  if (!entry.params) return shown + name;
  const args = entry.params.map((p) =>
    p.optional ? `[${p.name ?? ""}]` : p.name ?? "",
  );
  return `${shown}${name}(${args.join(", ")})`;
}

/** One member, in full. */
export function renderMember(
  prefix: string,
  name: string,
  entry: ApiMember,
  className?: string,
): string {
  const parts: string[] = [];
  if (className) {
    parts.push(`<div class="docs-class-badge">From <code>${esc(className)}</code></div>`);
  }
  parts.push(`<div class="docs-signature">${esc(signature(prefix, name, entry))}</div>`);
  if (entry.desc) parts.push(`<div class="docs-desc">${description(entry.desc)}</div>`);

  if (entry.params && entry.params.length > 0) {
    parts.push('<div class="docs-section-title">Parameters</div>');
    parts.push('<ul class="docs-params">');
    for (const param of entry.params) parts.push(renderParam(param));
    parts.push("</ul>");
  }

  if (entry.returns) {
    parts.push('<div class="docs-section-title">Returns</div>');
    parts.push('<div class="docs-returns">');
    if (entry.returns.type) {
      parts.push(`<span class="docs-param-type">${esc(entry.returns.type)}</span>`);
    }
    if (entry.returns.desc) {
      parts.push(`<span class="docs-param-desc">${esc(entry.returns.desc)}</span>`);
    }
    parts.push("</div>");
  }

  if (entry.since) {
    parts.push(`<div class="docs-since">Since Phaser ${esc(entry.since)}</div>`);
  }
  return parts.join("\n");
}

/** A whole class, for a cursor on a prefix with no member after it. */
export function renderClass(prefix: string, section: ApiSection): string {
  const parts = [`<div class="docs-signature">${esc(section.className)}</div>`];
  if (section.classDesc) {
    parts.push(`<div class="docs-desc">${description(section.classDesc)}</div>`);
  }

  const names = Object.keys(section.members);
  if (names.length > 0) {
    parts.push('<div class="docs-section-title">Members</div>');
    parts.push('<ul class="docs-params">');
    for (const name of names) {
      const first = section.members[name].desc?.split("\n")[0] ?? "";
      parts.push(
        '<li class="docs-param">' +
          `<span class="docs-param-name">${esc(prefix + name)}</span>` +
          (first
            ? `<span class="docs-param-desc">${esc(truncate(first, 80))}</span>`
            : "") +
          "</li>",
      );
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

/** Nothing under the cursor. */
export function renderEmpty(): string {
  return (
    '<div class="docs-empty">Put the caret on a Phaser call — ' +
    "<kbd>this.add.sprite</kbd>, say — to read about it here.</div>"
  );
}

/** A list of search hits. */
export function renderHits(hits: ApiHit[], query: string): string {
  if (hits.length === 0) {
    return `<div class="docs-empty">No results for <kbd>${esc(query)}</kbd></div>`;
  }
  return hits
    .map((hit) => {
      const first = hit.entry.desc ? truncate(hit.entry.desc.split("\n")[0], 100) : "";
      return (
        `<div class="docs-search-result" data-prefix="${esc(hit.prefix)}"` +
        ` data-member="${esc(hit.member)}">` +
        `<div class="docs-search-result-name">${esc(signature(hit.prefix, hit.member, hit.entry))}</div>` +
        (first ? `<div class="docs-search-result-desc">${esc(first)}</div>` : "") +
        "</div>"
      );
    })
    .join("\n");
}

// ── JSDoc prose ─────────────────────────────────────────────────────────────

/**
 * A JSDoc description, which is markdown with fenced code in it.
 *
 * Paragraphs rather than a full markdown pass: these are single descriptions
 * rather than documents, and the only block they use is a fence.
 */
function description(text: string): string {
  const parts: string[] = [];
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text))) {
    if (match.index > last) parts.push(paragraphs(text.slice(last, match.index)));
    parts.push(`<pre><code>${highlightJS(match[2].trim())}</code></pre>`);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(paragraphs(text.slice(last)));
  return parts.join("");
}

function paragraphs(text: string): string {
  return inline(text.trim())
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, " ");
}

function renderParam(param: ApiParam): string {
  const parts = ['<li class="docs-param">'];
  parts.push(`<span class="docs-param-name">${esc(param.name ?? "")}</span>`);
  if (param.type) parts.push(`<span class="docs-param-type">${esc(param.type)}</span>`);
  if (param.optional) parts.push('<span class="docs-param-optional">optional</span>');
  if (param.desc) parts.push(`<span class="docs-param-desc">${esc(param.desc)}</span>`);
  parts.push("</li>");
  return parts.join("");
}
