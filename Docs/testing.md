# Testing

What is covered, where it lives, and what each suite is pinning.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

`cargo test --lib` covers the load-bearing path: RGBA → PSD → psd-to-json →
manifest → zip, plus the path-traversal guards, the project scaffold, what an
export's config carries, the whole of a layer's eye — an edit hides it, the
file comes back hidden, the manifest says so, a rewrite that says nothing
leaves it alone, and a second extrude Apply does not switch it back on — the shapes a file picker hands back, and the order a
manifest lists a PSD's layers in — which the frontend mirrors and cannot check
for itself. `tests/exports.rs` holds what leaving with a project *takes*, split
from the scaffold tests along that seam: the document in the shape the game
reads, the spaces every placed PSD blocks, a document too broken to read, and
Export Assets — that it takes the files and the halves it was asked for and
nothing else, and that an archive which would come out empty is refused with a
sentence rather than written. The project's options are next door in `tests/options.rs`: that an unticked
character controller scaffolds the **same tree** as a ticked one and differs
only in the config, that it can be turned off and on again afterwards, and
that changing a rendering option rewrites the config the game reads rather
than waiting for whatever touches the document next. `tests/scenes.rs` is the
file each scene in the sidebar is written in — that a name somebody typed
comes out as a class name, that two scenes called the same thing get two
files, and that the three things which can happen to a scene each do the
obvious thing to its file: scaffolded, renamed *carrying what was written in
it*, deleted.

`tests/tiles.rs` is one assertion made twice over: that a tile layer and its
palettes cross the bridge **unchanged**. Every other record in the document is
reshaped on its way into the config — a fill's cells are reduced to a unit, a
placement picks up its collider — and this one must not be, because what makes
it worth having is that it *is* a Tiled tile layer. So the chunks come out
with the same gids in the same order, flags and all: a gid with `0x80000000`
set says the tile is flipped, and a reader that treated it as a plain index
would have turned it into something else entirely.

**And one thing no Rust test can reach: whether the scaffold is a working
game.** Every assertion above is about text. A scene that places nothing, or a
second scene that waits fifteen seconds for assets the first one already
loaded, is valid JavaScript and passes all of it. So `dump_a_runnable_tree` is
an `#[ignore]`d test that writes a real tree — both runtimes included —
somewhere a browser can load it, and the way to use it is to serve that
directory and open it. That is how the reload guard in `loadDocument` was
found: switching scenes in a project with PSDs left the second one blank,
because Phaser's loader silently declines a texture key it already holds, so
the completion its scene was waiting on never came. The asset
server is tested over a real loopback socket — the request psd-to-phaser makes,
byte for byte, and what comes back parsed as an HTTP response rather than
inspected as a `PathBuf`, because the mapping from URL to file is the one
place where a wrong answer looks like a PSD with nothing in it. It runs
against the real store and cleans up after itself, including on failure.

`import_assets.rs` carries its own two, which are the contract Import Assets
places against: that a bulk import never writes over a file the project already
has — including when the name only collides *after* the sanitiser has had it —
and that a PSD pulled out of another project lands byte-identical, under a key of
its own, with the pipeline run over it and the file it did not replace still
standing there.

The pasteboard is split so that most of it is testable anywhere: which type to
take, what extension it maps to, what a buffer's own signature says it is, and —
for the write half — that the `file://` URL ⌘C puts on the pasteboard is one
`psd_write::source_path` takes straight back, which is the round trip rather than
the spelling of an escape. All plain functions with tests beside them, and only
the calls that actually touch `UIPasteboard` and `NSPasteboard` are behind a
`cfg`. Those two
compile on no other platform, so on Linux the module builds its "no pasteboard
here" arm instead and the frontend falls back to the webview — which is the
same code path a Windows build would take. `cargo check --target
aarch64-apple-darwin` and `--target aarch64-apple-ios` are what type-check the
Apple arms without a Mac; neither one links, and neither is a substitute for
running it on a device.

`vitest` covers the pure halves — the grid projection, fill geometry,
picking (a point's and both marquees'), what is drawn over what, resize
geometry, what the minimap frames and that the camera is always inside it,
what a manifest says is hidden and what a placement records about it,
where a re-parse puts the artwork — that the anchor mark survives the canvas
being grown, the artwork moved inside it, the mark being cropped away and,
the one that used to move it by more than a grid space, the placement having
been resized since —
undo's three answers about a write and what a restored document is,
what each canvas mode counts as one step of its own, whether a selection still
names something, the unit arithmetic
behind a placed PSD and how many objects share one of its files, which of its
layers have wandered off the space the file puts them on and that putting one
back lands on the pixel the drag picked it up from — asserted by running the
drag first, because the two have to agree and numbers typed out by hand would go
on passing if the drag changed under them — what a ⌘C and a ⌘V are as
keystrokes, how a texture
is keyed and what dropping a PSD's is allowed to reach, that Make Unique moves
every layer of the object rather than the row that was selected, what the
inspector remembers about a folded section, what a bulk delete asks and how it
answers a no, what the clipboard hands a paste and where that paste lands, what a failed clipboard read says happened and which of a dragged
selection of files a drop takes, colour, the log's `%c` parsing, the manifest
reader, the platformer's body step, the docs panel's markdown rendering and
its two kinds of lookup, what a project with no options of its own renders as,
and the drawing layer's ported maths. The handful of CSS declarations that are
load-bearing for input are asserted as text — the drawing surface's
positioning, the code panel's four placements, where a docked rule that
stopped taking the panel out of `position: absolute` would look like a panel
that had covered the editor, the minimap's `touch-action`, without which
an iPad takes a drag on the map as a scroll of the sidebar it is in, and that the
minimap is down in both of the modes that run the game over the canvas.
The last two earn their place: a slice that cuts in the wrong spot or a lasso
that misses is a tool that does not work, and a body that catches on the seam
between two floor tiles is a game that does not work. Neither shows up in a
typecheck, and the platformer's regression tests exist because both bugs were
real — a body resting flush on its floor re-overlapped it by a rounding error
on the next frame and was fired out of the side of the ground.

The frontend's check is `tsc --noEmit` plus `vite build`.

On the frontend, `lib/__tests__/tiled.test.ts` and
`lib/__tests__/tile-layers.test.ts` pin the format and what the document does
with it. Mostly round trips, because "indistinguishable from data Tiled wrote"
is a claim about bytes rather than about behaviour: a map goes in, the same
map comes out, and the two things that could silently ruin it are written out
explicitly — the four flags packed into the top of a gid, and the order a
`.tmj` writes its layers in. `0x80000000` does not fit in a signed 32-bit
integer, so a flipped tile read without the unsigned shift is a large negative
number matching no tileset, and the symptom is a map that draws perfectly
until somebody mirrors one wall. The XML half of the reader is not exercised:
it needs a `DOMParser` and this suite has no DOM to supply one, and the two
halves meet at `assemble` and `chunked`, which the JSON cases do put through
their paces.

`npm run harness` serves the editor shell in a plain browser: `harness/` is
the app's own entry with the Tauri modules aliased to stubs, so the layout,
the panels and the sheets can be opened, driven and screenshotted without a
Mac or an iPad. It boots a fixture document with three layers, one placement
and one boundary, and reads `window.__platform`, `window.__pick`,
`window.__manifest` and `window.__options` so the platform split, the re-import
path and a pixel-art project can be exercised from a script. `window.__projects`
puts other projects in the store, which is what Import Assets' second route
needs to have anywhere to go, and `window.__movedRoof` stands the fixture's roof
two spaces off its walls — the one state in which **Reset Layer Position** is
drawn, and not one a harness with no asset server can reach by dragging. Its query string picks the fixture's template and
style — `?template=blank&style=platformer&grid=32` — and `?safe=44` writes
stand-in values over the safe-area tokens, which is the only way to look at
the iPad's insets from a desktop browser. Drawing is drivable there too: CDP's
`Input.dispatchMouseEvent` takes a `pointerType: "pen"` and a `force`, which
is enough to lay a pressure-varying stroke, slice it, lasso it and read the
ink back off the canvas. What it cannot stand in for is the pipeline: there
is no asset server behind it, so placements log a load failure and draw
nothing. The Phaser scene itself still wants a device.

---

**`place()` returns a Group, and a Group is not a display container.** Its
children live on the scene's own display list, and `Group.destroy()` defaults
to `destroyChildren = false` — so destroying the group removed the record and
left the sprite on screen. `destroyPlaced()` passes `true` for a Group and
nothing for anything else, because `GameObject.destroy(fromScene)` reads its
first argument completely differently. The plugin's `attachMethods` grafts
`setPosition`, `setScale` and the rest onto the Group, forwarding them to its
children.
