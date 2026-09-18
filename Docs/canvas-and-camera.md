# The canvas, the camera and the gestures

The infinite grid and everything that decides what you are looking at: the
one-screen-pixel rule, the minimap, where a project opens, the three sections
the window divides into, and the two columns of tools.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## One screen pixel, whatever the camera is doing

A width handed to Phaser's `Graphics` is in world units, and the camera scales
it with everything else. So a lattice stroked at `1` is one pixel at 1× and
four at 4× — and 4× is exactly what a project drawn on 8 or 16 px spaces opens
at, which made the ground under a pixel-art project read as a drawing over it.

Every overlay on this canvas therefore strokes `n / zoom`: the grid renderer,
the selection outlines, the marquee, the drop target, the collider shapes and
extrude mode's own faces. At 1× that is the weight it has always been, which
is why nothing about a 32 px project changes. The grid renderer's `invalidate`
is part of it: the lines are stroked at a width worked out from the zoom, so a
zoom has to redraw them even when the same cells are still on screen.

The one thing that cannot follow is a line in a **PSD**, which is pixels by the
time anyone looks at it. `editor/import-anchor.ts` has the rule as `hairline`:
an extrusion's lines bake at the weight the lattice has at the zoom the project
opens at — its `defaultZoom` — with a floor of one pixel of the file itself,
because half a pixel of canvas stroke is a grey smear rather than a line. A
project at 1× gets the one world pixel it always got; a pixel-art project at 4×
gets a crisp single pixel instead of four.

---

## The minimap

Along the bottom of the left sidebar, under the layers. The column then reads
as the questions in the order anybody asks them: which place am I in, what is
in it, and where am I standing in it. The third had no answer before — the
canvas is effectively infinite, and work you had drifted away from could only
be found by panning until it came back.

**There is no "fit the whole map in the box".** The lattice is recomputed from
the camera over exactly the cells it can see and there is nothing to hit, so a
document has no extent of its own to frame. What `editor/minimap-view.ts`
frames instead is the **union of everything that has been put down and the
camera's own rectangle**, padded by a margin. That union is what makes the
thing usable in both directions: move about inside your own work and the
picture holds perfectly still, because the union is the work; walk off the
edge of it and the picture opens out until both you and the work are in view,
which is the only way back. A scene with nothing in it frames the camera
alone, and the two hairlines through the origin are all there is to see.

The union is then grown to the **shape of the box** rather than letterboxed
into it. A `contain` fit leaves a strip down two sides, and those strips are
world as much as the middle is — painting them as anything else would draw an
edge onto a canvas that has none. Growing instead means one scale describes
both axes, which is the whole of the projection: `world → box` is a subtract
and a multiply, and `toWorld` is what a finger on the map is pointing at.

**The frame is a div, not paint.** A pan moves the camera every frame while
the map underneath has not changed, and repainting a document to move one
rectangle is the per-frame work this editor keeps off the main thread
everywhere else. So the content is baked into the canvas only when the
document or the framing actually changes — a string of the world rect, the
scale, the box and a revision counter decides — and the camera is a positioned
element over the top of it, dimming the rest of the world with one enormous
`box-shadow` that the body clips. It is the same bargain the drawing layer's
stage strikes with its backing canvas, for the same reason.

It draws from the **document**, not from the scene: the box a placement
occupies rather than its artwork, a fill's own colour, a boundary's polygon, a
stroke as the line it was drawn as, and the markers a point gets on the canvas.
So it needs none of the texture machinery, works before a PSD has loaded, and
costs a second WebGL camera nothing. Layers that are hidden are hidden here
too, and a placed PSD is floored at a couple of map pixels — a sprite a
fraction of a pixel wide antialiases away to nothing, and a map that shows
nothing where there is something is worse than one that shows it roughly.
Strokes are sampled to at most 96 points, which at this size is the same line
drawn faster.

**It is Draw's.** The map frames the camera the canvas is looking through, and in
Code and Play the canvas is behind a running game — so the frame would be drawn
around a camera nobody is looking through. Play takes the whole left sidebar
down anyway; Code is the mode that *keeps* it, to switch scene and adjust the
document while the game runs, so the rule has to name both and
`styles.test.ts` asserts that it does. `display: none` also stops the paint: the
body has no box to fit anything into, `paint` returns on that, and the
`ResizeObserver` brings it back the moment there is one again.

**A scrub freezes the projection.** A press names a place and the camera goes
there at the zoom it is already at; the finger keeps naming places until it
comes up. But centring the camera can widen the union — that is exactly what
walking off the edge of the document does — so re-fitting mid-drag would slide
the map out from under the finger driving it. The view is taken once, at
pointer-down, and held for the gesture; the fit is redone on release.

### The switches above it

Four things on this canvas are drawn *about* the document rather than being
part of it: the lattice, the boundary around the screen the game opens at, the
crosshair on world `0, 0`, and this map. All four are useful and none of them is
useful all of the time — a boundary is what you lay a building against and then
want out of the way, and the map is worth a third of the sidebar right up until
you are working close in. So `editor/overlays-panel.ts` gives each one a switch,
in a foldable **Overlays** section directly above the map.

**Beside the thing they switch, not behind the header's menu.** The Minimap row
sits on top of the minimap it hides, and the rest are in the column you
are already looking at when you notice a mark is in the way.

**Folded to begin with, with every mark showing**, which is two decisions
rather than one. A *mark* switched off by default is a mark somebody has to be
told exists, so all of them start on. The *section* is chrome about the canvas
rather than part of it, and four rows of it permanently above the map cost the
map a third of what it had, every session, to say something you act on rarely —
so it starts folded, with the heading left standing, one tap away and named.

**The grid is the fourth, and it is the one this list was always about.** It is
the most overlay-ish thing the canvas draws: it exists nowhere in the game, it
is recomputed from the camera rather than stored (see [The infinite
grid](#one-screen-pixel-whatever-the-camera-is-doing)), and a scene that is
mostly artwork by now is one where a pale blue lattice printed over every
sprite is exactly the mark you want out of the way while you judge what you
drew. It sits **first**, because it is the ground the other three are marks
*on*, and because the list then reads outward from the canvas: the lattice, the
two things about the game's screen, and finally the picture of the whole scene.

**A project with no lattice gets no row**, rather than a dead one. The blank
template's cells are single pixels and `GridRenderer.update` returns before it
strokes anything, so a `Grid` switch there would be a control over something
that was never drawn — which reads as broken rather than as absent.
`overlayRows(hasLattice)` is that decision, and it is the panel's one piece of
per-project shape; `editor.ts` asks `grid.snaps` for the answer.

**Hidden, not skipped.** `GridRenderer.setVisible` takes the Phaser `Graphics`
object down rather than short-circuiting the redraw, because `visibleRange` is
what the pattern layers are synced over in `WorldScene.update` and that reading
of the camera has to go on happening whether or not the ground under them is
showing. The strokes already in the object stay valid, so switching back on is
a frame rather than a re-walk of the viewport — and the depth `setBackdropDepth`
keeps putting it at is still right when it returns.

**The rest of the order is not the order they were asked for.** Boundary and
centre point are the two marks `screen-guide.ts` draws — one subject, so they go
together — and Minimap is last because that is what puts it against its own map.

**It is panel state, not document state.** Which marks somebody wants on is a
per-install convenience, like a sidebar's width or a folded inspector section,
so it is a `localStorage` record and never reaches `doc.json`. Two people
opening the same project see their own answer, and no overlay switch has ever
been a thing to undo. `readOverlays` is the parse and the tested half: it is
reading something a previous version of this app wrote, out of a store that can
also hand back a half-written string or another tab's JSON, and **anything not
plainly a boolean falls back to showing the mark** — a mark switched off that
nobody asked to switch off, with the switch that would explain it reading *on*,
is the one outcome that cannot be debugged from the screen.

**The lattice is the one exception to that**, because it is paint rather than a
DOM element: it is switched on the renderer, through a `LatticeHost` the panel
is handed once the canvas has booted. The handoff is `setLattice`, beside
`setGuide` and for the same reason — a grid somebody switched off last week has
to be off on the first frame of the scene rather than on the first toggle, and
the scene is the last thing `editor.ts` builds.

**Each switch is a class, and the stylesheet does the hiding.** `display: none`
on the map is the same rule Code and Play already take it down under, and it
stops the paint as well as the picture — the body has no box to fit anything
into, `paint` returns on that, and the `ResizeObserver` brings it back the
moment there is one again. `ScreenGuide.setMarksVisible` does the same for its
two elements and keeps a `showing` flag beside them, so with both off `draw`
returns immediately; it runs on every camera move, and a hidden mark should not
cost one. Turning a mark back on redraws it there and then, so it returns where
the camera is now rather than where it was when it went.

**The switches are Draw's, like the map.** In Code the marks they control are
already down, so every row would be a switch for something not on screen. The
rule names both modes beside the minimap's own, and `styles.test.ts` asserts
it — along with each mark having a rule of its own, the map going down by
`display`, and the rows being `--hit` tall, because the whole row is the target
and there is nothing else on it to aim at.

### The camera came out of the scene

`world-scene.ts` was at the 700-line limit, and the minimap needed one more
thing from it: somewhere to say "stand here". The camera is the part of that
file with a life of its own — it arrives from the document, it is written back
to the document as it moves, and it outlives every tool that borrows it — so
`game/scene-camera.ts` is the clamp, the moves and the persistence, and the
scene keeps the reads. What it needs told about, it is handed as callbacks: the
lattice to invalidate, the chrome to re-stroke after a zoom, and the viewport
to publish.

Three call sites now share it rather than one: the gesture arbiter, the drawing
layer's own two-finger navigation through `panScreen` / `zoomAt`, and the
minimap through `centreOn`. `MIN_ZOOM` and `MAX_ZOOM` live there now, which is
why `tests/options.test.ts` reads that file for the constant.

`editor/tool-routing.ts` came out of `editor.ts` in the same breath and for the
same rule. What a tool means to the pointer — who gets the raw input, what a
drag on empty space does, what the cursor is, what the inspector describes —
was four screens down a file that is otherwise wiring, and the pen rail's three
tools belong with it because they are a brush swap wearing a tool's clothes.

---

## The origin, and the screen the game opens at

The canvas has no edges. The lattice is recomputed from the camera over the
cells it can see, there is no world bound to hit, and a camera that has been
panned for a while is looking at a picture that would be identical a thousand
spaces away. That is the right model for building in and it leaves two facts
about the **game** with nothing on screen to say them.

The first is world `0, 0`. Every coordinate in the document is counted from it,
`config.scenes` hands it to the project's own code, and until now the only
thing that ever drew it was the minimap's two hairlines — three hundred pixels
away in the sidebar, at a scale nothing can be placed against.

The second is how much world a player sees. `templates/common/js/main.js` runs
the game at `Phaser.Scale.RESIZE`, so there is no design size to point at: the
game's screen *is* the window, and what decides how much world fits in it is
Project Options' default zoom. Drawing a building around the origin and finding
half of it off the edge in Play is the ordinary way to learn that, and learning
it in Play means going back to Draw with a number in your head.

So `editor/screen-guide.ts` puts both on the canvas in Draw: a red crosshair on
the origin, and a dashed red rectangle around the screen the game opens at.

**Centred on the origin, not hung off a corner.** A scene has no top-left —
cells count in both directions, a fresh camera centres on `0, 0`, and the
default zoom scales what the game shows about the middle of its screen. And the
rectangle is deliberately not a claim about *where the game's camera will be*:
`spawnCharacter` calls `startFollow` a frame after boot, so on any project with
the character controller ticked the camera is wherever the character is. What
the box can honestly say is **this much world, around here**.

`guideBox` is the whole of the arithmetic and is the thing under test. The
origin is `−originX × zoom`, straight out of the viewport the scene already
publishes; the box is the game's screen scaled by `cameraZoom / gameZoom`. The
property that makes it worth drawing falls out of that second term: **at the
project's default zoom the two cancel**, and the dashes are the game's window
life size on the canvas you are drawing on. Zoom in past it and the box grows
by exactly the ratio, which is the same statement seen closer up.

**The size is the row's, not the canvas's.** Play takes both sidebars down, so
a running game fills the whole of `.editor-main` — measure the canvas in front
of you and the boundary is drawn at whatever width the sidebars happen to be
leaving, which is the one width the game never gets. A `ResizeObserver` on that
row keeps its content box, and `contentRect` is already content: the row pads
itself out of the iPad's side safe areas and a full-screen game does not get
those.

**It is a div, not paint**, which is the bargain `minimap.ts` strikes with its
camera frame and for two more reasons besides. A mark drawn into the scene
would be baked into the project's **thumbnail** — `game/snapshot.ts` takes that
straight off the live renderer — which is a dashed red box across every card on
the home screen. And it would have to be re-stroked at `1 / zoom` on every
zoom, the way every other overlay on this canvas is, where a CSS hairline is
one screen pixel by definition. Two absolutely-positioned elements moved with a
transform cost the renderer nothing and the main thread one write per camera
move, off the same `onViewport` push the drawing layer and the minimap are
already driven by. It gets a `z-index` of its own — 3, under the ink's sheet at
4 and the tool rail at 5 — rather than sharing one with either, because a tie
is settled by document order and the boundary is a rectangle wide enough to
draw dashes across the rail's buttons. Under the ink is also where the scene's
own selection chrome already is.

**A red that is not the accent.** `--canvas-guide` is its own token. The accent
is what the editor draws a *selection* in — outlines, the marquee, the extrude
plate — and these two marks are the only things on the canvas that are there
the whole time and cannot be picked up, dragged or filled. It is the same
argument the colour picker's grey default is there for. The crosshair carries a
one-pixel white halo on top of that, because the origin is the likeliest place
on the whole canvas to have something standing on it, and a red hairline over a
red fill is a mark nobody can find. The boundary needs none: it is dashed, and
nothing else here is.

**Draw's alone**, for the reason the minimap is: in Code and Play the canvas is
behind a running game, so a drawing of where the game's screen falls would be
drawn under the screen itself. `styles/__tests__/guides.test.ts` asserts that
rule names both modes, and that the sheet takes no pointer events — without
that it would swallow every press over the canvas, which is the drawing layer's
own failure by the same mechanism and with nothing to go on.

Two files moved to make room, both to the 700-line rule rather than to
anything about the feature: the guide's CSS is `styles/guides.css` because
`editor.css` was at the limit, and `styles/__tests__/rules.ts` now holds the
`ruleIn` helper that `styles.test.ts` was at the limit holding.

---

## Three sections, not two modes

`EditorMode` is `draw | code | play`. It was `edit | play`, with Code a menu
item that opened a panel, and that made Code a thing you could be half in: the
panel over a canvas whose mode did not know it was there, the inspector
describing a selection nobody could see, undo quietly belonging to whichever of
them had the focus. A section is the honest shape, and the header says so left
to right in the order the work goes.

**Code shows what Play shows.** The project's own game runs in a frame over the
canvas in both, because a code editor beside a still picture of the game is a
code editor you cannot check anything in: a save restarts the thing in front of
you, which is the only way to see whether the edit worked. What Code keeps that
Play does not is the **left** sidebar and the panel, so the scene can be
switched and the project read while the game runs, before a full test in Play.

It used to keep both sidebars, and the right one was a mistake that took a
while to see. The inspector describes what is *selected on the canvas*, and in
Code the canvas is behind a running game: nothing there can be picked, dragged
or resized, so every control in that column was aimed at a selection nobody
could reach. It goes down in Code now, with its divider — a grip that resizes
something nobody can see — and its edge toggle, which would fold a panel that
is already gone. The left column stays and becomes something else; see *The
left sidebar is a directory in Code*, below.

That makes the difference between the two a fact about the shell rather than
about the scene, and the code says so in three places.

- **`WorldScene` keeps a boolean, not a mode.** `editing` is true in Draw and
  false in the other two; every gesture entry point asks it, and `setMode`
  tears down a drag, a marquee and a canvas mode only when it flips. Code and
  Play are the same answer, so switching between them changes nothing on the
  canvas — and a solid half pulled in extrude mode survives neither, because
  the game is about to cover the thing it was being pulled over.
- **The stylesheet takes the tools down in both** — the rail, the tool name,
  the selection bar, the ink's own layer, and the canvas's pointer events —
  the *right* sidebar in both, and the left one in Play only. All three are
  asserted in `styles/__tests__/styles.test.ts`, because "Code keeps the layer
  column" is most of the reason the mode exists and a rule is an easy thing to
  widen by accident.
- **`editor.ts` runs the game for anything that is not Draw**, flushing the
  document first: the config the game reads is written by that save. A scene
  switch does the same, which is what makes the dropdown in the left sidebar
  worth having while the game is up.

**And the toggle that folds the left sidebar had to be lifted over the game.**
The two edge toggles live inside the canvas wrapper at `z-index: 6`, and the
game frame covers that wrapper at `8` — so in Code the button was rendered
underneath a running game: there in the DOM, catching nothing, for the whole of
the mode. One rule (`.editor.code-mode .edge-toggle.left { z-index: 9 }`) is
the whole fix, and it is Code's alone, because Play hides both toggles and Draw
has no frame to be under. Asserted against `.game-frame`'s own z-index rather
than against the number, since the pair only means anything relative to each
other.

Entering Code puts the panel up wherever it was last placed, showing whichever
file that project was last left in, and leaving takes it down, writing a dirty
file on the way out — see [The file it opens with](code-panel.md#the-file-it-opens-with), for why the second of
those needs something outside the panel to hold it. Anything that wants a file
on screen — the console's LOG link, which opens the line a message was written
on — asks for the mode first and the file second.

---

### The left sidebar is a directory in Code

Draw's layer panel is a set of *controls*: rename a layer, hide it, lock it,
carry it up the stack, drag a placed file to another layer, put a new layer on
top. In Code not one of those has anywhere to happen — the game is over the
canvas, nothing in the scene can be picked up, and the panel that would
describe a selection is down. A column of live controls for a document nobody
can touch is worse than useless: it is an invitation to change something and
watch nothing happen.

What is wanted there instead is the **names**. A developer writing against
`config.scenes`, `place()` or a texture key needs to know what the scenes are
called, what the layers in them are called, which PSDs are standing on those,
and what the layers *inside* each PSD are called — and reading the last of
those off the file in Photoshop, or out of `game.config.json`, is two windows
away from where the line is being typed.

So `LayersPanel.setBrowsing(true)` swaps the body for `layer-directory.ts`:
the same tree with the handles taken off and one level added.

- **Every row is inert except its disclosure.** A layer row is a button whose
  whole width toggles it — in Draw that is a 22px arrow because five other
  controls share the row, and with those gone a finger should be able to land
  anywhere. The name is a `span` rather than the `input` it is in Draw; the
  eye, the lock and both grips are simply not built.
- **A placed PSD opens onto its own stack.** This is the level Draw's panel
  deliberately does not have, and it is right not to: a placed PSD is *one
  thing* on the canvas however many layers are inside it, so listing its
  insides there would put a file's stack in the panel that is about the scene
  — see [Two senses of "layer", and why the panels must not mix them](layers.md#two-senses-of-layer-and-why-the-panels-must-not-mix-them). Here
  nothing is being selected, so the two senses cannot be confused by a click.
- **The layers come from the plugin's own manifest**, through
  `WorldScene.psdLayers` → `PsdPlacements.layersOf` → `manifestLayers`. That
  is the one description of the file already in memory and already kept in
  step with it through a re-parse, a rewritten stack and a rename, so there is
  nothing to cache and nothing to go stale. A key nobody has loaded answers
  with an empty list, and the row says *Not loaded yet* rather than nothing.
- **Nothing is filtered out of it** — the editor's two marks included. A
  directory of what is in a document that quietly drops two rows is a
  directory that disagrees with Photoshop, which is worse than one that shows
  a row somebody has to learn to ignore. What it *does* say is the category
  beside each name, which is also what tells a developer whether a row has a
  texture behind it or is a point the config carries.
- **The indent is the file's.** `layerDepth` reads it off the slash-joined
  path and the row carries it inline, because the nesting is the document's
  and not a number a stylesheet could know.
- **The names are selectable.** The shell suppresses selection globally so a
  drag on chrome never highlights it; this column, while it is a directory, is
  the one place that is the wrong default — the point of a lookup is copying
  what you looked up.

Two things beyond the list go with it. The `+` is hidden, and hiding it takes
a rule of its own: `.panel-add` sets `display: flex`, which outranks the user
agent's `[hidden] { display: none }`, so the attribute alone left the button
exactly where it was. And the scene dropdown offers **the scenes and nothing
else** — switching is navigation, and the reason this sidebar is kept in Code
at all, but New, Rename, Duplicate and Delete are edits to a project whose
canvas is behind a running game, and Delete is the most expensive button in
the column.

The panel keeps one set of open rows across both shapes. The directory's ids
for a placed file are `psd:<layerId>:<placementId>` — keyed on the placement
rather than on the file, because the same PSD on two layers is two rows and
opening one is not opening the other — so they share the set with the layer
ids without colliding, and an id nothing matches is simply never asked about.

---

## The tools, on two columns

They were one column down the left edge of the canvas, split by a gap into
"the game canvas's" and "the drawing layer's". The gap was carrying the whole
distinction, and the column grew a *second* column under it whenever PSD Edit
mode was up — a rail whose buttons moved under your hand.

Two columns now, and **which end of the screen a column hangs from** is the
distinction the gap was carrying (`editor/tool-rail.ts` builds both and keeps
one pressed state across them, because only one tool is ever in hand):

| Column | Where | Tools | What they have in common |
|---|---|---|---|
| rail | hangs from the top left | Select, Pan, Point, Boundary | what you do *to* the canvas: the camera and the pointer, then the two that make something out of bare ground — nothing already on it can be promoted into either |
| draw | stands on the bottom left | Pencil, Pattern, Shape, Slice, Lasso, Fill, Text | the ink |

**Text is the exception on that column**, and it is worth saying why it is
there rather than on the rail. Its gesture is a tap on bare ground, like
Point's, and it is the one tool on the draw column that does not hand the
pointer to the drawing layer. But the columns are about *ownership*, and a word
on the canvas is a note in the margin of the artwork: what it is for is saying
something on the drawing, and the next thing anybody does with one is turn it
into pixels. See [Words on the canvas](selection.md#words-on-the-canvas).

Three of the seven paint with the **library** rather than with a colour —
Pattern always, Shape always, Fill when it is aimed at one — and all three are
set from the same control. See [The pattern and shape libraries](pattern-and-shape-libraries.md).

Four of the seven can be **turned round and used as erasers** — Pencil,
Pattern, Shape and Fill, which is `ERASABLE` in `tool-rail.ts`, the set of
tools that lay a mark down. Slice is not one of them: it cuts a stroke in two rather than
rubbing pixels out, which is a different thing that used to share the name
*Eraser* and now has a knife for an icon. Lasso and the rail's four draw
nothing at all. See [Erasing is a flag, not a mode](drawing.md#erasing-is-a-flag-not-a-mode).

Same class, same 56px buttons, same width: `.tool-rail.draw-bar` is the rail
turned the other way up, and `top: auto; bottom: 16px` is the whole of the
difference. Keeping them the same shape is deliberate — they are one
vocabulary held apart, not two kinds of chrome — and putting the ink at the
bottom corner is the right way round on an iPad, where a hand resting on the
glass is nearer that corner than the top one.

Anchoring the toolbar by its **bottom** edge is the load-bearing bit: a canvas
mode puts a 52px bar along that same edge at a higher z-index, so without a
lift the toolbar sits behind it. PSD Edit mode — whose whole subject is
drawing — lifts it clear; the other three take the pointer outright and it
goes down with everything else. The rail needs none of this, because nothing a
mode puts up reaches the top of the canvas. Two rules in `modes.css`, asserted
in `styles.test.ts`, because a toolbar hidden behind a bar is not an error
anything reports — and so is the `top: auto` itself, since dropping it leaves
the toolbar hanging from the top *over* the rail.

**Every tool is in one of the two columns, and there used to be an exception.**
Rub was a `ToolId` with no button on either — the pencil turned round, rubbing
out PSD Edit mode's own session ink, offered as a toggle on that mode's bar —
and `OFF_BAR` was a second table holding its label so that picking it up did
not look like picking nothing up. Both are gone; see *Rub went, and the four
brushes were already the answer*, below. `tool-bars.test.ts` now asserts the
plain thing: every `ToolId` is in a column. A tool that is in none gets no
button anywhere and a blank label the moment something puts it in your hand,
and nothing else would say so.
