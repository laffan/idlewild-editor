# The PSD pipeline

Every image that enters this editor becomes a PSD, and this is what happens to
it: the write half, psd-to-json, and the round trip back out to Photoshop and
home again.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## The PSD pipeline

Every image becomes a PSD before it becomes a game object.

```
Files / Photos / clipboard / drawn strokes
        │
        ├── bytes ──► psd_write::psd_from_image_bytes
        └── RGBA  ──► psd_write::psd_from_rgba
                            │  PsdBuilder + LayerBuilder, layer named "S | <key>"
                            ▼
                  <project>/psd/<key>.psd
                            │
                            ▼  psd_to_json::process_all_psds
                  <project>/assets/<key>/data.json + sprites/
                            │
                            ▼  P2P.load.load(scene, key, `${base}/assets/${key}`)
                     placed by P2P.place(scene, key, layerPath)
```

The `S | ` prefix is load-bearing: psd-to-json classifies by the pipe
convention and silently ignores layers without it, so a converted image
without the prefix would process to nothing.

### Where Convert to PSD's ten seconds went

A lassoed sketch took about ten seconds on an iPad, with no indication that
anything was happening. Three separate things were paying for it. All three
numbers below are measured — the JavaScript in a browser against a
1826 × 1412 raster, the Rust in `cargo test` against the 14.6 MB PSD that
raster actually writes — rather than guessed at from reading the code.

**The base64 was built as one string.** `toBase64` concatenated the whole
buffer into a `binary` string and handed that to `btoa`: for a conversion that
is ten megabytes of rope concatenation and a single `btoa` over ten megabytes,
**435 ms** on a desktop machine and several times that on an iPad. Encoding
48 KB at a time and joining the base64 pieces gives a byte-identical string in
**96 ms**. The trick is that each piece is a **multiple of three** bytes long,
which is what makes it encode standalone — base64 turns three bytes into four
characters, so a run whose length divides by three encodes to exactly what it
would have inside the whole buffer. There were three copies of this function;
there is one now, in `lib/ipc.ts`, so every import, paste, drop, extrusion and
PSD-edit write takes the fast path too.

**The file was parsed to read its own size.** `psd_dimensions` read the whole
PSD off the disk and handed it to `psd::Psd::from_bytes` to ask for `width()`
and `height()` — and every conversion calls it *before* `psd_pipeline::process`
parses the same file again, so the file was decoded twice to place it once.
The first 26 bytes of a PSD are its header, and its layout is fixed: `8BPS`, a
version, six reserved bytes, the channel count, then the height and the width
as big-endian `u32`s. So it reads 26 bytes: **17.6 ms → 0.075 ms**, and a
multi-megabyte read off the disk goes with it.

**And the iPad build is a debug build.** `npm run build:ios` is
`tauri ios build --debug`, so without a profile override every crate in the
tree compiles at `opt-level = 0` on the device somebody actually draws on —
including the entire PSD pipeline, which is *all* dependency code: the `psd`
fork writes the file and psd-to-json parses and slices it. `Cargo.toml` now
carries `[profile.dev.package."*"] opt-level = 3`, which optimises the
dependencies and leaves this crate at 0, so a debug build still steps through
app code and still compiles as quickly as it did. On the same sketch, on the
same machine: writing the file **2.16 s → 0.86 s**, and running psd-to-json
over it **2.34 s → 0.13 s**. Four and a half seconds of Rust becomes one.

Two things are left, and both are somebody else's file. The 13.7 MB base64
string crosses the Tauri bridge as JSON; Tauri 2 can take an `ArrayBuffer` as a
raw request body instead, which would remove the encode, the JSON serialise and
the Rust decode together, at the cost of moving the command's named arguments
into headers. And a 1826 × 1412 sketch — a few percent ink on a clear ground —
writes a **14.6 MB** PSD, which says the channel data is going in uncompressed;
RLE would shrink it and everything downstream that has to read it. That is
`PsdBuilder` in the [`psd` fork](https://github.com/laffan/psd), not this
repository.

**And it says so while it happens.** `editor/psd-progress.ts` already had the
sheet — an undismissable panel with a sliding bar and the pipeline's own
`psd-log-line` events under it — for the background writer; the two conversions
use it now. The one thing that had to be added is that `stage()` **resolves
after a paint**, two `requestAnimationFrame`s deep: the rasterise and the
base64 are synchronous on this thread, so setting the text and going straight
into them puts the words up after the wait they describe. The sliding bar is
CSS `translateX`, which runs on the compositor, so it keeps moving through
those blocked stretches.

### Pasting is importing

A paste on the canvas takes the first image on the clipboard and runs it down
that same pipe, landing it in the middle of the view on the active layer.
There is no separate paste path and no paste-shaped document object: the bytes
become `<project>/psd/<key>.psd` like every other import, which is why a
pasted screenshot can be opened in Photoshop, re-parsed and reconciled with
everything else.

`editor/paste.ts` listens for the DOM's own `paste` event rather than calling
`navigator.clipboard.read()`. The event arrives carrying the data, so there is
no permission prompt and nothing to fall back on; reading the clipboard *cold*
is what the Add Image sheet does, because there no paste has happened. The
listener stands down whenever the caret is in a field — a layer name, a
numeric input, the code editor — where a paste means paste. It knows only
about the clipboard; what happens to the file is `editor/paste-actions.ts`,
beside the other verbs the editor has.

**A paste is marked like every other import.** The two orienting marks are the
whole reason a PSD is worth opening in Photoshop, and a paste with neither has
nothing to draw against — so the artwork's size is measured *before* the
import, because the marks travel with it. `createImageBitmap` is what measures
it, which also settles the other question for free: it decodes every raster
format a clipboard can carry and no PSD at all, so the null it returns is the
frontend reaching the same conclusion Rust reaches from the `8BPS` signature,
from the only evidence each side has. A pasted PSD is therefore unmarked and
untouched — as a `.psd` imported from Files is, and for the same reason:
adding our layers would mean rebuilding someone else's stack.

**And that same decode is what crops the transparent field off it.** Copy a
patch of a drawing out of Photoshop or Procreate and what reaches the
pasteboard is a PNG **the size of the document it came from**, with the copied
marks somewhere inside it and nothing but alpha around them. That is the right
answer for pasting back into the same document — the padding is what makes the
patch land where it was cut from — and the wrong one everywhere else: here the
padding *becomes the artwork's size*, so a thumbnail-sized sketch claims a
footprint the size of somebody else's canvas, the placement's handles are
nowhere near the picture, and the PSD written out of it is mostly nothing.

`trim-alpha.ts` takes the box of every pixel with **any** alpha at all —
`> 0` rather than a threshold, so the feathered edge of a brush stroke
survives — and re-encodes just that box as a PNG. Three cases hand the file
back untouched rather than cropped: nothing transparent to take off (the
common one, and it means no re-encode at all), a buffer that is transparent
*everywhere* (a 0 × 0 import is not a better answer than the empty rectangle
somebody copied), and anything that fails — an undecodable paste, a canvas
with no 2D context, an encode that returns nothing. The padding is a nuisance,
not a fault, so the worst case is the behaviour there was before it.

It runs **here**, on the way in, and not in Rust, because the size is needed
on this side: the marks travel with the import and describe where the artwork
sits, so cropping after they were worked out would mark the grid for a picture
that is no longer that shape. The same call therefore answers both questions
at once, which is what keeps the two from ever disagreeing.

What it deliberately does not touch: a PSD, which the browser cannot decode
and which arrives as its author built it; and a **replacement** for a file
already in the project (`importClipboard` with a `key`, and every route
through `reimport_psd`), because a file coming home is held where it is rather
than re-centred — see [A file that comes home without its mark](extrude.md#a-file-that-comes-home-without-its-mark) — so cropping
one would slide the artwork out from under every placement standing on it.

`planFor` works out where it lands. The artwork goes at half size, centred on
the space in the middle of the view, and the spaces that box covers become the
footprint — `footprintForBox`, so an isometric paste marks the diamonds it
actually sits on rather than the much larger range around them. `art` is sent
rather than left to Rust's default centring, because the anchor a footprint
hangs from is its *top-left* space and is only its middle by accident. The
whole thing then scales by `EXPORT_SCALE`, since marks are in the file's
pixels and the box is in world pixels.

**⌘V is not the only way in.** An iPad has no ⌘ — and would not deliver a
paste event over a canvas even with one — so the paste path would be
unreachable on the platform this editor is mostly for. *Paste Image* in the
header menu runs the same route, differing only in where the bytes come from:
a paste event carries its data, this has to go and ask. What comes back is
wrapped in a `File` so everything downstream is identical, marks included.
Who gets asked is the next section, and it is the whole of the iPad story.

The exception is a grid that does not snap. A blank project's spaces are
single world pixels, so asking which of them a screenshot covers enumerates
every pixel in it — a hundred thousand separating-axis tests for a footprint
nobody can read. There the box *is* the space: `marksForBox` marks it as one,
with nothing to divide, which is what a selection in a blank project already
is.

Two details of the clipboard itself are worth naming. A PSD arrives with
whatever type its platform invented for it (`image/vnd.adobe.photoshop` on
some, nothing at all on others), so a `.psd` name is accepted on its own
account alongside anything matching `image/*`. And a screenshot is
`image.png` on every platform, so an anonymous paste is named
`pasted-<base36>` rather than filling a project with `image`, `image-2`,
`image-3`.

Rust had to learn one thing for this: `psd_from_image_bytes_marked` now checks
the `8BPS` signature and passes a document that is *already* a PSD through
untouched (`psd_write::is_psd`). An import from a path decides that by the
extension, but bytes off a clipboard have no name to read, and handing a
perfectly good PSD to the image decoder only ever produced "failed to decode
image". `import_image_bytes` therefore measures the file it wrote rather than
decoding the input twice.

### The clipboard the webview cannot see

*Paste Image* reported **"The clipboard is empty"** on an iPad holding a PSD
copied out of Files. The clipboard was not empty. The page was never shown
what was on it.

WebKit hands a page only a *web-safe* subset of the pasteboard — plain text,
HTML, a URL list, PNG, and web custom formats — and suppresses everything
else, files included. A PSD is `com.adobe.photoshop-image`, which is on none
of those lists, so `navigator.clipboard.read()` came back with items carrying
no type this app could use, and the only honest thing the old code could say
about that was that it had found nothing.

The other half of the trap is why ⌘V looked like no way round it. WKWebView
on iPadOS delivers a `paste` event only when the caret is in an editable
element. The editor's canvas is never one — every pointer handler over it
calls `preventDefault`, so nothing in the scene is ever focused — so on an
iPad the paste event that *would* have carried the file never fires at all.
Both routes to the *data* are shut, and they are shut by design rather than by
a bug to work around.

The *keystroke* is a different matter, and it is what makes ⌘V work there
anyway. WebKit dispatches DOM key events to the page before it decides what a
key means, editable target or not — it unified those two code paths years ago
— so the keydown arrives even though the paste does not. That is enough,
because on an iPad the bytes were never going to come from the event: the
shell reads the pasteboard, and the keystroke only has to say when to ask.
`listenForPasteShortcut` is that, and `intake.ts` binds it **only** where
`isMobile` — on a Mac the paste event arrives carrying the file, which beats
going and asking for it, and binding both would import the same image twice.
Auto-repeat is ignored, because one press is one image.

So the shell is asked instead. `src-tauri/src/clipboard.rs` reads
`UIPasteboard` on iOS and `NSPasteboard` on macOS through `objc2`, where there
is no web-safe subset: it lists the types the pasteboard is really holding and
takes the bytes of the first one the pipeline can use. Three passes, in the
order that gets the best answer:

1. **A copied file** (`public.file-url`) — the only route that knows the
   artwork's real name, and on macOS the only route at all, since a file
   copied in Finder puts a URL on the pasteboard and no bytes.
2. **The types it knows by name**, PSD first: copying a PSD out of an editor
   usually leaves a flattened preview beside it, and taking the preview would
   silently discard the layer stack.
3. **Whatever is left, by signature** — `8BPS`, the PNG magic, `GIF89a` —
   because an app that invents its own `dyn.a…` type for a perfectly ordinary
   PNG is not a reason to refuse it.

The command is deliberately **not** `async`, which is what makes Tauri run it
on the main thread: `UIPasteboard` requires that and `NSPasteboard` prefers
it. Since iOS 16 a program reading the pasteboard raises a system prompt, so
a *declined* prompt now looks like an empty clipboard again — `describeEmpty`
tells the three cases apart and says which one happened, because "copy
something first", "save it and import it from Files" and "allow the paste when
asked" are three different next steps.

`editor/clipboard.ts` is the frontend half: shell first, webview second. The
fallback is not dead code — it is what the browser harness and any
non-Apple build use, and it is the same route as before, now second in line
rather than first. Both hand back a `File`, so nothing downstream can tell
which answered.

`tauri-plugin-clipboard-manager` went with this. It was the desktop route and
its iOS half implements text only, which is exactly the gap this closes; a
plugin nothing calls is worse than no plugin.

### Copying is not pasting backwards

⌘V worked from the day the shell learnt to read the pasteboard. ⌘C did not, so
PSDs only ever travelled one way — into a project and never out of one — and
carrying a file to a second project meant Share PSD, a trip through Files, and
Import from Files at the other end.

**There is no `copy` event to take.** That is the asymmetry, and it is not the
iPad's: the browser fires `copy` for a **selection**, and a placed PSD is not
one. Nothing in the scene is ever the focused element — every pointer handler
over the canvas calls `preventDefault` — and there is no range for WebKit to
serialise, so no event arrives carrying anything out, on either platform. The
keystroke is all there is, which is why `listenForCopyShortcut` is bound
everywhere rather than only where `listenForPasteShortcut` is. `isPasteShortcut`
and `isCopyShortcut` are one reader with two letters now, auto-repeat guard and
all: held down, both keys repeat, and one press is one file.

**It stands down for somebody else's copy**, and there are three of those. The
caret in a field or in the code editor (`isTyping`, as every shortcut here
asks). A range of text selected anywhere on the page — reading a line out of the
console and copying it is a copy of the line, and the drawer is deliberately
selectable. And no PSD selected, in which case there is nothing here to take. So
`onCopy` answers whether it took the gesture and `preventDefault` is called only
then, rather than the listener swallowing every ⌘C over the shell.

**What goes on the pasteboard is a `public.file-url` naming the PSD where it lies
in the store.** That is the first thing `read_file_url` looks for, and the only
route that knows the artwork's real name, which is the whole reason to prefer it:
a `tower.psd` copied in one project arrives in the next as `tower` rather than as
`pasted-<base36>`, because a PSD's bytes carry no filename. It also points at the
file rather than a snapshot of it, so a PSD edited between the ⌘C and the ⌘V
arrives edited.

On **macOS** the bytes go on beside it under `com.adobe.photoshop-image`, the
same type the read prefers, so the same ⌘C pastes into Photoshop as a document
rather than as a file reference. `clearContents` then `declareTypes:owner:` then
`setData:forType:` per type, because `setData:forType:` writes only a type that
has been declared and a write that did not clear first would leave whatever was
there before offering itself alongside.

On **iPadOS** it is the URL alone. `setData:forPasteboardType:` sets one
representation on the pasteboard's first item, and the documented way to offer
several is `setItems:` — so two types there means building an `NSDictionary` of
them or risking the second call replacing the first. The URL is the half that
matters, because the paste this exists for is Idlewild's own and a URL into the
app's own container is one the app can read; *Share PSD* is already how a file
reaches another app there. And the command is deliberately not `async`, for the
same reason `read_clipboard` is not: Tauri runs a synchronous command on the main
thread, which is where `UIPasteboard` has to be touched.

`file_url` is the inverse of `psd_write::source_path` and lives in
`clipboard.rs` rather than beside it, because this is the only thing that needs
it — a path handed *back* by a picker is already a URL, and the store is the one
place a URL has to be built. Everything outside the unreserved set is escaped,
`/` apart, so an app data directory called `Application Support` survives; the
test is the **round trip** through the real decoder rather than the spelling of
the escape.

**There is no webview fallback, and that is not an omission.** A page may put
plain text, HTML and a PNG on the clipboard and nothing else, so there is no
route a PSD could take through it — `copyPsd` is the shell or it is nothing, and
on a platform with no pasteboard this knows how to write it says so rather than
quietly copying a flattened picture instead of the file.

A PSD pasted back into the **same** project is an import under the same name,
which overwrites that key with its own bytes and places a second unit: a copy of
the thing on the grid, sharing the file. That is an *instance*, which is what an
option-drag already makes, and it is the honest reading of copy-and-paste inside
one project.

### Dropping is pasting with a pointer

A file dropped on the canvas takes the same route a paste takes — bytes to
Rust, a marked PSD written, psd-to-json over it, a placement anchored on a
grid space. The only thing a drop knows that a paste does not is *where*, and
that buys the two things `editor/drop.ts` is for: the image lands on the space
it was let go over rather than in the middle of the view, and a drop onto an
image that is already there is an offer to replace the file behind it.

**Two routes in, because the platforms differ.** On macOS the shell intercepts
the drag before the webview sees it, and Tauri reports it as an event carrying
OS paths; on iPadOS there is no such interception and the webview gets
ordinary HTML5 drag events carrying `File`s. Both are wired, which is the
arrangement phaser-bench arrived at, and exactly one of them fires per
platform. They meet at `Incoming`, which is a name, an optional OS path, and a
thunk for the bytes — a thunk because the confirmation names the file, and
reading a fifty-megabyte PSD to put its name in a sentence the user is about
to decline is work for nothing.

Positions from the shell are **physical** pixels and everything in the page is
in CSS pixels, so they are divided through by the device pixel ratio. (With
the web inspector attached, macOS reports them from somewhere else entirely.
That is a known Tauri limitation, not something to correct for.)

**What is under the pointer is drawn where the image is.** `game/drop-target.ts`
hit-tests the document with the same front-most rules a tap follows and
outlines the whole placed *unit* rather than the one layer under the pointer,
because that is what a replacement acts on. It has graphics of its own rather
than the selection overlay's: dragging over something does not select it, and
a highlight that moved the selection would leave the wrong thing chosen when
the drag was abandoned. The canvas frame says a drop will be taken at all.

**A replacement asks first, and then keeps the key.** Replacing rewrites
`<project>/psd/<key>.psd` and re-runs the pipeline, so every placement of that
PSD changes with it — including copies elsewhere in the project that reference
the same file. That is what makes the gesture worth having and what makes it
worth a question, so the sheet offers Replace, Add as new, and Cancel. A path
goes through the same `reimport_psd` a picked file does; bytes are written
under the existing key, which overwrites it for the same reason
`import_image_bytes` is already how the clipboard replaces a PSD.

Names still decide keys, so dropping `roof.png` into a project that already
has a `roof.psd` overwrites that file, as importing it from Files always has.
A drop onto empty grid is the same import by another gesture, and inherits
that.

### A footprint is the spaces covered, not the range around them

An import into a marquee marks that marquee: the user dragged out a shape and
that shape is the footprint. A *conversion* — a sketch or a fill becoming a
PSD — is different, and the difference is invisible until the template is
isometric.

A box in world space is a diamond in cell space, so the axis-aligned cell
*range* enclosing an isometric box holds a great many spaces the box never
touches, and the range's own world bounds are far larger than the box that
produced it. `psd_marks::layout` grows the canvas to hold the footprint, so
marking the range put a 132 × 136 sketch into an 832 × 416 file — six times
the area, and a PSD whose canvas bears no relation to the size the inspector
reports for the placement.

`cellsUnderBox` answers the question that was actually being asked: which
spaces does this box overlap? It is a separating-axis test against each
candidate cell's outline, which for a diamond is four axes. `marksForCells`
then outlines the box around *those* spaces and draws each of them as
divisions, so an irregular set stays irregular and the canvas is only as big
as the ink and the spaces under it. The same helper serves both conversions;
only an import still marks a range, because for an import the range is the
truth.

### The marks an import writes

A converted image gets two more layers, which is `src-tauri/src/psd_marks.rs`:

```
S | <key>    the artwork, centred on the anchor
P | anchor   a red dot on the grid space it is anchored to     — under it, off
Z | grid     the outline of the grid selection it was dropped into  — under it, off
```

Neither mark reaches the game. psd-to-json exports pixels only for sprites
and tilesets — a point becomes the centre of its layer, a zone its bounds —
so both are metadata in the running game whatever they are in the file.
`placeableLayers` drops both for the same reason from the other end: placing a
point yields an empty group nobody asked for.

Both go **under** the artwork in the stack and both arrive with their eye
**off** — see **Which way up a conversion's stack goes** and **The marks
arrive turned off**. Neither changes what the editor reads back, because
nothing downstream of here reads a mark as pixels; what they change is the
file's flattened composite, which is the picture Photoshop and the Finder show
for it.

The point is the useful half, because it is recorded in **canvas
coordinates**. `placedPosition` puts it on the world point the mark is
standing on and steps out to each layer from there, so what stays fixed across
a re-import is the mark, not the canvas. An artist can grow the canvas, move
the artwork inside it, or redraw the file, and the artwork comes back lined up
as long as the dot stayed on the spot that should sit on that space. Moving
the dot is therefore the interface: put it at the artwork's bottom-left and
the thing stands on its tile instead of floating centred over it.

#### Where the mark is standing, and why the grid space could not say

A placement records the space it was dropped on — `Placement.anchor`, a cell —
and for a long while that cell was also taken to be where the mark stands: a
re-parse put the dot on `cellToWorld(anchor)` and laid every layer out from
there. It is the obvious reading, and it is wrong for one very ordinary
reason.

A **resize** breaks it. Everything inside a placement is measured against the
size the manifest exported — that ratio is the scale — so making a placed PSD
bigger scales the distance from its grid space to its artwork's corner along
with everything else. The cell is still the space the file was dropped on; it
is no longer the point the dot is over. Positioning from it at the new scale
therefore moved the artwork by the mark's own offset times the change in
scale, and an imported image is anchored on its *middle*, so doubling one and
re-parsing it moved it half its own width. That is the "the PSD jumps when I
re-import it" this section is really about: nothing in the file had moved, and
the thing on the grid still shifted by more than a tile. The inspector's Width
box did the same, being the other way to change the scale.

So a placement keeps `fromAnchor` as well: where its layer's top-left sits
relative to the dot, **in the file's own pixels**, written by `place` and
re-read on every parse. The mark is then at `x - fromAnchor.x * scale`, which
is a derived answer rather than a second copy of one — a drag carries it along
and a resize scales it, and nothing that moves a placement has to remember to
maintain it. `game/reconcile.ts` positions from that point; `anchorWorldOf` is
the one function that answers the question, and a document written before the
offset existed has none and falls back to the cell, which is exact for every
placement nobody has resized.

Extrude's re-apply is the one caller that clears it on purpose. A second Apply
rewrites the file around a *different* space, so the offset describes a
version of the artwork that no longer exists; `reanchor` names the new cell
and drops the offset, and the parse that follows records the new one.

The zone is the orienting half, and it shows the spaces rather than only the
region: an outline alone says how much room the artwork has, while the
divisions say where each space in it begins, which is what you line a
multi-space sprite up against. Both are drawn from the polygon and segments
the editor sends rather than from a rectangle and a step, so an isometric
selection is the diamond it really is and its divisions run along the
diamond's own diagonals; the outline wins where the two meet. The canvas is
the union of the artwork and that footprint, so a tall sprite dropped on one
tile keeps its own size and simply has the tile marked underneath it. The
dot's diameter is even on purpose — psd-to-json reports a point as its
layer's centre, and an odd one lands half a pixel off.

`AnchorMarks.art` says where the artwork's top-left goes relative to the
anchor. An image import omits it and gets centred, because it has no opinion
about where on a grid space it belongs. Anything converted from what is
already *on* the grid does have one, and sends it, so the PSD lands back
exactly over what it replaced.

Both conversions send marks, for the same reason an import does: whoever
opens the file to paint over the block-out needs the grid under it. A fill
marks the spaces it actually covers rather than a box around them — a fill is
usually an irregular shape, and an outline enclosing spaces it never touched
would say something untrue. A sketch marks the spaces its ink sits over,
which `cellRangeForBox` reads off all four corners of the bounding box:
a world-space box is a diamond in cell space under an isometric template, and
its widest cell extents are not the two corners a rectangle would suggest.

A `.psd` imported as a `.psd` is left exactly as its author built it. Adding
marks would mean rewriting someone else's layer stack to say something it may
already say, and a re-import never re-marks for the same reason: the file
coming back is the one being worked in.

### Why an import lands at half size

Everything anyone draws on a retina machine comes out at 2×: a screenshot, a
Photoshop export at the default resolution, a photo. Placed at one world
pixel per image pixel, all of it arrives twice the size it was meant to be.
So `IMPORT_SCALE` is 0.5 (`editor/import-anchor.ts`) and `naturalWidth` keeps
the pixels the file really has, which is what the inspector's width and
height are measured against and what a re-import reconciles through. It is a
default, not a conversion — nothing about the file changes, and a genuinely
1× asset is two taps from full size.

The three *conversions* — a fill, a sketch, an image already on the grid —
have the opposite problem. They draw their own pixels, and at world scale
they would come out at 1× and sit in the same project at half the resolution
of everything imported beside them, which shows the moment anyone opens both
to paint over them. So they rasterise at `EXPORT_SCALE` (`1 / IMPORT_SCALE`)
and place at `IMPORT_SCALE`: the world geometry is exactly where it was, and
the file has twice the pixels.

The marks have to go up with them. They are anchor-relative *world* pixels,
and Rust lays the artwork out against them in the file's own pixel space, so
a conversion that drew at 2× and marked at 1× would get a grid footprint half
the size of the artwork standing on it. `scaleMarks` takes the outline, the
divisions and the art offset up together; `cols` and `rows` are counts of
spaces and stay as they are. `EXPORT_SCALE * IMPORT_SCALE === 1` is the whole
invariant, and there is a test that says so.

`P2P.load` is a module object, not a function — the call is `P2P.load.load(…)`.
The README on `psd-to-phaser` shows `P2P.load(…)`; the shipped typings
disagree, and the typings are what the vendored build actually exposes.

**There is no `root` path.** `place(scene, key, path)` resolves `path` by
walking the manifest's `layers` by name (`shared/findLayer.ts`), so it must be
given a real one. Asking for `"root"` finds nothing, logs *No layer found with
path: root*, and returns an empty group — a selection box with no image in it.
`src/lib/manifest.ts` reads the manifest and `src/lib/placing.ts` anchors one
placement per top-level layer, each keeping its offset inside the PSD canvas. Documents
written by earlier builds are repointed on open.

**It needs a global `Phaser`.** Its sources use the ambient namespace in
value positions — `instanceof Phaser.GameObjects.Group`, `Phaser.Math.Clamp`,
`Phaser.Geom.Polygon` — without importing it, so those survive into the build
as bare global references. Under a `<script src="phaser.min.js">` that is
fine, because Phaser assigns itself to `window`; that is how the exported
games and Phaser Bench run it. The editor imports Phaser as an ES module, so
nothing sets the global and every placement dies on `Can't find variable:
Phaser`. `game/boot.ts` publishes it before the plugin is constructed.

**Wait on `psdLoadComplete`, not the loader.** P2P loads `data.json` first and
only queues sprites once it has parsed it, so Phaser's loader can complete a
whole pass before a single image has been requested. The plugin emits
`psdLoadComplete` on the scene when its textures are actually in; that event
carries no key, so loads are run one at a time.

---

## Editing a PSD, and getting it back

A PSD lives inside the project's own store, so there was nothing for a
re-parse to find that was not already parsed. The round trip is two commands
instead.

`open_psd` goes out through the opener plugin's *Rust* API rather than the
frontend one, so the webview never needs a filesystem scope over the store —
the only path it can ask for is one built from a project id and a PSD key it
already holds.

The way *out* differs by platform, and `platform` is what decides. On desktop
the editor opens the file where it lies in the store and saves over it, so the
file on disk is already the edited one. On iPadOS an app cannot hand another
app its document and get the edits back, so the file goes out through the
share sheet (`navigator.share` with the bytes from `read_psd_bytes`, or a copy
saved through the document picker where the sheet refuses files) and has to be
picked to come home: `reimport_psd` writes it over `<project>/psd/<key>.psd` —
the stem is forced to the existing key, which is what makes it an overwrite
rather than a second import — and re-runs psd-to-json, which clears the old
`assets/<key>/` first.

The way *back* is the same button on both, and it says **Re-parse**. What
differs is only whether it has to ask first. Desktop does not — the file never
moved, so `reprocess_psd` is the whole of it. Mobile asks, because three of
its four answers are a replacement arriving from somewhere.

**The fourth answer was missing, and it was the one a desktop takes for
granted.** The mobile button was called *Re-import* and offered only the three
replacement routes, which made re-parsing in place a thing only a Mac could
do — and there is nothing platform-shaped about it. `reprocess_psd` reads
`<project>/psd/<key>.psd` and runs the pipeline; the file is in the app's own
store on both. Plenty rewrites it without anybody going near Photoshop: Apply
in PSD Edit mode, an extrusion, a layer stack rewritten in the inspector, a
project restored from a `.idlewild` archive. Any of those can leave a manifest
describing the version before it, and on an iPad the only cure was to go
hunting in Files for a copy of a file that had never left. *Re-parse this
file* is now the first row of the sheet, and it is its own runner rather than
an `ImportResult` faked up to fit the import one — nothing is written and
nothing is picked, so there is nothing to report but the manifest.

**Which picker, and why it has to be said.** The other three rows ask *where
the file came back from* — Files, the photo library, or the clipboard — rather
than guessing. Getting "Files" to actually mean Files took two goes, so the
rule is written down here: **on iOS the filters decide, not `pickerMode`.** The plugin
shows the media picker when the mode asks for it *or* when the filters name no
non-media type and do name an image or video one — the two are `||`-ed, and
the plugin's own source comment says the media picker wins "regardless of
what's in the filters". Every filter this app would naturally pass (`psd`,
`png`, `jpg`) is an image type, so a filtered call opens Photos whatever the
mode says, and `pickerMode: "document"` cannot pull it back. Passing **no
filters at all** on mobile is what reaches `UIDocumentPicker`; desktop keeps
its filters, where they only narrow what is selectable. The clipboard route
needs no new command: importing bytes under a key that already exists
overwrites that key's PSD and re-runs the pipeline, which is precisely a
replacement — and a clipboard image never carries layers to lose.

**And what the picker hands back is not a path.** Opening the Files browser
only revealed the next problem: the iOS document picker resolves `NSURL`s, and
a `FilePath::Url` crosses the bridge as its absolute string, so every
re-import failed with *No such file or directory* on
`file:///private/var/…/tower.psd`. The URL form is percent-encoded too, so a
file anyone actually named arrives as `my%20sketch.psd`. `psd_write::
source_path` resolves both at the command boundary — `import_image`,
`reimport_psd` and `save_bytes`, which takes a path from the *save* dialog and
has the same problem. Decoding is confined to the URL branch: a `%` in a
filename on disk is a `%`.

Backing out is not failure. Swiping the share sheet away rejects
`navigator.share` with an `AbortError`, which was logged in red every time
somebody changed their mind; a cancelled pick already resolved to null, and
now a cancelled share does the same.

**Share the file, and nothing else.** `navigator.share({ files, title })`
looks harmless and is not: iOS counts the title as a second item, the sheet
says *Save 2 items*, and an app that opens one PSD declines a two-item share
— so Photoshop and Procreate were missing from a list whose entire purpose
was to reach them. The file goes alone, and its name is what names it in the
sheet.

**The clipboard has no image route on iOS.** `tauri-plugin-clipboard-manager`
reads the system pasteboard, which is the right answer on a Mac, but its
mobile half is text-only: `read_image` is a hard error and the iOS Swift
plugin implements `writeText`, `readText` and `clear`. So mobile goes straight
to the webview's clipboard and skips a call that can only fail — which also
stops *Clipboard plugin unavailable* being logged before every successful
paste. When both routes fail, the **webview's** error is the one reported: it
is the route that could have worked, and re-throwing the plugin's made every
failure on an iPad read "Unsupported on this platform", naming the wrong thing
and hiding what the clipboard actually held.

That matters because WebKit exposes only a safe subset of the pasteboard —
`text/plain`, `text/html`, `text/uri-list`, `image/png` and web custom formats
— so a PSD copied out of another app may simply not be there to read whatever
the pasteboard itself holds. When no readable image is found, the types that
*were* offered go into the message, because "the clipboard is empty" and "a
PSD this cannot see" need different answers from whoever reads the console.

Three caches then hold the *old* PSD and all three have to go, or the reload
quietly shows the previous artwork: psd-to-phaser's parsed manifest, Phaser's
JSON cache entry for `data.json`, and every texture the plugin built. The
plugin exposes no `removeData`, so its entry is overwritten with nothing —
`loadPsd`'s `getData` check is what reads it back. `game/psd-loader.ts` holds
all of this. The asset server already answers `Cache-Control: no-store`, so
the browser is not the fourth cache.

### The texture keys, and why getting them wrong hangs the editor

psd-to-phaser has **two** loading paths and they name textures differently, and
which one is used is the whole of this section.

`p2p.load.load` keys a sprite on `layer.name` alone: a PSD keyed `tower` holding
`S | roof` produces a texture called `roof` and nothing called `tower_roof`. So
two PSDs with a same-named layer share one texture. That is not a corner case —
`New layer` names its rows `layer-1` upward, *counting within each file*, so two
files that each have one collide by construction. And Phaser's loader **silently
drops** a file whose key already exists (`LoaderPlugin.addFile` consults
`keyExists` and simply does not queue it, with no event and no error), so the
first file's artwork answered for the second and nothing anywhere said so. What
it looked like was a pattern layer scattering the object layer's picture: the
pattern's element had no texture of its own, `place` found the name already in
the cache, and the other file's artwork went everywhere.

`p2p.load.loadMultiple` keys it `<psdKey>_<layerName>` and sets an
`isMultiplePsd` flag that `place` reads back, so both halves agree about the
name. **Every load this editor makes goes through that path**, with one config
in it — see `game/psd-loader.ts` — and `lib/manifest.ts`'s `textureKey` and
`scopeKeys` are the one place that spells the key. `canPlace` asks the same way
round, because asking the unscoped question answered *yes* about a layer whose
name another file happened to share.

What that costs is a **microtask**. `loadMultiple` loads each `data.json`, then
queues the images from a `Promise.all().then()` — and Phaser emits
`filecomplete-json-…` synchronously and then checks its queue in the same tick,
so the pass is declared finished and `create` runs before that callback lands.
The editor does not care: it awaits the plugin's own `psdLoadComplete`, as it
always did. The exported game's scene *did* care, because it placed the document
from `create`, so the scaffold places it from `psdLoadComplete` instead and
`placeDocument` returns early until then. A pattern layer needs no such care: it
places what the camera can see every frame and retries what it could not.

Two smaller consequences:

- **The manifest is cached under `<key>_temp_json`, not `<key>`.** A load has to
  watch for the failure of that key rather than of the PSD's, and — the trap —
  `load.json` on a key the cache already holds is dropped with no event at all,
  so a stale entry is a reload that waits out its whole timeout with the file off
  the canvas. `evictPsd` clears both.
- **Masks stay unscoped**, because `<name>_mask` is what `place` looks one up by
  on *both* paths — scoping one would be a texture nothing ever asks for. The
  multi path does not fetch them either, so `loadPsd` queues them itself after
  the main load, which is the behaviour being preserved rather than traded away.
  A mask can therefore still be shared between two files with a same-named
  masked layer, which is why `evictPsd` still takes the project's other PSD keys:
  a mask another loaded file is using has to survive this file being dropped.
  The artwork needs no such care now, and a `<key>_*` sweep is exact rather than
  a guess.

The old shape is worth keeping on record, because it is what the second half of
`evictPsd` still exists for. The names had to be read out of the plugin's own
parsed data before it was cleared rather than derived from a convention, and
three shapes removed per name — `name`, `name_mask`, `name_tile_<col>_<row>` —
then filtered against every *other* loaded PSD's names, so a name still in use
elsewhere was left stale rather than blanked. Miss one and the reload hangs: the
plugin counts its own assets in and waits for a `filecomplete` that never fires,
`psdLoadComplete` is never emitted, and `loadPsd` sat on its fifteen-second
timeout and placed a PSD whose textures had all been evicted and never replaced.
`loadPsd` no longer hangs when it meets that, because the loader going idle
settles the wait as a second, weaker signal, and any sprite left without a
texture is named in the console.

Placements survive the swap: each keeps the spot its anchor mark is standing
on — see **Where the mark is standing, and why the grid space could not say**
— and its size *relative to* what the manifest exported, so a deliberately
shrunk image stays shrunk against new artwork. A placement whose layer is gone
from the new file is removed — there is nothing left to draw, and a placement
that can never render is worse than an honest gap.

And a layer that is *new* gets a placement of its own. Reconciliation used to
only revise the placements the document already held, so adding a layer in
Photoshop and re-parsing changed nothing anyone could see: the layer was
parsed, exported and listed in the console, and never drawn. The file said one
thing and the canvas another. A new layer is placed the way its siblings on
that key were — their document layer, their grid space, their scale, and its
own position through the spot their anchor mark stands on — because that is
the only placement that can be inferred honestly. With no sibling to infer from,
nothing is adopted.

The inspector's list of the file's own layers has to be told too. It is built
once and kept across the panel's re-renders, since it holds half-typed names
and a pending reorder, so a document change never reaches it — only the shell
knows the file itself has moved underneath. It also shows the PSD's canvas
size, which is the number Photoshop opens with and not the one the placement
reports: a converted sketch carries the grid it was drawn over beside the
artwork, so the canvas is the union of the two.
