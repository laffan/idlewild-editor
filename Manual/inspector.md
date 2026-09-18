# The properties sidebar

Three zones, always in the same order, and the rule about where an explanation
goes.

Part of [the Idlewild manual](README.md).

---

## Three zones

- **The properties sidebar is three zones, always in that order: TOOL, LAYER,
  OBJECT.** It used to be one panel headed *Inspector* that showed exactly one
  thing at a time — the brush while a drawing tool held the pointer, a layer
  while a layer was selected, a placed PSD while one was — so picking a PSD
  took the layer's facts away and picking up the pencil took both away. The
  heading was the problem: *Inspector* names the furniture rather than what is
  in it, so nothing on screen ever said which of the three you were looking
  at, and there was no way to look at two. Now **TOOL** is whatever the thing
  in your hand has to set, **LAYER** is the layer the next thing you do will
  land on, and **OBJECT** is what is selected on the canvas — read down the
  column and it is the same sentence every time. A zone with nothing to say is
  not drawn at all: a tool that does one thing with one gesture gets no TOOL
  zone, because a heading over a sentence that never changes is the thing the
  single heading was doing wrong. Inside them, the sections are what they
  were — Info, Transform, the collider, the file's own layer stack. A placed
  image's title is its filename, and retyping the part before `.psd` renames
  the file, moves its assets with it, and repoints every placement on it
- **The three zones fold too, and they are marked as the ones that are not
  sections.** Each carries a small chip — a brush, a stack of sheets, a box
  with corner handles — sits on a ground a shade off the panel's, and has a
  heavier rule over it than any section boundary. Without that, a column that
  folds from top to bottom has nothing in it saying which three headings are
  the structure

## Sections fold

- **Every named section folds away.** A placed PSD carries Info, Transform, its
  collider, its own layer stack and — on a pattern layer — the rule and its
  shapes, and most of the time only one of those is being worked on. Click a
  heading and it shuts; it stays shut for the next thing you select and for the
  next time you open the app, because closing Collider once is a statement about
  how you work rather than about that one PSD
- **A heading can say which one, as well as what.** The pencil's panel used to
  open with a heading naming the tip — *Ink* — above a section called *Brush*,
  which is one fact written twice. The section says `BRUSH : INK` now and
  changes as you pick a tip, and what it folds under is still *Brush*, so
  choosing a different one does not reopen a section you closed
- **A PSD you have just made opens on its layers.** Generate PSD, either
  Convert to PSD, an extrude Apply and a new image backdrop all end with an
  empty file standing on the grid, and the only useful next move — Open PSD,
  or draw into one of its layers — was four sections down a panel that opens
  on Info. The rest of the panel folds away and it scrolls to the file's own
  stack, so what is in front of you is the thing you just made and the way
  into it
- **Transform sits under Info, and Collider is last.** Between them Info and
  Transform are what the thing *is*; a collider is what it *stops*, which is a
  question you come to after the file and its layers rather than in the middle
  of them

## What selecting selects

- **Selecting a thing no longer selects its layer as well.** Picking a placed
  image drew its layer's whole panel above it, so one tap read as two
  selections and the thing you tapped started a screen down. The LAYER section
  is there when the layer is the subject — one selected, nothing selected, or
  a patch of grid, where it answers where the next Fill would land

## Where the explanations are

- **The explanations are on the headings, not under them.** A sentence saying
  what a pattern's scale means, or what the Pattern brush does, reads once and
  is scrolled past for ever after — and four of them is most of a narrow
  column. They are tooltips now: hold the cursor over *Scale*, or over the
  TOOL heading, or over *Add shape*, and the line is there. What stays on
  screen is what is not an explanation — a count, an empty state, the reason
  a button is greyed
