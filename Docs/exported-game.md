# The exported game

What a published site is made of, what Play runs, the config the project's own
code reads, the page around the canvas, and the handful of lines in a
scaffolded file that the editor keeps ownership of.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Publish, and what the exported game reads

An export is the project's `game/` tree, its processed `assets/`, the two
vendored runtimes, and one file the export writes rather than copies:
`game.config.json`.

The tree it copies is laid out as a small web project is:

```text
index.html
styles.css
js/main.js               registers the scenes and starts the game
js/game.config.json      generated — see `game_config`
js/lib/                  Phaser and psd-to-phaser, written in by the exporter
js/scenes/index.js       generated — the scene list `main.js` reads
js/scenes/<Scene>.js     one per scene in the editor, and the author's
js/shared/canvas.js      the document, drawn: loading, camera, fills, placements, patterns
js/shared/character.js   the genre's wiring between the document and what moves in it
js/shared/grid.js        the projection, and the document's geometry
js/shared/…              the genre's own module: navigation.js or physics.js
js/prefabs/character.js  the body, the walk and the artwork — the author's
```

**`js/lib/` is the one directory with nothing behind it in the store.** The two
runtimes are 1.5 MB that would be identical in every project and are already
constants in this binary, so `file_server` answers for them while a project is
played and `publish` writes them into the zip. Everything else is real files the
code modal opens.

**A project made before that layout keeps the one it was made with.** Its
`game/` tree is its own copy, and nothing rewrites a page someone may have
edited — so both halves of the runtime shim answer both layouts. The server
strips `game/js/lib/` or `game/lib/`; the exporter reads the project's own
`index.html` and writes the runtimes where that page asks for them
(`publish::runtime_dir`). `templates::MOVED` does the same job for the code
modal: a Reset asked for `js/grid.js` is answered with the pristine
`js/shared/grid.js`, because they are the same file under two names and the
block ids inside them are identical.

`js/scenes/WorldScene.js` is deliberately **not** in that table. The file that
replaced it is a short one with no blocks in it at all, so answering with that
would not put anything back — a project holding the old thousand-line scene
keeps it, keeps running it, and owns every line of it from now on. Nothing in
`sync_scene_files` touches such a project either: the test there is whether
`js/shared/canvas.js` exists, which only the new scaffold writes.

That file is the document, in the shape `shared/canvas.js` reads it. Everything
else in `game/` is the user's source — the code modal edits it, and an export
must not overwrite what someone typed — but the config is *generated*, and
shipping the empty one the scaffold wrote is what made an export run and start
empty. `src-tauri/src/game_config.rs` owns its shape and both writers go
through it: `empty()` at scaffold time, `from_document()` on the way out. The
zip skips `js/game.config.json` when copying the tree and writes the generated
one in its place, because two entries under one name in an archive is not
something to rely on a reader resolving.

The config is a *projection* of the document, not a second copy. Rust
deserialises only the fields the scenes read, every one of them optional, so a
document written before zones or rectangle fills or instances existed still
exports. What it carries:

| field | what the scene does with it |
| --- | --- |
| `psdKeys` | `P2P.load.load` in `preload()`, one per key |
| `layers[]` | in order, top-first; the index becomes the depth |
| `fills[]` | painted, and a non-walkable one is an obstacle or the ground |
| `placements[]` | `P2P.place`, positioned, scaled, given a depth |
| `zones[]` | a blocking one is ground in a platformer |
| a placement's `collider` | the spaces that file blocks, as offsets from its `anchor` |
| `gridSpan` | how far the character may walk |
| `pixelArt`, `roundPixels` | handed to Phaser in `main.js`, and to the camera in `applyCamera` |
| `zoom` | `setZoom` on the main camera, in `applyCamera` |

A placement carries the size it is *displayed* at beside the size the manifest
exported, and the scene divides them — the same `applyScale` the editor's own
renderer does. Sending the ratio ready-made would hide where it comes from in
a file whose whole job is to be read. Without it every import drew at twice
its size, since an import lands at `IMPORT_SCALE`.

`gridSpan` is measured from the content rather than fixed at 24: fills on a
snapping grid are addressed in cells already, and everything else — a
placement, a rectangle fill, a boundary's outline — is in world pixels and
divides by the grid size. It is clamped because it is the bounds a search walks
— one placement a mile from the origin would otherwise hand A\* a world to
cross before it could answer. It used to bound the drawn lattice as well, which
is the reason it is clamped rather than simply grown: the scenes stroked
`(2n+1)²` cell outlines. They draw no grid now — see below — so this is the
walkable bound and nothing else.

**The scenes draw no grid.** The editor's light blue lattice is scaffolding to
build on; a game is the thing that was built, and a published one showing the
editor's guides is a published one that looks unfinished. So there is no
`drawGrid` in either template and nothing calls one. A project scaffolded before
this still has its own copy of that block and still draws it — `game/` is the
user's tree and nothing rewrites it — and deleting the block, or the one line in
`create()` that calls it, is the whole of turning it off.

**A document that will not parse is not a reason to fail the export.** The zip
is still a runnable game, just an empty one, so a corrupt document falls back
to `empty()` rather than aborting with a half-written archive.

**The load is racy, and the templates now say so.** It was not, on P2P's
single-file path: that queues its sprites from inside the handler that parses
`data.json`, Phaser's loader picks up files added during a pass, and `create()`
waits for the queue to drain — checked in a browser against the real plugin,
with the manifest artificially delayed. `loadMultiple` queues them from a
promise callback instead, which lands one microtask *after* Phaser has declared
the pass finished and called `create`. That is the price of having a texture
named after the file it came from, and it is worth paying — see **The texture
keys**. So the scaffolded scene places the document from the plugin's own
`psdLoadComplete` and `placeDocument` returns early until then, and the editor
goes on awaiting `psdLoadComplete` as it always did, because it loads at
*runtime* rather than from a `preload()`.

---

## What Play runs

Play loads `http://127.0.0.1:<port>/<project-id>/game/index.html` into an
iframe over the canvas (`editor/game-frame.ts`). That is the project's own
`game/` tree — the files the code modal edits — served by `file_server.rs`,
and it is the same program a publish zips. What plays and what publishes
cannot drift, because there is only one of them.

Two paths exist in an export's layout and not in the store's, and the server
answers both rather than putting copies on every project's disk:

| Request | Answered with | Why not on disk |
|---|---|---|
| `<id>/game/js/lib/phaser.min.js`, `…/psd-to-phaser.umd.js` | the constants `templates.rs` already holds for the exporter | 1.5 MB, identical in every project |
| `<id>/game/assets/…` | `<id>/assets/…` | the pipeline's output sits *beside* `game/` in the store and *inside* it in a zip |

The traversal guard is unchanged: the rewrite happens before `resolve`, which
still canonicalises and checks against the store root, and the runtime shim
answers only those two exact names — under `game/js/lib/`, where the scaffold
puts them now, or under `game/lib/`, where a project made before the tree moved
still asks for them.

### The console the game logs into

The frame is a different origin, so the editor cannot read its console. It
reports instead: `templates/play/console-bridge.js` wraps `console.*`, listens
for `error` and `unhandledrejection`, and posts each call to the parent.

It works out two things the editor cannot. Each argument is **flattened** into
the tagged shape `lib/log-value.ts` describes, because a structured clone of a
live Phaser object throws and a clone of a scene would carry the whole game
across to be printed as one line. And each call's **site** — the file and line
it was written on — is read out of a thrown error's stack and mapped back to a
path inside `game/`, which is what makes the drawer's level chip a link into
the code modal.

`file_server.rs` injects the bridge at the top of `<head>`, and only for a
request carrying `?idlewild=console` — which only `game-frame.ts` sends. So the
project's `index.html` says nothing about it, and the page that publishes is
byte for byte the page that was edited. First in the head on purpose: a boot
failure in the very first module is exactly what it exists to report.

`game-frame.ts` checks what arrives rather than trusting it — the path is
about to be handed to the code modal to open — and unwraps a top-level string
back to a plain one, because the first argument of a call is a *format string*
when it has directives in it and Phaser's boot banner is exactly that.
Arriving in the drawer, those lines are tagged **JS** — see
[Console](code-panel.md#console).

### Stacking, which the game got wrong

A PSD is a stack of layers and the order is the artwork: a roof over a tower
is not the same picture as a tower over a roof, and an extrusion's `lines`,
`shading` and `shape` stacked backwards is a solid with its silhouette painted
over everything that made it read as one.

Two things reach the game now that did not:

- **`order`** — how high a layer sat in its file's stack, counting up from the
  back — and **`instance`**, the unit the placements of one PSD share. Neither
  was in `game.config.json`, so the game had nothing to sort by.
- **`applyDepth`**, in the template. `P2P.place()` returns a Phaser **Group**,
  whose children live on the scene's own display list rather than inside it —
  so `setDepth` on the group writes one depth onto every child and the
  artwork's order collapses. Phaser then draws them in the order it was handed
  them, which is the manifest's top-first order, which is upside down. Each
  child is now ranked by the depth psd-to-phaser gave it and spaced inside the
  placement's own slot, so the file's stack survives and the group still sits
  between the placement below it and the one above.

The editor's renderer learned both lessons already, in `doc-renderer.ts` — it
is where the `drawOrder`/`applyDepth` pair came from. So the same ordering
exists twice, once for the editor and once in the project's own
`shared/canvas.js`, which cannot import it. `game/__tests__/draw-order.test.ts`
holds them to the same fixtures by pulling the template's functions out
between their markers and running both, the same arrangement the console
bridge's snapshot is under.

### A character sorts itself in

The character was pinned at depth `1e6`, which is in front of the whole
document and every layer of it. On a flat projection that is the right answer
and on an isometric one it is the bug: an isometric world is a world you walk
*behind* things in, and a character that is always in front is a cut-out held
over the picture.

**Sorting it needs one key everything shares.** The placements' depths are
ranks in an ordering worked out once, not world coordinates — see *What is
drawn over what* — so there is no number a character can compute from its own
position that slots between two of them. Two ways out of that: make every
depth a function of position, or let the character find its rank in the
ordering that already exists. The second is what this does, and it is the one
that leaves the document renderer alone.

So `placeDocument` keeps the numbers it sorted by. One per step, already in
order, on the layer the character walks:

```js
this.walkAmong = {
  base: depth * 1000,
  near: nearPoints(order, this.grid.tileHeight / 2),
};
```

and `walkDepth` is a binary search for the character's own position in that
list — `base + low − 0.001`, where `low` is the first placement standing nearer
the camera than the character is.

**Plain world Y on both sides**, which is what makes it one comparison rather
than a projection. An object's number is the line its collider's outer edge
sits on, in world pixels: `nearRow × tileHeight / 2`, because an isometric row
is half a tile of screen height. The character's is the **bottom of its
artwork**, which `groundOf` works out as `sprite.y + displayHeight × (1 −
originY)`. Both are the point the thing touches the ground at, and that is the
only thing being compared. A space whose middle is level with an object's near
corner is *beside* it rather than behind it — on a diamond grid the two share
an edge — so `<=` counts level as past, which is the right way round.

**The bottom, not `sprite.y`**, and this one was worth a whole row. Anything
drawn from its middle has `sprite.y` half its height up the screen, and the
template's character is half a space tall while an isometric row is half a
tile — so that half is *exactly one row*. Sorted on it the character reads as
standing a row further from the camera than it is and stays behind things it
has already walked past. At a glance that does not look like an off-by-one; it
looks like a character stuck behind the scene.

The two sides mean the same thing only because the rectangle is drawn centred
on its space and half a space tall, which puts its bottom edge exactly on that
space's **near vertex** — the same line an object's key is measured to. That is
the property to preserve when the rectangle is replaced, and the two ways to
lose it are opposite: artwork with empty space under the feet sorts late by
however much of it there is, and a sprite given its *feet* as its origin has
its bottom edge on the middle of the space rather than the near vertex of it,
which is a row short again. A numeric `ground` on the character overrides the
arithmetic, which is what either case should reach for.

**The position comes off the sprite, not off the character's cell.** `cell` is
as much where it is walking *to* as where it is — `moveTo` picks a path and the
destination is known from the first frame of the walk — so a depth taken from
it would put the character behind the tree it is about to pass the moment you
tapped, and leave it there for the length of the walk. The sprite's own Y moves
with the tween, so the character slides through the ordering rather than
snapping through it a space at a time. (Reading the sprite fixed a second thing
on the way. `cell` was a field holding the destination, and `moveTo` pathed
from it — so a second tap mid-walk searched from somewhere the character was
not, and it set off diagonally towards a route it had never been on. It is a
getter over the sprite now.)

**Every member of a unit carries its unit's number**, which is `nearPoints`'
whole job and the half that is easy to get wrong and impossible to see.
`drawOrder` hands back a flat list — a three-layer building is three entries —
and the collider rides on the first of them, so each placement's own number
dips in the middle of a unit as the rest fall back to their anchors. A binary
search over that does not give a fuzzy answer; it finds a place *between* two
layers of one building and draws the character inside it. Because `drawOrder`
sorted the units by exactly this number, giving each member its unit's makes
the list non-decreasing by construction.

**A thousandth, not a half.** This is the number that has to be right, and the
obvious one is wrong. Placement `k` sits at `base + k`, and `applyDepth`
spaces the parts of a multi-layer PSD across the *whole* interval above it —
`(rank + 1) / (parts + 1)`, which for a three-layer building is 0.25, 0.5 and
0.75. So half a step down from `base + k` is not the gap between two
placements; it is the gap between somebody's walls and their roof, and a
character put there is drawn inside the building. The sliver clears the
topmost part of any PSD short of a thousand layers.

At `k = 0` it lands just under `base`, which is where a **fill** used to be.
Fills moved down a whole step to `base − 1`, which they wanted anyway: a fill
is the ground of its layer and everything placed on that layer stands on it,
so tying with the first placement and settling the tie by which Phaser was
handed first was never an answer.

**Where the line falls** is one constant and one comparison, both in
`walkDepth`, which is the thing to reach for when it feels early or late. The
character is in front of a placement once its own ground point is past that
placement's near corner; moving the comparison to `<` holds it back until it
has properly left, and offsetting the stored number half a space either way
moves the line within the crossing step.

**Which layer it walks on is the layer the start point is on**, as long as
there is something on it. A point used to say where play begins is the one
thing in the document that says where the character *belongs*, so the stack
around it means something: scenery on that layer sorts against the character
space by space, everything on a layer behind it is always behind, and
everything on a layer in front is always in front. That last one is how an
overhang works — put a canopy, a bridge or a doorway's lintel on the layer
above and the character walks under it however far forward it goes, which is
not something a single ordering can express.

The qualification is not a detail. An **empty** layer gives the character a
list of nothing to find its place in, so it lands at the bottom of that layer's
slot and every layer in front draws over it — a character behind the entire
scene, from one point dropped on a layer that happens to hold no artwork. So a
layer qualifies only if it is a visible object layer *with placements on it*,
and a start point on anything else falls through to the front-most layer that
is, which is where scenery normally is. Nothing qualifying at all leaves
`walkAmong` null and the character in front of everything, which is the failure
you can see rather than the one you cannot.

A flat projection sets nothing at all either, so the character keeps the depth
the prefab gave it and draws in front of everything; sorting a flat top-down
game on Y is a real thing to want, and it is a change to `drawOrder` as much as
to this.

`walkDepth` is a marked block and the only one the two genres do not share: a
platformer is seen from the side, where nothing sorts on Y at all. Its test
pulls the block out of the template and runs it, the way the `drawOrder` test
does — and it is the test that caught the half step.

### Arrows beside the tap

The top-down character takes the arrow keys as well as a tap, and the two are
not alternatives. A tap walks there over A\*, which is the game. A held arrow
nudges the sprite directly, which is not: it goes where a path cannot — half a
space into a doorway, right up against the near edge of a building — and that
is what you want when the thing you are checking is whether what you drew sorts
the way you meant it to. Sorting is continuous in `sprite.y`, so the line it
turns on can be found by leaning on a key rather than by tapping either side of
it and inferring.

Four decisions in `character.js` worth keeping:

- **Screen directions, not grid axes.** On an isometric map the grid runs
  diagonally, so a keyboard bound to it moves the character in directions the
  arrows are not pointing. Up the screen is also *away*, which is the axis the
  sorting turns on — the one you want a key for.
- **A held key kills the tween.** Two things moving one sprite is a sprite that
  jitters between them, so an arrow takes the character off whatever path it
  was walking and keeps it.
- **Each axis committed separately**, and only onto walkable ground. A
  character pushed into a wall slides along it rather than stopping dead, and
  can be parked anywhere inside a space instead of on its middle — which is the
  point of having it.
- **`delta` clamped at 50ms.** A tab left in the background hands back one
  enormous frame, and a step taken by it crosses the map.

The keys are a set of flags read once a frame by `character.step(delta)`,
called from `update` next to `sortCharacter`, rather than a callback that moves
anything: what a key means is the character's business. WASD is bound beside
the arrows. Both are in the prefab, which is the file a project is expected to
replace — a sprite instead of a rectangle, a run of animations — so none of it
is in the scene.

### Saving applies

`CodeModal.save` reports the path it wrote; the shell reloads the frame if a
game is up. That is what "saving code applies it" means here — the program
restarts against the file just written, which is the only way to see whether
the change worked. Entering play mode flushes the document first and waits for
it, because the document's save is what rewrites the config the game reads.

**A rewritten PSD restarts it too**, for the same reason and it used to not.
A file can be rewritten while its game runs beside it — ink applied in PSD
Edit mode, a layer renamed or turned off, a re-parse, a file replaced by a
drop. Every one of those re-places the canvas from the new
manifest and left the game holding the textures it loaded at start — the two
halves of one window showing two versions of one file. `psdChanged` in
`editor.ts` is the one line the paths that rewrite a PSD now share, and it is
a no-op in Draw, where nothing is running.

The pipeline itself was never the gap: `psd_layers::paint` rebuilds the file
and runs psd-to-json over it inside the same lock, so the sprite the game
loads is written before Apply returns. A test pins that end to end, because
it is invisible from the editor — the canvas re-places from the manifest it
is handed either way, so a paint that stopped re-parsing would look right up
until the moment somebody pressed Play.

### What went with it

`game/play-controller.ts`, `game/play-platformer.ts`, `game/platformer.ts`,
`lib/pathfinding.ts` and `editor/play-pad.ts` are deleted. Each had a
counterpart in the templates — `navigation.js` and `physics.js` — and the
templates are what runs now. The editor's scene keeps one line about play
mode: put the tools down.

The platformer's own on-screen pad went the same way, a little later. Three
buttons pinned to the viewport were a guess at a game nobody has written yet:
a template's job is to run so there is something to change, not to decide what
the controls of your platformer look like. `bindControls` is the keyboard and
nothing else, and the comment over it says what putting a pad back takes. Only
a project scaffolded after this gets the shorter file — `game/` is the user's
copy and nothing writes into it unasked — so an existing platformer keeps its
pad until those lines are deleted, or Reset is used on the block.

---

## The config the game reads

`game/js/game.config.json` is the document in the shape the project's own code
reads it — `psdKeys` to load, layers to place, the grid to draw. It is
generated, and `store::sync_game_config` rewrites it from `doc.json` on **every
save**, not only on the way out to a zip.

That is a three-line change with three consequences. The file the code modal
opens describes the canvas beside it rather than being the empty one a new
project scaffolded with. Play mode, which now runs that code, runs against what
has actually been built. And the export's own rewrite becomes a re-derivation
of the same thing rather than the only time it ever happens.

A failure never fails the save: `doc.json` is the truth and this is derived
from it, so a document mid-migration keeps a stale config rather than losing
the write that carried the work. An unchanged config is not rewritten at all,
which matters because a drag saves on an 800 ms debounce and the code modal
watches this file.

---

## The page around the game

Everything else in this editor is about what is on the canvas. This is about
the **HTML document the canvas is embedded in** — the page a published site
opens as, and the page Play runs in.

There has only ever been one of those, and it was the same for every project:
the game filling the window, square-cornered, flush to every edge, on the
scaffold's `#d9e6ef`. That is a reasonable default and a poor only answer. A
320×568 phone game shown on a desktop should be a 320×568 game on a desktop,
not one stretched across it, and nothing in the app could say so.

**Page Setup** is the sheet, beside Project Options in the header's menu rather
than inside it, because the two are about different things: Project Options is
how the *canvas* renders and reaches the editor's own view; this only ever shows
up in Play and in an export. Six settings — fixed size with a width and a
height, centred or top left, a margin, a corner radius, and the page colour.

### Why it is not `GameOptions`

Two reasons, and the better one is not the language's.

The language's is that `GameOptions` is `Copy` and is copied all over the
editor, and a colour is a `String`.

The other is that `GameOptions` is how the canvas renders — `pixelArt`,
`roundPixels` and the zoom are applied to the editor's own view the moment
they change, which is what `render-settings.ts` is for. None of these six
reach that canvas at all, because the editor draws a *world* and this describes
a *page*. Keeping them apart means nothing in the editor ever has to ask which
half of one object applies to it. So `Presentation` is its own field on
`ProjectMeta`, beside `PublishTarget`, defaulting the same way.

### Why it writes nothing into the project's own files

The literal build is to rewrite the rules in the project's `styles.css`
whenever a number changes — it *is* a CSS template, after all. It is also the
build that fights the person using it. A `game/` tree is the project's own copy
the moment the scaffold writes it, and an editor that owns lines inside a
stylesheet is an editor that undoes your edits to them. That is the whole
argument of **Lines the editor owns**, and a stylesheet is the worst file to
have it in: CSS is where somebody changes one number to see what happens.

So these ride in `game.config.json` the way `pixelArt` and the zoom already do,
and the scaffold reads them. `main.js` writes them onto the document as custom
properties in its `presentation` block; every rule in `styles.css` reads one
with a fallback:

```css
#game {
  width: var(--game-width, 100%);
  height: var(--game-height, 100%);
  border-radius: var(--game-radius, 0px);
  overflow: hidden;
}
```

Three things follow, and all three are the point. A rule you rewrite keeps what
you wrote. Delete the block in `main.js` and the page is exactly what it always
was, because **the fallbacks are the old stylesheet** — it is correct opened
straight off disk, with a config that predates the feature beside it, or with
no JavaScript having run. And a project made before any of this existed picks it
up on its next save, without the editor having touched a file it wrote.

`scale` is the half CSS cannot do, and it is in the same block. A game filling
the window wants `RESIZE`, so the camera gets the viewport; a fixed-size game
wants `FIT` against the size it was given, so a window too small for it scales
the game down instead of cropping it. `max-width: 100%` on the box is the CSS
half of that same answer.

**Two backgrounds, and they are not the same one.** `Presentation.background` is
the `html` background, behind everything. Phaser's own `backgroundColor` is
behind what the scenes draw. They are only ever both visible once a margin, a
radius or a fixed size has pulled the game back from an edge — which is exactly
when you want to choose them separately, and is why the sheet's row says *page*
colour and the scaffold keeps its own literal.

**They default to two different colours, on purpose.** The tidy answer would
have been `#d9e6ef` for both, and it is the wrong one. That blue is the
*world's*: the editor's canvas ground, what Phaser paints behind the scenes,
what a player reads as sky. The page is the surface the game is *mounted on*,
and at the only moment it is visible — the moment something has framed the game
— a second field of the same sky reads as the world running on past its own
border, which is precisely the impression a framed game exists to avoid. So the
page defaults to a neutral dark and the world keeps its blue, the way a video
player mats a picture. The dark is the app's own `--color-neutral-900`
(`#2d2b2b`) rather than an invented hex: one fewer arbitrary number, and a
framed game sits on the same ground the editor is drawn on.

The `styles.css` and `main.js` fallbacks carry that value too. A fallback that
disagreed with the default would mean a project rendering one colour with its
config and another without, which is the kind of difference nobody can debug —
so the rule is that every fallback in the scaffold is the default the editor
would have sent anyway. It is the one default that is *not* what a project had
on screen before Page Setup existed, and it is invisible to every one of them
until they frame something.

### What is checked, and where

`Presentation::sane()` clamps on the way **out**, into the config — not on the
way in, to disk. A width typed as `4` that became `16` under the cursor would
be the sheet arguing with somebody still typing; what matters is that nothing
absurd reaches a stylesheet. Three things can put absurdity there and none of
them is the sheet: a hand-edited `meta.json`, an archive from another machine,
and a build whose bounds were different. A zero width is a game nobody can see;
a margin of four million is a game pushed off the page.

The colour is checked rather than clamped, being the only one that is not a
number. It is written into a CSS custom property, and while a browser drops a
property it cannot parse, a value this code has never looked at is not a thing
to hand a stylesheet. `#rgb`, `#rrggbb` and `#rrggbbaa` — what this app's own
picker writes — survive; anything else falls back to the default.
`tests/presentation.rs` pins both halves, along with the archive carrying it and
a project that has never heard of a page still describing the one it has.

### Where it takes effect

There is no preview on the canvas behind the sheet, because there is nothing on
that canvas this describes. What there is instead is Play: the sheet restarts a
running game through the same `onChanged` the render settings use, so with Play
up the sheet *is* its own preview, and the page you are describing is the page
in front of you.

---

## Lines the editor owns

The editor writes code into a project and the user edits that same code.
Without a rule the two fight: the editor rewrites a function and takes a
hand-made change with it, or it stops rewriting and the code stops matching the
canvas. There are two rules, and the coarse one came second.

**The coarse one is the file.** `js/shared/canvas.js` and
`js/shared/character.js` are the editor's; `js/scenes/<Scene>.js` and
`js/prefabs/character.js` are the author's. That sounds obvious and was not
what this used to be: the whole of the machinery lived at the top of the scene
file, so the file somebody was meant to work in was a thousand lines of
somebody else's with room to type between them. Splitting them means the
question "is this mine?" is usually answered by which file is open, and a
scene file carries no markers at all.

**The fine one is the line, and it is still there** — because a file being the
editor's does not make it untouchable. Inside the shared modules, ownership is
per line:

```js
// idlewild:begin placeDocument
export function placeDocument(scene) { … }
// idlewild:end placeDocument
```

Inside that range a line is the editor's if it is *still one of the lines the
scaffold wrote*, decided by a longest common subsequence against the pristine
template (`code/managed-blocks.ts`). Anything else between the markers was
typed by the user and stays theirs. So a `console.log` dropped into the middle
of `placeDocument` is one line you can edit and delete while the lines around
it stay locked. A subsequence rather than a line-for-line comparison because
that is the whole point: inserting a line must not disown every line after it.

The markers themselves are always owned, which is what stops a block being
dissolved from the inside. A `begin` with no `end` is not a block at all —
locking the rest of the file would be the worst way to fail.

`code/managed-view.ts` turns that into CodeMirror. The filter's job is narrower
than "read-only": an owned line's *text* must survive, and it must still be a
line of its own afterwards. So a break typed at the end of one is allowed —
that is how you get a line of your own inside a block — and deleting a whole
line above one is allowed, while a character typed at either end of an owned
line, or a backspace that would join it to its neighbour, is not. A refused
edit says so in the file bar rather than doing nothing.

**Reset** sits at the end of each block's opening marker and puts that block
back the way the scaffold wrote it, dropping whatever was added inside it. It
saves as it goes: the reason to press Reset is that the running game is broken,
and a repair you then have to remember to save is half a repair. `templates.rs`
answers for the pristine text (`read_game_template`), so the blocks a project
can reset are the blocks its own genre scaffolds.

**A block the template gains later** is the case Reset cannot serve: a
project's `game/` tree is its own copy, so there is nothing in the file to put
back. `analyse` names those in `missing`, and a strip above the editor offers
to put them in — `addMissingBlocks` inserts each where the scaffold has it
*relative to the blocks the file already has*, so a helper lands beside the
code that calls it rather than at the end. An offer rather than an edit: code
appearing in someone's file unasked is the fight this whole mechanism exists
to avoid.

This is not hypothetical. The scene template gained `drawOrder` and
`applyDepth` when the exported game learned to stack a PSD the right way up,
and without that strip every project made before it would have drawn
multi-layer files upside down for good. It is also the reason the shared
modules keep their markers at all, now that each of them is the editor's end
to end: without the markers there would be no way to offer a project made
today a block the scaffold gains next year.

The generated config is the whole-file case of the same idea. It has no room
for comments and nothing in it was written by hand, so it is owned end to end
and read-only in CodeMirror's own terms as well — the caret still moves,
because reading and copying it is the point. There is no allowance for a break
at the end of a line there, unlike a block: no line of that file is not about
to be rewritten. It is re-read whenever the document is saved, so what is on
screen is what the running game reads.

Resetting the config means *regenerating* it — its pristine form is the
document as it stands, not the empty file a new project scaffolds with.

Today `canvas.js` marks sixteen — `sceneOf`, `loadDocument`, `updateCanvas`,
`applyCamera`, `placeDocument`, `paintBackgrounds`, `placePatterns`,
`paintFill`, `nearPoints`, `drawOrder`, `applyDepth`, `applyScale`,
`applyHidden`, `pointsToVectors`, `gradientCorners` and `patternRule` — and
it is one file for both genres, so there is no longer a pair that can drift.
`character.js` marks its own, and the two genres' differ: a top-down character
sorts itself into an isometric ordering and a platformer does not, so
`sortCharacter`, `readColliders` and `walkDepth` are the first's and
`readSolids` is the second's. `main.js` marks `pixelPerfect` and
`presentation` — both of them a setting read out of the generated config and
handed to Phaser and to the page — and the config and the scene list are
generated whole.

A test pins each file's set and that every marker closes, because a block is
found by id and one renamed would quietly stop offering its Reset. It also
pins that a **scene** file marks nothing at all.

`drawGrid` was one of them and is gone: the scaffold draws no lattice now. A
project scaffolded before that still has the block, and Reset on it reports that
there is no scaffold to go back to rather than emptying it — which is the same
answer the modal gives for any file the template does not write, and the right
one: what to do with a block the template dropped is the author's call.

### The character controller stopped being a scaffold-time conditional

There used to be a second directive beside the managed blocks, resolved as the
scaffold was written rather than after:

```js
// idlewild:if character
this.spawnCharacter();
// idlewild:end if
```

The marker lines never reached disk; what was between them did only when the
option was on. The reasoning was that `character` could not reach a project
through the config, because *leaving a character out means not writing the
lines that make one* — and that was true while the lines were in the scene
file, which was the author's. It stopped being true when the wiring moved into
`js/shared/character.js`, which is the editor's: the file is scaffolded either
way and `spawnCharacter` reads `config.character` and returns null.

So the directive is gone, and with it `templates::resolve` and the whole idea
of a template that is not the same text every time. That is worth more than
the feature it bought: the file on disk and the pristine text a Reset compares
against were only equal because both halves of the editor asked the same
function for the same project, which is a rule somebody had to keep. Now they
are equal because there is one answer.

What it buys directly is a **switch**. Project Options could previously only
*report* whether New Project had written a character, because unticking a box
cannot take one out of code that already has it. It is a toggle now, and
turning it on is a save — the prefab is scaffolded whether or not it is
spawned, so there is a `js/prefabs/character.js` waiting rather than a file to
go and create.
