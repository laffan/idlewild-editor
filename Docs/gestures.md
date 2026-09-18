# Gesture routing

One surface, several things that want a touch, and the rules that decide which
of them gets it.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

All pointer input over the canvas goes through one arbiter,
`src/game/camera-rig.ts`, which hands out high-level events. The spec's
contract:

| Input | Result |
|---|---|
| One finger down on the current selection | Drag it, snapped to the grid |
| One finger, moved, under **Select** | Rubber-band a selection from where it went down |
| One finger, moved, under **Pan** or **Point** | Pan |
| One finger, moved, under **Boundary** | Sweep an outline; on release it becomes a blocking zone |
| Space held | Borrow Pan until it is released |
| Two fingers | Zoom about the midpoint; the remaining finger keeps panning on release |
| Hold ~320 ms, still | Begin a grid selection where the finger is, with its action bar |
| Either of those, in extrude mode | Take hold of a face of the shape, or pull the one already held |
| ⌘ (or Ctrl) held, in extrude mode | Borrow X-ray, so the far side is what a click lands on |
| Tap | Pick the point under the finger, else the image, else the boundary, else the fill, else clear |
| Tap, under **Point** | Put a named place on the space it landed on |
| Double-tap a placed PSD | Open it up into its own layers |
| Ctrl/⌘ + wheel | Zoom (WebKit reports a trackpad pinch this way) |

**Which taps are reported is the tool's too.** Under Select a tap is a hold
that never got to fire — the timer was still pending when the finger came up,
so it neither moved nor stayed. Under Point there is nothing to hold for and
the tap *is* the gesture, so a pointer that went down and came up without
becoming a pan is one. Pan reports none at all, which is what makes holding
space safe over anything: the camera tool picks nothing up.

**The tool in hand decides what a drag means**, through `rig.setMode`. It used
to decide nothing: a drag always panned and only a hold started a selection,
which made Select and Pan the same tool with a delay between them and left no
way to rubber-band over several things at once. The mode takes effect on the
next pointer-down rather than immediately, so a pan never turns into a
marquee halfway across the canvas.

Under Pan — picked from the rail or borrowed with space — the canvas shows a
hand, closed while the drag is under way. A class on the canvas wrapper
rather than an inline style, so the drawing layer's own crosshair still wins
where it is up, and `canvas:active` for the closed hand rather than a pair of
pointer listeners: the canvas keeps its activation state even though every
pointer handler over it calls `preventDefault`.

Space borrows Pan for as long as it is held (`editor/shortcuts.ts`), which is
what makes a Select tool that no longer pans bearable — the camera is one
thumb away from wherever you are. The tool it interrupted is remembered
rather than re-read on release, because the rail shows Pan while the key is
down. An iPad has no space bar, which is why Pan is also a rail tool. A
window that loses focus mid-hold never sees the keyup, so `blur` releases it
too.

There is one arbiter at a time. A drawing tool calls `setSuspended(true)`,
which hands input over without tearing down camera state, and the drawing
layer runs its own two-finger pan and pinch back into `panScreen` / `zoomAt`
— so the two layers never both read the same gesture, and the camera works
identically under either.

Boundaries sit between images and fills for a reason. A boundary is a thing
someone made and a fill is the ground it was made over, so it comes first of
those two — but a boundary is usually drawn *around* the images inside it and
would otherwise swallow every tap meant for one of them. It is hit-tested
against its polygon rather than its bounding box (`pickZone`), because
selecting an L-shaped wall by the empty corner of its box is not selecting
the wall.

A selected boundary drags like a placed image: the cell delta is projected
back into world space with `cellToWorld`, which is linear and has no offset
term in either projection — which is what makes it usable on a *difference*
as well as on a position. The outline keeps its shape and whatever sub-cell
offset it had, and moves a whole space at a time.

Only the *current selection* is draggable. A pointer-down anywhere else
starts whatever the tool says — a marquee, or a pan — which makes a drag of
something always something the user picked first. A drag writes to the
document on every pointer move, so the scene brackets it with
`onDragStateChange` and the panels hold their re-renders — otherwise the
inspector would rebuild its colour picker, and the layer panel its name
inputs, every frame.

## Points, and where a scene starts

A point is a named place: psd-to-phaser's `P | name`, made by hand rather than
found in a PSD. It has no size and nothing to fill, so it is a name and a
position and nothing else, and it is the one thing on the canvas that a **tap**
on empty space makes — which is why Point is a tool where a region Fill is
not. Nothing already on the canvas can be promoted into one, and that is the
whole argument: Fill is an action on a patch of grid you have already
selected, so a tool slot for it would only ever have done nothing.

A **Boundary** is now a tool for the same reason read one step further. One
could always be made from strokes already drawn and lassoed, which is the
right gesture when there is a sketch to promote and no gesture at all when
there is not — an empty patch of ground holds nothing to promote. So the two
sit together at the foot of the rail, and the two routes meet in the middle:
`zonePoints` simplifies a swept outline exactly as `strokesToZonePoints`
simplifies a drawn one, and both are named by the same counter, so a boundary
swept with the tool and one converted from a sketch of the same shape are the
same document object. The tool's own half is thin on purpose —
`beginZone` is the lasso's sweep with a different ending, and it hands the
raw polygon out rather than simplifying it, because how coarse a boundary may
be is a fact about the *grid* and the drawing engine knows nothing about
grids.

**It is stored as a cell**, where a boundary is world pixels and a placement
is both. A point is put down on a space and dragged a whole space at a time,
so a world position would be a second copy of the same fact: one more thing
for a grid resize to keep in step, and one that Rust would have to learn the
projection to read back. `cellCentre` turns it into a position wherever one is
wanted — the renderer, the picker, the drag — and on a blank project, where a
cell is a pixel, that is the pixel that was tapped.

**A tap picks a point before anything else.** It is the smallest thing in the
document and the only one drawn over everything, so a point standing on a
building has to win the tap or it can never be picked up at all. Its reach is
half a tile height, which is a finger's worth and less than a space, so
nothing else is caught by it. And the pick is the *nearest* rather than the
front-most, which every other picker answers: two markers close together are
two dots a finger lands between.

**The marker is drawn twice**, a light halo under the accent. Everything the
editor draws is the accent — and the first point anybody puts down goes on a
fill, which is the same accent. A red ring on a red patch is not a marker.

### The start point

One point per scene can be where play begins, and that is stored as
`Scene.startPointId` — an id on the *scene*, not a flag on the point. The
difference is the whole design: "only one" is then a fact about the document
rather than a rule something has to enforce, and naming a second point is the
first ceasing to be it, with nothing to clear and nothing to go wrong halfway.
It also survives renaming and moving the point, because an id is neither.

Two things clear it, and both write in one commit so a scene never names a
point that is not there for even one `change` event: deleting the point, and
deleting the layer holding it. Duplicating a scene translates it through the
same map that gives the copy's points their new ids — an untranslated id would
leave the duplicate starting on a point in another scene.

It reaches the game as `spawn`, the field both scaffolded scenes have read
since they were written: `game_config` resolves the id to its cell, or falls
back to the origin for a scene that names none — or names one that has been
deleted, which is the same thing honestly reported. So designating a start
point is that field answering differently, and every project's own
`spawnCharacter` follows without being touched. The points themselves travel
too, in `layers[].points`, so a door or a trigger is a matter of reading back
the one you named. `span_for` counts them: the span is also how far the
character may walk, and a start point outside it would put the character
outside the world on the first frame.

## What a marquee catches

Select has two gestures, and they ask different questions — which is why
`game/marquee.ts` draws them differently and answers them differently.

**Press and hold asks for a patch of grid**, and a patch of grid is all it
ever answers with. Fill, Add Image and Generate PSD act on it, so it is
measured in spaces and drawn as the grid draws them: under an isometric
template, a diamond. It stays a `region` whatever is standing on the spaces it
covers — holding over a building to fill the ground under it is the ordinary
reason to hold, and handing back the building instead would make the gesture
unusable exactly where it is most wanted. The floating action bar appears over
it, every time.

**A drag asks what is in here.** The things it catches are images sitting at
world coordinates that owe the grid nothing, so a drag is a plain rectangle —
the one that was dragged, pixel for pixel, with no lattice to round to. What
it catches *is* the answer: a `placements` selection, which drags and deletes
as a group, or `none` if it caught nothing, which is what tapping empty space
means too. No action bar: putting a bar of things to make over it interrupts
a gesture that was about picking things up.

Both used to be the same gesture in two moods, both rounded to cells. On an
isometric project that meant dragging a box and watching a diamond appear
somewhere near it, reaching a long way past the corner you started from and
catching images you could see were outside it.

The dragged band is deliberately **not** a `Selection`. It is a gesture still
happening: it draws into graphics of its own, in world coordinates so a
camera that moves under it leaves it over the same ground, and nothing is
chosen until the finger comes up — which also means the inspector is no
longer rebuilt on every frame of a drag for a thing that is not selected yet.

`pickPlacementsIn` therefore hears from the drag alone, and takes the
rectangle's four corners. A placement counts when the rectangle *overlaps* it
rather than contains it — dragging a box that swallows everything whole is the
fiddly half of every marquee, and nothing here is small enough to catch by
accident. It still takes an outline rather than a box because it once served
the held diamond too, whose bounding box reaches a long way past what was
dragged: hit-testing that box let a marquee in one corner of the screen pick
up images in another, the same mistake, in a different place, as the one that
put a 132 × 136 sketch into an 832 × 416 PSD.

The catch is one layer's worth, chosen by the same front-most-wins rule a tap
follows, so a marquee over a stack picks the layer you would have hit by
tapping. One layer because that is what a drag can move together, and because
carrying placements between layers is the layer panel's job rather than
something a marquee should do by accident.

A `placements` selection has no resize handles. Scaling a PSD against its own
box keeps its layers in the arrangement they were built in (see *A placed PSD
is one thing*), and there is no such relationship between things that only
happen to be near each other — so sizes stay each image's own.

## ⌘ and ⇧ pick, on both surfaces

The marquee was the only way to make a `placements` selection, and it asks a
question about *where things are standing*: a rectangle. That is the wrong
question for the two things there are now to do with several files at once —
grouping them and merging them — because those are about which files they are.
Three trees in a wood are not a rectangle, and a marquee round them takes the
fence as well.

So **⌘-click and ⇧-click pick**, on a row in the layer panel and on the canvas
alike, and they go through one file — `lib/unit-select.ts`. It is `lib/` rather
than `editor/` for a reason that is not filing: nothing in `game/` imports from
`editor/`, and a second copy of this arithmetic on the canvas side would be two
answers to *what does a toggle leave behind* waiting to drift apart. Ctrl
stands in for ⌘ the way it does for undo, so a keyboard with no Command key is
not locked out.

**What is picked is a unit**, not a placement (see `lib/units.ts`), so
everything there works in whole units and flattens to placement ids at the end,
which is what the document and the canvas both speak. ⌘-tapping a tower's roof
adds the building; otherwise the selection would hold half a tower and a drag
would tear it apart. **One layer's worth**, like the marquee's, and for the same
reason: `placements` carries a single `layerId` because a drag moves every
member by the same cell step. Picking on another layer starts again there rather
than growing a selection spanning two — which is also the only reading the panel
could *draw*, since the rows it would light up are under a different heading.

**The modifiers mean slightly different things on the two surfaces**, and that
is not a compromise. A list has an order, so ⇧ on a row takes the **run**
between the last plain tap and this one, and wins over ⌘ when both are down —
⌘⇧-click everywhere else means *add this run*, which is what unioning the range
with what is held already does. A canvas has no order for a run to be measured
along: the things in it are at positions, not at indices, and "everything
between that tower and this one" names no set anybody could predict. So there ⇧
and ⌘ are one gesture, *and this one as well*, which is what every canvas editor
does with them. `pickMode` takes a flag and is the only place that differs.

**Two things a modifier does not apply to**, both silent when wrong. A ⌘-tap on
**bare ground** keeps the selection rather than clearing it: the modifier says
*as well as*, and clearing is indistinguishable from a mis-aim. And a ⌘-tap on
anything that is **not a placed PSD** — a fill, a boundary, a point, a note — is
read as a plain tap, because `placements` is the one multi-selection the
document has and there is nothing for those to be added to.

There was a **⊕** on each row for a while, on the grounds that an iPad has no ⌘.
It is gone: it was a column of plus signs down a list of files, which reads as
an invitation to add files, and it was chrome standing in for a keyboard that
most of the time is attached. The iPad answer is the marquee and the row itself.

Three details are the ones worth a test, because each is invisible when wrong:

- **A single pick is a `placement`, not a `placements` of one.** Almost
  everything about a placed PSD — the inspector's file panel, resizing, opening
  it up into its own layers — is about one thing, and would have to ask "is
  there exactly one?" on every line otherwise. `selectionOf` is where the count
  decides which kind, and an empty set is `none`: ⌘-clicking the last held row
  clears the selection rather than leaving a panel describing zero images.
- **A row is held when any of its placements is**, which is the rule
  `isSelected` already draws the highlight by — the canvas selects whichever
  layer of a file the pointer landed on. So ⌘-clicking a three-layer PSD the
  canvas caught by its middle layer takes the whole file out rather than adding
  it again.
- **The anchor stays where it was through a ⇧-click**, so a run can be
  stretched and shrunk from the same end. Walking it along with the click is
  the bug nobody notices until they have lost the selection they were
  adjusting.

The anchor is panel state, dropped when the scene changes or when a run is
started on a different layer — a fact about the last row somebody tapped, not
about the document. The canvas passes `null` for it, because a run is a list's
idea and goes with the list.
