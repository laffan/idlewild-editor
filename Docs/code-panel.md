# The code panel

CodeMirror 6 over the project's real file tree, the three places the panel can
sit, the reference along its bottom, and the console drawer that carries the
game's output back.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Where the code panel sits

There are three places, and they are three different jobs: a row above the
console, a column to the **right** of the canvas, and over the whole shell. The
first two are docks — part of the layout, with the canvas keeping whatever is
left — and the third is an overlay.

There was a left dock for one build. It was the right one mirrored, and code
about a canvas reads better *after* the canvas than in front of it, so it went
— `readPlacement` answers "right" for anyone who was in it, which is the same
column on the other side and the same remembered width.

**It opens on the bottom.** Code in this editor is code about the thing beside
it: the config follows the canvas, a save while a game is up restarts it, and a
console line opens the file it was written in — all of which you want to be
looking at while it happens, and the bottom dock is the placement that says so
with the least moved. The other two are in the pin's menu, and the choice is
remembered (`codePlacement`, and the old `codePinned` is read once for anyone
who only ever answered that: "not pinned" was today's full screen).

A column is there because a file is taller than it is wide. On a wide screen the
bottom dock gives the editor a strip of the window's height and the canvas the
rest; the column gives the editor the whole height of the row, which is the
shape the thing being edited actually is.

Docked, the panel is a row or a column of the shell and its divider writes an
inline `height` or `width` on it. Over the shell, it is `position: absolute;
inset: 0` — and an absolutely positioned box given top, bottom *and* a size is
over-constrained, so the browser drops `bottom` and the panel hangs from the top
at whatever size it was docked at. Every move therefore takes **both** inline
sizes off first, in `place`, and the new placement's divider puts its own back —
which is also how each placement keeps a size of its own: a height for the
bottom, a width for the two columns. Without that, moving from a column to the
overlay does not look like an overlay; it looks like the panel jumped to the top
of the screen, which is exactly what it did.

### One bar of chrome, where there were three

The panel had a **head** across the top carrying three placement buttons, Docs
and Close; a **file bar** under it carrying the column's switch and the open
file's name; and a **footer** under the editor carrying Save, the words "⌘S"
and a pair of history buttons. Sixty, forty-four and fifty-six pixels — a
hundred and sixty of the window spent on nine controls, in a section whose
whole subject is a file taller than the screen, on a device where the screen is
not large to begin with. The editor is developed on an iPad; that is a third of
a bottom dock gone before a line of code is shown.

It is **one 44px row** now, `code/code-bar.ts`, and it reads left to right as
two groups. On the left, what is about the **file** under it: the column's
switch, the path, whether it is saved, and whatever the editor last had to say
about an edit. Right-aligned, what is about the **panel**: the pin, the
reference, Close. That is the same sentence the head and the file bar were
saying between them, in one row instead of two — and it is why the three that
moved are the ones that moved, rather than the ones that happened to fit.

**The pin is a menu now.** Three is still the right number of places, and a
control that *cycled* through them would be a guessing game — but a menu is
not a cycle: it says all three at once, ticks the one in force rather than
dropping it, and costs the bar a single 32px button instead of most of its
width. Docs loses its word for the same reason; the book is what the reference
is everywhere else in this editor, and the sentence it stood beside is on its
tooltip. All four buttons in the bar are now the same 32px square, where they
had been a bordered pill, a labelled group and a full-height icon button on
two different bars.

**The footer is gone outright, not moved.** Nothing on it did anything the
keyboard does not — ⌘S, ⌘Z, ⇧⌘Z — and the two jobs Save was quietly doing are
done without it: the modal writes a dirty file when another is opened in it
(`openFile`) and when the section is left (`CodePanel.hide`), so nothing typed
can be lost by leaving. The history pair went with it; the editor's own header
carries one that follows the caret in here. What that costs is the full-screen
placement, where the header is covered: there, on a device with no keyboard,
there is now no button for undo. That is the trade — 56px of every file in
every placement against two buttons in one of them.

**Two safe-area insets had to be caught by what is left.** The head owned the
top, so the file bar takes it or it sits under the iPad's status bar; the
footer owned the bottom, so `.code-panel` takes it or the last line of the file
sits under the home indicator. Both fail silently and neither fails on a Mac,
which is why `styles.test.ts` asserts them.

**And the path had to learn to be cut.** One row means the filename shares it
with everything else, and in a 260px column dock `js/prefabs/character.js` has
to lose something. It is two spans rather than one string: the folders shrink
and ellipsize, the filename never does, and the whole path is on the title. A
bar that cut the other way would be a bar naming a folder.

**New File and New Folder are over the column they create into**, which is where
they belong: they read which file is open to decide where a new one goes, and
they used to sit in the head, a long way from the thing they make. They are the
width of that column and shorter than a button in the bar, because they are a
strip rather than a row of chrome — and in a column dock they stack, because 170
px is not two names wide and clipping "New Folder" to "New Fold" is the other
answer.

**The reference takes whichever side the panel has room for** (`placeDocs`):
beside the editor when the panel is wide — the bottom dock and the full-screen
one — because a reference page is a column of prose and the bottom dock has no
height to spare for one; under the editor when the panel is itself a column,
where there is no width to give away and where phaser-bench had it. Each side is
a divider on a different axis, so each remembers its own size and the inline
size the other one wrote comes off first — the same trap as the panel's own
placements, one level down.

**Beside the editor it is the same panel turned sideways, and it was not.** Its
contents list used to stack *above* the page there rather than staying beside
it, which was wrong twice over: a contents list reads as a column and a page of
prose reads under a heading, and the page was then a `flex: 1` child of a
column with no `min-height: 0` — so it could not shrink below its own content,
grew past the panel, and was cut off by the panel's `overflow: hidden` with no
scrollbar to get any of it back. A longer page showed *less* of itself, which
is not a shape anybody debugs quickly. The nav stays beside the page on both
sides now, narrower where the column is, and `.docs-content` carries a
`min-height: 0` as well as its `min-width: 0` because the panel is laid out
both ways.

**And it may have the whole height of the row it is in.** The rule that was
actually cropping it is `.code-backdrop.docked .docs-panel { max-height: 50% }`
— right for a reference stacked on a 320px bottom dock, which has to leave the
editor above it something, and meaningless for one *beside* the editor, where
the height is the row's and there is nothing underneath to leave room for. A
`max-height` is also the one thing that beats the `height: auto` a stretched
flex item needs, so the panel stopped at half the dock and its page was cut off
at the same line however long the page was. Lifted for `docs-right` only.

**The file column folds two ways.** Its folders collapse — the list Rust returns
is flat and sorted, so "inside" is a path prefix and a shut folder is rows not
rendered — and the choice is remembered per install rather than per project,
because `js/shared` means the same thing in every project this editor makes and
a fold that reset every time Code was left is a fold nobody would use. Opening a
file opens the folders above it, so a file reached from a console line is still
findable in the column, and a drop into a shut folder opens it rather than
looking like the file went nowhere. The whole column comes off on the switch
beside the open file's path, which is the control a 420 px column dock most
wants: the tree is the half you only need between files.

### The file it opens with

The panel is built on the way into Code and destroyed on the way out. That is
what makes Code a *section* rather than a floating window, and it is also why
"which file is open" cannot live in the panel: every visit would decide it
again. It did, and the answer was a constant — `js/scenes/WorldScene.js`, the
one scene file a project had when there was only ever one. A project
scaffolded since is a file per scene named after it, so that lookup found
nothing and a new project opened into an empty editor; an old one opened into
its scene and then closed it again the moment you went to look at the canvas.

`code/last-file.ts` holds it outside the panel, in `localStorage` beside the
folds the file column keeps. Two things about the shape:

- **Keyed by project.** A path means nothing across them —
  `js/prefabs/character.js` is a different file in each — so it is a map, and
  the map is capped at the most recent thirty-two so a row per project ever
  opened is not something nobody prunes.
- **A remembered file that no longer exists is not an answer.** `opening`
  takes the listing as well as the remembered path and only answers with one
  the tree still has, as a file rather than a folder. Then the project's first
  scene — not `js/scenes/index.js`, which is a generated list of scenes rather
  than a scene — then `js/main.js`, then whatever is first. A project with no
  files at all answers null and the panel opens with no file, which is the
  honest thing to show.

A rename carries the answer with it (`onMoved`), and a delete drops it, so the
next visit falls through rather than looking for something that is not there.

---

### Find, twice, because there are two questions

⌘F is about the file in front of you and ⇧⌘F is about the project. They are two
panels, coordinated by `code/finding.ts`, and where each one *is* is most of
what it means.

**⌘F floats over the editor.** The panel already spends one 44px bar of a
window on chrome, in a section whose whole subject is a file taller than the
screen; a fifth dock would cost every placement another forty pixels for
something that is up for as long as it takes to type six characters. So it is
absolutely positioned in the top right of the editor column — which is why
`.code-main` carries `position: relative`, asserted in `styles.test.ts`,
because without a containing block the box hangs off the shell instead and
nothing throws. It opens seeded from the selection, when the selection is one
line's worth, and it selects the match rather than only scrolling to it, so
Escape leaves the caret on what you were looking for.

**⇧⌘F stands at the top of the file column.** Its answers are files, and the
column of files is already there; a second floating window listing files, over
a panel with a list of files down its left edge, would be the same list twice.
The results take the column while they are up (`FileTree.setSearching`, and one
rule in `code.css`) because a 170px column dock has room for one list at a
time — nothing is destroyed, so the tree comes back folded exactly as it was,
with the same row still marked open.

**Both are plain substring, with a case switch.** What anybody searches for in
this tree is `config.scenes` or `place(`, and a box that quietly reads those as
patterns answers a question nobody asked. Case is the one option that is
genuinely wanted, because `Scene` and `scene` are a class and a variable in
every file here.

**The cross-file half is Rust.** `game_search.rs` is one call per query rather
than a read per file — the alternative is twenty round trips and twenty copies
of the tree crossing the IPC boundary as JSON strings on every keystroke — and
it walks `store::list_game_files`, the same listing the column shows, so a
result and a row are the same set of files said twice. It skips what it cannot
read as text (somebody will drop a PNG into `game/`) and what is over 512 KiB,
and caps the answer at three hundred matches, saying so.

The one subtle thing in it is the **column**. The frontend adds it to a
CodeMirror line offset, and CodeMirror counts a document the way JavaScript
counts a string, in UTF-16 code units. A byte offset would be right for every
ASCII file in this tree and one place out on the first line carrying an em dash
in a comment — which is most comment lines in a project this editor scaffolded.
So the scan works in `char`s and the column is a sum of `len_utf16`. Case
folding is done **per character**, taking a character's lower case only when it
has exactly one, for the same reason: `char::to_lowercase` is an iterator
because a few characters lowercase to several, and a folded line of a different
length from the line it came from is how an offset ends up pointing at the
wrong place.

Both bindings are registered **twice**, and that is deliberate. CodeMirror's
content is `contenteditable`, so a keystroke in the editor goes to its keymap
and never reaches a document-level listener — `editor/shortcuts.ts` stands down
for text fields by design. The keymap entries are in `editor-state.ts`;
`Finding.handleShortcut` covers the rest of the panel, and `defaultPrevented`
is what stops the two from both firing as an event bubbles out of the editor.
Preventing the default matters beyond tidiness: WKWebView takes an
un-prevented ⌘F as its own page search.

---

## The reference along the bottom of the code modal

Ported from phaser-bench, where it sits under the editor for the reason it
sits under this one: the question *what does this method take?* arrives while
you are typing the method, and an answer in another window is an answer you
go and look up rather than read. Docs opens a fourth region of the modal on a
divider of its own, remembered like the console's.

Four references behind one toggle, and the panel knows none of them apart —
`docs/types.ts` is the six questions it asks of whichever is selected, and
everything else is a `DocsSource`.

| Source | What it is | Where it comes from |
|---|---|---|
| Concepts | Phaser's prose guides, 48 pages | `public/data/phaser-concepts/` |
| API | Phaser's own JSDoc, keyed by expression | `public/data/phaser-docs.json` |
| JS / CSS / HTML | MDN's reference, ~2,800 pages | `public/data/web-docs/` + a generated index |
| P2P | psd-to-phaser's docs, 18 pages | `public/data/p2p-docs/` |

**Automatic follows the caret.** `code-modal.ts` reports every selection
change into `panel.onCursor(lineText, col, path)`, and the source works out
what is under it: `phaser-api.ts` matches the expression prefixes people
actually type — `this.physics.add.`, `Phaser.Math.` — longest-first, since
`this.` is a prefix of half the others and would otherwise answer for all of
them. The word under the caret is read from both sides of it, so `setSc|ale`
asks about `setScale`. The two written guides have nothing a caret could
mean, so Automatic is hidden while one is up and the nav column takes its
place — which is what `cursorMode` on the source is for.

**MDN follows the file.** A caret in `styles.css` asks the CSS reference and
one in `index.html` asks the HTML reference, so that one button changes its
own label between JS, CSS and HTML as the editor moves between files. It is
told even while the panel is closed, so the label is right before anyone
looks at it rather than one keystroke later.

**The index is loaded; the pages are not.** `web-docs-index.json` is 884 KB of
title, description, path and page type, plus three maps from the thing you
would type to the page about it. A page is fetched only when it is opened, and
kept in a small cache — there are 2,806 of them and they are 38 MB together.
For the same reason the Automatic mode shows the index's one-line description
first and swaps the full page in behind it, guarded on the caret not having
moved on.

**The two guides were one module twice.** phaser-bench's `concepts-docs.js`
and `p2p-docs.js` were the same two hundred lines with different constants, so
`guide.ts` is a factory called twice. Their search is full text over an index
built in the background on load: forty-odd small files, where a title-only
search answers "tilemap" with nothing at all. A title match outscores a body
match by two orders of magnitude, and body matches are capped per word so one
page repeating a term cannot bury the page that is about it.

**P2P is always there.** In phaser-bench that button appeared only for
sketches that used the plugin, and it read `js/main.js` after every sketch
switch to decide. Every Idlewild project is a psd-to-phaser project, so the
check and the switching it hung off both go.

**Markdown, not a markdown library.** `markdown.ts` reads the part of markdown
this corpus uses — headings, lists, blockquotes, fenced code, links, inline
emphasis — plus MDN's KumaScript macros, which are stripped or reduced to
their first argument because there is nothing on the other end of them here.
It renders to a string and the panel assigns it with `innerHTML`, which is
safe on one condition the file states and the tests pin: every piece of text
goes through `esc` before a tag is put near it, so the only HTML in the output
is the HTML it wrote.

### Where the data came from

All of it is vendored, generated by phaser-bench's `scripts/build-phaser-docs.js`
(which clones Phaser and reads its JSDoc) and `scripts/build-web-docs.js`
(which indexes a checkout of `mdn/content`). The generators are not ported
here: they are run once per upstream release, and the second one needs an MDN
clone staged by hand first. Re-running them there and copying `public/data/`
across is the way to move the pin.

The MDN pages are CC BY-SA 2.5, which is why every page rendered from them
carries a line saying so.

---

## Console

`lib/log.ts` wraps `console.*` and interprets format directives rather than
joining raw arguments. Phaser's boot banner is a `%c`-styled string with two
CSS arguments; joined naively it dumps a base64 `background-image` across the
drawer on every launch. `%c` runs become styled spans, and the style is
filtered down to colour and weight — a banner has no business setting padding
or loading images inside the log.

Output uses Fira Code (bundled, not fetched — the editor works offline) and
opts back into text selection, which the shell suppresses globally so a drag
on chrome never highlights it.

### A line is parts, not a string

An entry carries a list of **parts**: runs of text, with whatever styling a
`%c` asked for, and *values* — arguments that were objects, which the drawer
draws as a tree you can open a level at a time (`editor/log-tree.ts`), with
keys, strings, numbers, booleans and nulls each shown as what they are.
Children are built on first open, so a five-hundred-line drawer has not built
any of them.

The value in a part is a **snapshot**, never the object (`lib/log-value.ts`).
Two reasons, and the second is the hard one: the drawer keeps its last 500
lines, so live references would pin every sprite ever logged; and the game
frame is a different origin, which can only post — and a structured clone of a
Phaser scene throws before it gets anywhere.

The snapshot is tagged rather than plain JSON, because the tags are the things
a console is for. `"5"` is not `5`; `NaN` and `-0` do not survive a JSON round
trip; a class instance says which class (`Body {vx: 0, vy: 12}`) where a plain
object stays unlabelled; a `Map` or `Set` is opened, since Phaser is full of
both and `Map {}` says nothing; and `[Circular]` is a cut cycle rather than a
string that happens to read that way. `seen` is the chain of *ancestors*, not
everything visited, so the same sprite logged twice side by side is shown
twice. Depth caps at 4, entries at 100, and what was cut is counted rather
than quietly dropped.

A snapshot shows what was true when the line was written, where devtools shows
what is true when you open it. That is a difference worth knowing and, for a
game mutating one sprite sixty times a second, mostly an improvement.

**The same flattening exists twice.** The bridge cannot import
`log-value.ts` — different origin, plain injected script — so it carries its
own copy, and hangs it off `window.__idlewildSnapshot` before it looks for a
parent. `__tests__/log-value.test.ts` runs both over the same fixtures, which
is what holds one contract across two implementations.

### LOG is a link

`console.log` is labelled **LOG**, not INFO: `log` is what you write while
debugging and `info` is what a library announces itself with, and the editor's
own commentary is the second kind. So `LogLevel` has both.

Where a line came from a file the code modal can open, its level chip *is* the
way back to it — the fastest thing in a console is the one that answers "where
did this come from". The bridge reads the site out of a thrown error's stack
with one regex for two engines (JSC writes `fn@url:line:col`, V8 writes
`    at fn (url:line:col)`), and steps over two kinds of frame that are never
the answer: its own, and anything under `lib/`. That second skip is why a
`console.log` reached through a Phaser callback still reports the line you
wrote. `siteIn` is pure and exposed for the same reason the snapshot is;
`__tests__/console-site.test.ts` puts real stacks from both engines through
it.

Clicking the chip opens the code modal — pinned, if it was not already up — at
that file, centres the line and selects it, so the active-line highlight lands
on it rather than leaving you to count rows. The editor's own JS lines carry
no site: the frames behind them are this bundle's, and a link into a minified
chunk is a link to nowhere.

### App and JS

The drawer does double duty, so every entry carries a `source` and the header
carries a toggle for each.

**App** is the editor talking about itself: every `log.info`/`warn`/`error`
call in this codebase, plus psd-to-json's progress, which arrives from Rust as
`psd-log-line`. **JS** is the JavaScript console — whatever `console.*` is
handed in this page, plus everything the game frame forwards, plus uncaught
errors and rejected promises from both. The App half is all `info`, which is
what makes the JS half's `log` legible beside it.

The two are told apart at the call site rather than afterwards: the editor's
own commentary goes through `info`/`warn`/`error` and never touches `console`,
and `captureConsole` tags what it wraps. `logFrom({ source, site }, level, …)`
is the one entry point that says which, and the only one that can attach a
site.

The toggles are right-aligned in the header bar and appear only while the
drawer is open — a filter on output you cannot see is chrome for nothing. The
choice is remembered in `localStorage` under `consoleSources`, and both are on
for anyone who has never touched them.

An `Error` is now stringified with its stack. `TypeError: undefined is not an
object` with no frame under it names nothing you can go and look at, and a
frame is the point of the JS half.

**Clear** sits beside the two toggles and is not a third one. A filter hides
lines; this throws them away, both sources at once, which is what you press
before trying the thing you are actually debugging so that what appears next
is only about that. It goes through `log.clearLog`, so the store and every
drawer painting from it empty together. Not remembered, and not undoable — the
console is a record of what happened rather than a document.
