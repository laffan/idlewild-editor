# The inspector

Three zones in a fixed order, sections that fold, and why every explanation
moved onto its heading rather than sitting under it.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Three zones, not one heading

The right-hand panel used to be headed **Inspector** and show exactly one
thing at a time: the brush while a drawing tool held the pointer, a layer
while a layer was selected, a placed PSD while one was. Three unrelated
subjects taking turns in one box, each hiding the last — picking a PSD took
the layer's facts away, and picking up the pencil took both away.

The heading was the fault. *Inspector* names the furniture rather than what is
in it, so nothing on screen ever said which of the three you were looking at,
and there was no reading of it under which you could look at two. So it is
gone, and in its place are three zones, always in this order:

| Zone | Subject | Shown when |
|---|---|---|
| **TOOL** | what the thing in your hand has to set | the tool has anything to set |
| **LAYER** | the layer the next thing you do lands on | the layer is the subject — see below |
| **OBJECT** | what is selected on the canvas | something is |

The order is the answer the old panel could not give: what is in my hand,
where is it going, what is it on top of. Read down the column and it is the
same sentence every time.

**A zone with nothing in it is never mounted.** `createZone` hands back an
element and a `mount` that refuses when the body is empty, so a tool that does
one thing with one gesture — Select, Pan, Point, Boundary, Slice, the
Lasso — gets no TOOL zone rather than a heading over a sentence that never
changes. That sentence is exactly what the single *Inspector* heading was, and
reintroducing it once per tool would have been the same mistake nine times.

**The zone's heading is the panel's head.** The panels in `inspect-panels.ts`
and its neighbours open with a kicker and a title — *Boundary* over *Boundary
1* — and the kicker is now what the heading carries: `OBJECT : Boundary`. The
first namer wins, so the LAYER zone names itself after the layer before its
panel can name it after the word "Layer", and a title the heading has already
said is not drawn twice. That is one rule in `Zone.name` and one condition in
`Inspector.head`, and it is what keeps the panels themselves ignorant of zones
entirely: they still write a kicker, a title and sections, into whatever body
the surface hands them.

**The name is the quiet half of its own heading.** `TOOL` never changes —
that is what makes it a zone name — so it is set thin and at half opacity, and
the subject beside it, which is the part that answers *which one*, carries the
panel's full text colour. A band dark enough to read as a button would put the
emphasis back on the label rather than on the thing the label is about, which
is the shape of the first version of this and why the tint below is a shade
rather than a colour.

**The zones fold, and that is why they are now marked.** The sections inside a
panel have folded since `inspect-collapse.ts` existed, which left the three
headings that matter most as the only ones in the column that did not — and a
placed PSD on a pattern layer is five sections under LAYER before OBJECT even
starts. So a zone heading is a control: the same caret, the same store, keyed
`zone:TOOL` through `zoneKey` so that a section which happens to be called
*Tool* is a different thing.

Once the whole column folds, though, a rule between the zones stops being
enough — three foldable headings among foldable headings need something that
says which three are the structure. Three things say it, and they are the only
three of their kind in the panel: a **chip** (a brush, a stack of sheets, a box
with corner handles — what is in my hand, where it is going, what it is on top
of), a ground a shade off the panel's, and a **2px** rule over it where every
section boundary is 1px.

**A heading's explanation is its tooltip.** Every zone heading carries a
`title`, and the TOOL zone prefers the tool's own line from `TOOL_HINTS` when
there is one. That is half of a move the whole panel made — see **Where the
panel's explanations went** below.

**The LAYER zone steps aside for an object.** It was there always, on the
reading that there is always a layer new work lands on — which is true and was
not the question. Picking a placed PSD drew its layer's whole panel *above* it,
so selecting one thing looked like selecting two and the object you had just
tapped started a screen down. It now shows when the layer is what there is to
talk about: a layer selected, nothing selected, or a **region** — ground rather
than a thing standing on a layer, where the zone answers "where would the next
Fill land", which is a question the selection raises and does not settle. That
is `layerZoneApplies`, beside `layerOf` in `inspect-zone.ts`.

Nothing else changes: the object still belongs to its layer, that layer is
still the one new ink lands on, and the left panel still expands to reveal the
object in it. What went is the second subject, not the relationship.

`inspect-zone.ts` is the zone, `inspect-brush.ts` the TOOL zone's contents,
`inspect-wiring.ts` what every control in the panel actually does, and
`inspect.css` the whole panel's stylesheet — split out of `panels.css`, which
had reached the line limit, along the split the panels themselves make: left
sidebar there, right sidebar here.

---

## The inspector's sections fold

The panel describes one thing at a time, and the thing it describes can be
several screens of it: a placed PSD carries Info, Transform, its collider, its
own layer stack and — on a pattern layer — the rule and its shapes. Most of the
time only one of those is being worked on, and scrolling past four headings to
reach the fifth is the whole of the complaint.

**The fold is applied to the finished panel, not written into each section.**
Sections are built in seven files — `inspector.ts`, `inspect-panels.ts`,
`inspect-placement.ts`, `inspect-collider.ts`, `inspect-pattern.ts`,
`inspect-background.ts`, `psd-layers.ts` — and threading one through all of them
would be seven copies of the same three lines with an eighth forgetting. What
makes one pass over the DOM honest is that the markup already says which sections
have a heading: `inspect-collapse.ts` folds a `.inspect-section` whose **first**
child is an `.inspect-section-title`, and leaves everything else alone. A section
with no heading — the row of buttons at the foot of a panel — is not something to
hide behind a name it has not got.

Two sections used a heading as a *sub-label* rather than as their own name — the
pattern's Density and Repeat boundary, and a gradient's From, To and Direction —
and are now separate sections, because a heading that is not a section's own is a
heading that closes its neighbours with it.

What is folded is state of the **panel**, not of the document, so it is
per-install like a sidebar's width and keyed on the section's **name**: close
Collider once and it stays closed for the next PSD you select, which is the
reason to close it. A heading that counts in itself — `Shapes · 2` — is keyed on
the part before the count, or adding a shape would reopen it. The set is held in
memory as well as in `localStorage`, because the panel rebuilds on every document
change and a drag rebuilds it per pointer move.

The pass is idempotent — a section it has been over carries
`data-collapsible` — which matters because the PSD layer list is built once and
kept across re-renders, so the same element comes back round.

**A heading can carry a subject, and the fold is keyed on the part before it.**
`sectionTitle` builds one — `BRUSH : INK`, the device the zone headings use —
and writes the name to `data-fold-name`, which the pass reads in preference to
the heading's text. Without that, picking a different tip would be a different
section and would reopen one somebody had closed. It is also why the fold's
caret is pushed right with `margin-left: auto` rather than by
`justify-content: space-between`: a heading with a subject is two spans, and
spreading them puts the subject in the middle of the row.

The pencil is what that is for. Its panel used to open with a 19px title naming
the tip — *Ink* — directly above a section heading saying *Brush*, which is one
fact written twice and the only heading in the column at that size. The title
is gone and the heading says both.

---

## Where the panel's explanations went

Under the heading they explain, as its `title`. The panel used to carry them as
`field-hint` and `lib-hint` lines: a sentence under *Scale* saying what a
pattern's scale means, one under *Brush* saying what the Pattern brush does,
one under *Repeat boundary* saying what a repeat is. Each reads once and is
scrolled past for ever after, and in a 300px column four of them is most of the
column — which is the same complaint the fold answers, one level down.

So `sectionTitle` takes a `hint`, `PanelSurface.section` takes one, and the two
library editors' own `section()` takes one. Three rules decide where a line
lands:

- **A line about a section** goes on that section's heading: *Scale*, *Repeat
  boundary*, *Sweep*, *Arrange*.
- **A line about one control** goes on that control: the eraser toggle's, which
  changes with the state; *Make start point*; *Add shape*. A `title` on a
  container answers for every child that has none of its own, so the shape
  editor's align rule sits on the row of six buttons and hovering any of them
  says it.
- **A line about a tool** goes on the TOOL zone's heading, from `TOOL_HINTS`.
  That is where the Shape brush's went, and it is why it exists: its panel was
  a *Stamp* heading over one sentence and no control at all, so with the
  sentence moved the section had nothing left in it — and a heading over an
  empty box is what the three zones were introduced to stop.

**What stays on screen is what is not an explanation.** A line reporting state
is not asked for, it is read: the pattern layer's *No shapes — the pattern goes
on for ever*, the reason Delete layer is disabled (a disabled control shows no
tooltip anyway), the pen's live count of corners down, the collider section's
*this project has no grid*. Those are the panel's answers rather than its
instructions, and three of the four are the only thing their section contains.

Native `title` rather than a tooltip of the app's own, because that is what the
rest of the editor already uses for exactly this — the tool rail, the mode bars,
every button in the two library editors — and because on the iPad there is no
hover to serve either way. What a tool has to say there, it says in the line the
console prints when it is picked up.

**There is one exception now, and the reason is the sentence above.** "No hover
to serve either way" is an acceptable answer for a *tool*, because a tool that
has been picked up says its piece in the console and the panel is standing
there in front of you either way. It is not an acceptable answer for a sheet
you see once, at the moment you are deciding what a project *is*: New Project's
explanations are the only place the grid scale or the character controller is
described, and a native `title` would have moved every one of them somewhere an
iPad cannot reach. So the hints on that sheet are `lib/tooltip.ts` — a `?`
button that opens to a hover *and* to a tap, which is the thing `title` cannot
be. See **Why New Project is drawn in the settings vocabulary**.

The rule that remains, then: a `title` where there is another way to the same
information, and a `?` where the sheet is the only way.
