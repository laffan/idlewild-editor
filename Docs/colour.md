# The colour picker, and the palette under it

One control answers *what colour* everywhere in the app, and what has grown
around it: an eyedropper, a palette somebody builds, a hundred and twenty-three
palettes carried over from another project, and a way of putting the whole lot
into a PSD on its way out to Photoshop.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md). The
opacity half of the picker is next door, in
[A colour carries its own opacity](drawing.md#a-colour-carries-its-own-opacity),
because it is about what a colour *is* rather than about the control.

---

## One picker, five places

`lib/color-picker.ts` is built once and used by the paint control
(`editor/paint-picker.ts`, which is the Fill tool, the Pattern brush, the Shape
brush and a fill already on the grid), the backdrop panel, the text panel and
Page Setup. Nothing about it knows which of those it is in, and that is the
whole point: a colour picked for a stroke and a colour picked for a backdrop
are the same question, and five palettes that drifted apart is what the single
control exists to prevent.

It is hand-built rather than `<input type="color">` because that control is
unreliable in WKWebView on iPadOS, which is the platform this editor is mostly
used on. Everything below follows from being on a touch screen without one.

Top to bottom the control is now:

```text
┌──────────────────────────┬────┬────┐
│  saturation / value      │hue │ ⍺  │
├──┬───────────┬───────────┴────┴────┤
│ ⌖│  #RRGGBB  │  hex entry          │   ← the eyedropper leads this row
├──┴───────────┴─────────────────────┤
│  ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪                   │   ← recents: a record
├────────────────────────────────────┤
│  [+] ▪ ▪ ▪ ▪ ▪                     │   ← the palette: a decision
│  [      Browse Palettes        ]   │   ← says Close while it is open
│  [   Attach palette to PSDs    ]   │   ← a toggle, not an action
└────────────────────────────────────┘
```

### Two rows of swatches, and they are opposite kinds of list

The recents and the palette look alike on purpose and mean opposite things.

The **recents** are a *record*. The last eight colours used, newest first, kept
without being asked for and dropped off the far end without being asked either.
Nothing about them is a decision, which is why there is nothing to press.

The **palette** is a *set of decisions*. Nothing enters it except through the
`+` and nothing leaves it except through the `−`, it holds up to forty-eight,
and going past the ceiling is a **refusal** rather than a drop off the end —
which is the difference, stated in behaviour rather than in a label. It is the
one with buttons under it because it is the one you can change.

Both are app-wide and in `localStorage`, beside the pattern and shape
libraries. The reasoning is the one
[`lib/library/store.ts`](../src/lib/library/store.ts) gives at greater length:
a palette built on Tuesday belongs to the person rather than to whichever
project happened to be open.

### The one button that changes its mind

A palette needs a way in and a way out, and on a touch screen the way out is
the hard half. A per-swatch delete is a long-press on a 26-pixel target; a
Remove button under the row needs a *selected* swatch, which is a second kind
of selection in a panel that already has one.

So there is one button at the head of the row and it is about the colour in
hand: a `+` while that colour is not in the palette, a `−` while it is. Taking
a colour out is "pick it, then press the button that is already there" — two
taps and no new idea — and the button always says something true about what
you are looking at, which a plain `+` pressed twice does not.

---

## The eyedropper

`lib/eyedropper.ts`. The platform has an `EyeDropper` API and it is no use
here: it is Chromium's, WKWebView has never shipped it, and it samples the
whole *screen*, which is more than anybody wanted. What somebody means by the
eyedropper in a drawing app is "that colour, there, in my picture", and a tool
that will also hand back the shade of grey behind a toolbar button is wrong
about a third of the time.

So it samples **canvases and nothing else**. `elementsFromPoint` gives the
whole stack under the pointer and it is filtered to canvases. In the editor
that is the drawing stage's two canvases over Phaser's — see
[The drawing layer](drawing.md) — and on the home screen it is the project
thumbnails, which is a happy accident.

### It reads a patch, not a pixel

One sample is an eleven-pixel square of the screen, composited **back to
front** through every canvas under the pointer, and the colour is the middle
of it. Two things follow and both are the point.

The colour is **what you can see**, rather than what the topmost layer holding
anything happens to contain: a half-transparent stroke over the grid samples
as the blend, the way an eye reads it, instead of as the stroke's own hue at
full strength. Reading front-to-back and stopping at the first opaque pixel —
which is what this did first — answers a different question.

And the patch is what the **loupe** draws, magnified twelve times with the
pixel that would be taken boxed in the middle. A preview that is a flat chip
of the answer tells you what you have got; a magnified patch tells you what you
are *about* to get, which is the question being asked while the pointer is
still moving. On a 16px grid the difference between two neighbouring pixels is
the difference between the tileset and its outline.

The radius is in **CSS pixels**, so each canvas is asked for however much of
its own backing store falls under that square — a different number per canvas,
since the drawing stage is several times the size of what is on screen — and
each is drawn into the patch scaled to fit. The patch is a picture of the
screen rather than of any one canvas's pixels.

**A press and a drag are one gesture.** A tap picks what is under it; a press
that then moves keeps picking and settles on wherever it is let go. That is
the only usable gesture on an iPad, where the thing being pointed at is under
a finger — so the loupe is centred on the pointer for a mouse or a pen, where
a magnified view of what is underneath is not in the way of anything, and
lifts clear of a **touch**, where it is. The pick is made on lift rather than
on land, from a fresh read at the point it was let go of: a drag that outran
the renderer left the loupe a sample or two behind.

### Why the engine's canvas needs a favour

A 2D canvas answers `getImageData` immediately. A WebGL one does not — its
drawing buffer is cleared after each frame unless it was asked at creation to
keep one, and Phaser's is not. Asking for `preserveDrawingBuffer` would cost
every frame of the editor a copy, for a tool used a few times an hour.

The renderer will read pixels *during* a frame, though, which is what
Phaser's snapshots are. There are two, and they cost different things.
`snapshotPixel` reads four bytes and hands back a colour; `snapshotArea` reads
the region, copies it to a canvas and builds an `Image` from a data URL. At
eleven pixels square that second route is a few hundred bytes of PNG, which is
what makes it affordable on every move of a drag — it is the same call that
would be ruinous over a viewport.

Both are **one frame** of latency and no more, which is the number that
matters: the loupe is allowed to trail the pointer by a frame and is not
allowed to drag. Getting `snapshotArea` down to that meant *not* waiting on
`image.decode()` — Phaser already calls back from the image's own `onload`, so
the wait bought nothing and cost a second frame. Measured in the harness at
one frame each, against two before.

So the whole sampling path is asynchronous, one read is in flight at a time,
and the lift takes a fresh read rather than whatever the loupe is showing.

The game registers itself through `setEngineSampler`
(`game/sample-pixel.ts`, wired in `editor/editor.ts`) rather than being
imported, for the reason everything else in `lib/` stays out of `editor/`: the
picker is a library control and the renderer is the shell's. Nothing
registered means the eyedropper falls back to plain 2D canvases and keeps
working.

Only one snapshot can be live per frame, so a request that is replaced never
fires its callback. Every read is therefore given a timeout that settles it —
a promise that hangs inside a gesture is worse than a sample that comes back
empty.

---

## Browse Palettes

`editor/palette-browser.ts`, over the data in `lib/palettes/`.

A hundred and twenty-three palettes carried over wholesale from
[simple-tileset-generator](https://laffan.github.io/simple-tileset-generator/),
which are five people's collections rather than ours — muzli, Adobe Color,
ColourLovers, Coolors and ColorHunt. Each source carries its url and the
browser draws it under that source's rows, because the credit travels with the
colours.

Upstream they are five JSON files fetched the first time the palettes tab is
opened. Here they are a **module**, for the reason every asset in this app is
committed rather than fetched: the shell is a Tauri app that has to work with
no network, on an iPad, and a `fetch` of a relative path resolves against
whichever of the two origins the window happens to be on — see
[The shell and the runtime](shell-and-runtime.md). Seven kilobytes of hex is
not worth an origin question.

A tap on a colour adds that colour; **Use** adds the row. Both *append*, as
upstream does, and that is the right way round: a palette somebody is building
is not replaced by the next interesting row they see, it grows by the two
colours out of it they actually wanted.

### Why it is a drawer and not a sheet

Everything else in the app that lists things to choose from is a sheet over the
canvas — Export Assets, Project Options, the two library editors. This one
cannot be, because of what it is for. You browse a palette *while looking at
the picker*, adding a colour and seeing where it lands in the row, and a modal
covering the thing you are filling makes that two gestures per colour with the
answer hidden in between.

So it slides out of the **left edge of the properties sidebar** and pushes
nothing. It is absolutely positioned inside the layout's main row rather than
docked into it as a flex sibling, because a sibling would take width off the
canvas and move the picker — which is the one thing it must not do. Its `right`
is read off the sidebar's own rectangle whenever that rectangle changes, which
a `ResizeObserver` catches: the sidebar is draggable, collapsible, hidden
outright in play and code modes, and `position: absolute` under 900px, and the
rectangle is the one answer right in all four cases.

It builds its rows lazily, once. Six hundred elements nobody has asked for
until they press the button.

---

## Attach palette to PSDs

`psd_palette.rs`, reached from `editor/psd-actions.ts` on the way out.

The toggle is a promise about **leaving**, not about the store. When a file
goes out through **Open PSD** on a desktop or **Share PSD** on an iPad, the
palette goes with it as a strip of flat squares on the topmost layer — so
Photoshop, Procreate or whatever opens it has the project's colours under its
own eyedropper. There is no way to hand another app a swatch file it will read,
and no need for one: every drawing program can sample a pixel.

### It is a third editor's mark

[`psd_marks.rs`](../src-tauri/src/psd_marks.rs) already writes two layers
nobody drew — `P | anchor` and `Z | grid` — and this is the same kind of thing
with two differences.

It is **topmost and lit**, where those go underneath and arrive turned off.
Those exist to be lined up against and would otherwise print a red dot over the
artwork; this exists to be *sampled*, and a hidden layer is a layer whose eye
has to be found before it is any use.

And it is named **outside the pipe convention** — `Idlewild palette`, no pipe —
so psd-to-json ignores it; see `psd_layers::category_of` and
[PSD layer naming](../Manual/psd-layer-naming.md). The other two marks are a
point and a zone because the editor reads them back. Nothing reads this one,
and a palette arriving in the running game as a sprite would be a bug in every
project that turned the toggle on. That is pinned by
`tests::palette::the_pipeline_ignores_the_palette`, at the boundary where it is
actually decided, because nothing in the frontend would notice: the first sign
would be a row of swatches drawn over somebody's tileset.

The name carries *Idlewild* rather than being plain `palette` so that a layer
an artist happened to call `palette` is never the one taken out.

### Why it syncs rather than appends

Every send brings the file into line with the toggle as it stands: the strip is
replaced when it is on and **taken out** when it is off. Appending would stack
a second strip on the third share, and leaving a stale one behind would make
the toggle something nobody could un-press. A file with no strip and the toggle
off is not rewritten at all, which is every project that has never used this.

The pipeline is deliberately not re-run afterwards. An ignored layer changes
nothing psd-to-json would emit, and making every Share PSD wait on a re-parse
would be a visible stall for no change to a single asset.

### The strip itself

Squares of a **quarter of the project's grid**, flush, wrapped to the canvas
width, in the top-left corner.

A quarter of the grid because the strip has to sit somewhere on a canvas it
knows nothing about, and the grid is the only scale the file has any relation
to: small enough to stay out of the way on a one-space sprite, large enough to
put an eyedropper in the middle of on a 16px grid, which is the smallest the
editor offers. Floored at four pixels either way.

Flush and unoutlined because somebody is going to put an eyedropper in the
middle of one of these squares, and a hairline between two of them is a colour
that is in the file and not in the palette. Wrapped because the canvas is
whatever size the artwork made it — a sprite one grid space wide would
otherwise show two of a twelve-colour palette.

### It never stops the send

A palette that could not be written is a courtesy that did not happen. The PSD
is still the file somebody asked to open, and failing the round trip over a
strip of swatches would be this feature taking down the feature it decorates.

So every outcome except success is a line in the console and nothing else. The
one real refusal is a file using **layer masks or clipping masks**, which
cannot be rewritten at all without losing work somebody did in Photoshop — see
the note at the top of [`psd_layers.rs`](../src-tauri/src/psd_layers.rs) — and
`sync` reports that as a *reason* rather than an error.

On iPadOS the strip is written **before** the bytes are read, because those
bytes are the file that gets shared: a strip written afterwards would reach the
store and miss the copy somebody is about to draw on.

---

## Where each part lives

| | |
|---|---|
| `src/lib/color-picker.ts` | The field, the two sliders, the hex row, the recents |
| `src/lib/color-palette.ts` | The palette row and its two buttons |
| `src/lib/palette.ts` | The palette itself, the attach flag, the browser hook |
| `src/lib/palettes/` | The five bundled sources, and their credits |
| `src/lib/eyedropper.ts` | Sampling a canvas, and the picking gesture |
| `src/game/sample-pixel.ts` | How Phaser's canvas answers a sample |
| `src/editor/palette-browser.ts` | The drawer |
| `src-tauri/src/psd_palette.rs` | The strip, and syncing it into a PSD |
| `src/editor/psd-actions.ts` | `attachPalette`, on the way out to another app |
