import { describe, expect, it } from "vitest";
import {
  cleanMacros,
  esc,
  renderMarkdown,
  stripComponents,
  stripFrontmatter,
} from "../docs/markdown";
import { lookupAt } from "../docs/phaser-api";
import { rank, renderNav, terms } from "../docs/guide";
import { signature } from "../docs/api-render";
import { PHASER_CONCEPTS, P2P_TOPICS } from "../docs/topics";
import type { Topic } from "../docs/types";

/**
 * The markdown renderer, which is the panel's whole reading surface.
 *
 * It is not a markdown library on purpose — what it reads is a known corpus
 * — so these pin the parts of markdown that corpus actually uses.
 */
describe("renderMarkdown", () => {
  it("renders headings one level down, with an id to link to", () => {
    // The panel's own heading is above all of this, so an `#` inside a page
    // is an h2 rather than an h1.
    expect(renderMarkdown("# Cameras")).toContain('<h2 id="cameras">Cameras</h2>');
    expect(renderMarkdown("## Fade effects")).toContain(
      '<h3 id="fade-effects">Fade effects</h3>',
    );
  });

  it("renders lists, and closes them when the prose resumes", () => {
    const html = renderMarkdown("- one\n- two\n\nAfter.");
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html).toContain("<p>After.</p>");
  });

  it("highlights a fenced block and keeps its language", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain('<code class="lang-js">');
    expect(html).toContain('<span class="hl-kw">const</span>');
    expect(html).toContain('<span class="hl-num">1</span>');
  });

  it("takes an anchor link in-panel and sends every other link out", () => {
    expect(renderMarkdown("[Down there](#usage)")).toContain(
      '<a href="#usage" class="docs-internal-link">Down there</a>',
    );
    expect(renderMarkdown("[MDN](https://developer.mozilla.org)")).toContain(
      'target="_blank"',
    );
  });

  it("escapes what it renders", () => {
    // The corpus is vendored rather than typed, but the renderer is still the
    // thing standing between a file and `innerHTML`.
    const html = renderMarkdown("A <script>alert(1)</script> tag");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(esc('"&<>')).toBe("&quot;&amp;&lt;&gt;");
  });
});

describe("MDN's macros", () => {
  it("keeps what a cross-reference names and drops the macro", () => {
    expect(cleanMacros('See {{jsxref("Array.prototype.map()")}}.')).toBe(
      "See `Array.prototype.map()`.",
    );
    expect(cleanMacros('{{cssxref("flex-basis")}}')).toBe("`flex-basis`");
  });

  it("removes the embeds, which point at examples that are not here", () => {
    expect(cleanMacros("{{EmbedInteractiveExample('pages/js/array.html')}}x")).toBe("x");
    expect(cleanMacros("{{AvailableInWorkers}}")).toBe("");
  });

  it("turns a GitHub callout into a blockquote markdown understands", () => {
    expect(cleanMacros("> [!NOTE]\n> Careful.")).toBe("> **NOTE:**\n> Careful.");
  });
});

describe("frontmatter and MDX", () => {
  it("takes the YAML block off an MDN page", () => {
    expect(stripFrontmatter("---\ntitle: Array\n---\nBody")).toBe("Body");
    expect(stripFrontmatter("No frontmatter")).toBe("No frontmatter");
  });

  it("drops MDX component tags, which there is nothing here to run", () => {
    expect(stripComponents('a <Interactive src="x" /> b')).toBe("a  b");
  });
});

/**
 * What the caret is sitting in, for the Phaser reference.
 *
 * The prefixes overlap — `this.` is a prefix of `this.input.keyboard.` — so
 * the order they are tried in is the whole of this.
 */
describe("lookupAt", () => {
  const at = (line: string) => lookupAt(line, line.length);

  it("takes the longest prefix that matches", () => {
    expect(at("    this.input.keyboard.createCursorKeys")).toEqual({
      prefix: "this.input.keyboard.",
      member: "createCursorKeys",
    });
    expect(at("    this.add.sprite")).toEqual({
      prefix: "this.add.",
      member: "sprite",
    });
  });

  it("reads the whole word when the caret is inside it", () => {
    // "setSc|ale" is a question about setScale, not about setSc.
    const line = "    this.hero.setScale(2)";
    expect(lookupAt(line, line.indexOf("Scale"))).toEqual({
      prefix: "gameobject",
      member: "setScale",
    });
  });

  it("falls back to a game object method on a chained call", () => {
    // `this.` matches, but the caret is past its member and on a method of
    // whatever `clouds` turned out to be.
    const line = "    this.clouds.setAlpha";
    expect(lookupAt(line, line.length)).toEqual({
      prefix: "gameobject",
      member: "setAlpha",
    });
  });

  it("has nothing to say about a line with no expression in it", () => {
    expect(at("  // a comment")).toBeNull();
    expect(at("")).toBeNull();
  });
});

describe("signature", () => {
  it("gives a property no parentheses and a method its arguments", () => {
    expect(signature("this.", "add", { desc: "" })).toBe("this.add");
    expect(
      signature("this.add.", "sprite", {
        params: [{ name: "x" }, { name: "y" }, { name: "key", optional: true }],
      }),
    ).toBe("this.add.sprite(x, y, [key])");
  });

  it("shows the generic member key as the dot people type", () => {
    expect(signature("gameobject", "setScale", { params: [{ name: "x" }] })).toBe(
      ".setScale(x)",
    );
  });
});

/** The written guides: their search, and their table of contents. */
describe("guide search", () => {
  const topics: Topic[] = [
    { title: "Cameras", path: "cameras.md" },
    { title: "Tweens", path: "tweens.md" },
    { title: "Input", path: "input.md" },
  ];
  const indexed = [
    { topic: topics[0], words: terms("the camera follows a sprite") },
    { topic: topics[1], words: terms("a tween moves the camera smoothly") },
    { topic: topics[2], words: [] },
  ];

  it("puts a title match above a page that merely mentions it", () => {
    expect(rank(indexed, "camera").map((t) => t.title)).toEqual(["Cameras", "Tweens"]);
  });

  it("matches on what was written rather than on a stem of it", () => {
    // "cameras" is not a word either body uses, so only the title answers.
    expect(rank(indexed, "cameras").map((t) => t.title)).toEqual(["Cameras"]);
  });

  it("finds a page by its body when the title says nothing", () => {
    expect(rank(indexed, "smoothly").map((t) => t.title)).toEqual(["Tweens"]);
  });

  it("has nothing to say about a word nobody wrote", () => {
    expect(rank(indexed, "tilemap")).toEqual([]);
  });

  it("drops the words that would match everything", () => {
    expect(terms("The camera and the sprite")).toEqual(["camera", "sprite"]);
  });
});

describe("renderNav", () => {
  const topics: Topic[] = [
    { title: "Loading", path: "loading/load.mdx", children: [
      { title: "Load Multiple", path: "loading/load-multiple.mdx" },
    ] },
    { title: "Layers", path: "layers/place.mdx" },
  ];

  it("opens the branch the open page is on", () => {
    const html = renderNav(topics, "loading/load-multiple.mdx");
    expect(html).toContain('class="docs-nav-children expanded"');
    expect(html).toContain('class="docs-nav-item child active"');
  });

  it("leaves a branch closed when nothing in it is open", () => {
    const html = renderNav(topics, "layers/place.mdx");
    expect(html).toContain('class="docs-nav-children"');
    expect(html).toContain('data-path="layers/place.mdx"');
  });
});

/** The tables of contents are data, and the panel is only as good as they are. */
describe("topics", () => {
  it("names a file for every entry, and no entry twice", () => {
    for (const tree of [PHASER_CONCEPTS, P2P_TOPICS]) {
      const paths = tree.flatMap((t) => [t.path, ...(t.children ?? []).map((c) => c.path)]);
      expect(paths.length).toBe(new Set(paths).size);
      for (const path of paths) expect(path).toMatch(/\.mdx?$/);
    }
  });
});
