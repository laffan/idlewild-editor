# Print projects

A project can be for a page as well as for a game. This is how one is put
together: two resolutions and which part of the app sees which, the sheet as a
rectangle of world, `ExportForPrint()`, and the PDF and PSD written from what
it reads — as a PDF, a PSD or a PNG.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Output, and what it fixes

`ProjectMeta.output` — `Output` in `src-tauri/src/print.rs`, mirrored in
`src/lib/print.ts` — is the last question on the New Project sheet:

| field | what it is |
| --- | --- |
| `kind` | `code` (a game, which every project made before this is) or `print` |
| `dpi` | 300 or 600, read as the nearer of the two |
| `paper` | `letter`, `legal`, `tabloid`, `a5`, `a4`, `a3`, `a2` — portrait, in points — or `custom` |
| `landscape` | turns a standard sheet; a custom one is the way round it was typed |
| `customWidth`, `customHeight` | a custom sheet, in points, half an inch to four feet |
| `unit` | `in` or `cm` — only how a custom size is typed and shown |
| `x`, `y` | the page's top-left corner in the world; the origin until it is dragged |
| `formats` | what Save writes: `pdf`, `psd`, `png` (the default) or `jpg` |

Flat and every field defaulting, the way `PublishTarget` is, so a `meta.json`
written before it existed reads as a code project. It travels in a
`.idlewild` manifest beside `options` and `presentation`: the PSDs in the
archive were written at that DPI, and a print project opened as a game would
place every one of them at the wrong size.

**The kind and the DPI are fixed at creation; everything else is not.** Every PSD
the project writes is written at its DPI, and a file made at 300 has no 600's
worth of pixels to give. The paper decides where the page falls and how big
the PDF is, and changes nothing that was drawn. Every later change goes
through one command, `set_project_page`, with a `PagePatch` of only the fields
that change — Page Setup's dimensions, the frame dragged on the canvas, the
preview bar's format — which `print::PagePatch::apply` checks (known paper and
format, sizes clamped to `MIN_PAGE`/`MAX_PAGE`, the origin to a million points
either way and rounded to whole points) and `project_create::set_page` writes,
refusing on a code project.

On the frontend all three go through `editor/print-page.ts`'s `changePage`,
which queues the writes, brings the editor's meta level and calls
`setOpenProject`, which tells every `onPageChange` listener: the screen guide
redraws, and a running Output restarts if the sheet's size or position — not
its format — changed. The dimension rows themselves are
`lib/print-dimensions.ts`, shared by the New Project sheet and Page Setup.

**A print project is Blank PSD to Phaser.** `ExportForPrint()` reads the page
off a running Phaser scene, and a character or gravity is a game's, so the New
Project sheet — whose first question is now Web or Print — takes the
Scaffolding and Rendering groups away under Print and sends `p2p` with the
default options. `project_create::create_project_for` refuses a vanilla print
project for any other way in, and stores the game's default zoom as 1: a page
is looked at at one point to the pixel.

`project_create.rs` holds creation and `set_paper`. It was split out of
`store.rs` for the 700-line rule along the seam print opened, and both are
re-exported from `store`, so every caller — and the forty tests that make
projects — still says `store::create_project`.

## Two resolutions

One world pixel is one PostScript point. A print project's PSDs are therefore
`dpi / 72` pixels to the world pixel: a letter page at 600 DPI is 5100 × 6600.
That is the right size for paper and the wrong size for the canvas, the running
game and the project's own code, all of which would be moving textures sixteen
times bigger than they can show.

So `psd_pipeline::process_held` runs psd-to-json **twice** on a print project:

```
psd/<key>.psd                     at the project's DPI
   │
   ├─ psd_resolution::stamp       ResolutionInfo (1005), so Photoshop opens it
   │                              at the size of the paper
   ├─ psd-to-json ───────────────► print/<key>/      full resolution, the PDF's
   │
   └─ psd_downsample::downsample  every layer ÷ (dpi / 144), names unchanged
        └─ .screen/<key>.psd
             └─ psd-to-json ─────► assets/<key>/     two px to the world px
```

**Why two, and not one.** Two pixels to the world pixel is the resolution every
code project's files already have — `IMPORT_SCALE` places everything at half
size against it. A downsampled file lands exactly where an ordinary one would,
so **nothing downstream of the pipeline had to learn that print exists**: the
editor's renderer, the manifest reader, the placements, the collider guesses,
the game's own loader and the code modal's asset column all read `assets/` as
before.

**Why the PSD is downsampled rather than the output.** psd-to-json's manifest
has a dozen shapes — sprites, groups, atlases with frame tables, animations,
zones with point lists, masks — and scaling every coordinate in it means
knowing which numbers are coordinates. Downsampling the *file* and running the
same tool over it gets a manifest that is right by construction, and because
`psd_downsample` keeps every layer's name, group and order, every sprite in
`assets/<key>/` has its full-resolution twin at the same path under
`print/<key>/`. That path is the whole of how the PDF finds it.

`psd_downsample` premultiplies on the way through, so a sprite cut from a print
file does not come out with a dark fringe — the transparent pixels around it
are usually black, and a straight-alpha resize blends that into every edge.
Masks and clipping do not survive it, for the reason no rewrite in this editor
keeps them: the fork's builder cannot write either. The screen copy shows
those layers unmasked and the log says so; the print side is psd-to-json's
reading of the original and loses nothing.

### The source scale, on the frontend

Every conversion — a fill, a sketch, a merge, an extrusion, text, a background,
an extract — draws its own pixels and used to draw them at `EXPORT_SCALE`.
They draw at `sourceScale()` now, which is `EXPORT_SCALE` on a game and
`dpi / 72` on a print project, and they still place at `IMPORT_SCALE`, because
the manifest they place against is the screen copy. `EXPORT_SCALE *
IMPORT_SCALE === 1` is still the invariant on a game; on a print project the
downsample makes the other half of it, and `lib/__tests__/print.test.ts` pins
the round trip.

An imported image follows the same rule from the other end: its world size is
its pixels over the source scale, so on a print project a picture arrives at
the size its pixels make *at the project's DPI* — a 3000-pixel photograph is
ten inches at 300 — rather than at half its pixels. `planFor` and Import
Assets' layout divide by `sourceScale()`. PSD Edit mode rasterises at the
file's own density, `placement scale × EXPORT_SCALE / sourceScale()`, because
the placement's scale is against the screen copy and the ink lands in the big
file.

`setOpenProject(meta)` sets it once per open project. A conversion is a dozen
call sites deep in files that never otherwise see the meta, and this is a
one-project-at-a-time app; see *One game at a time* in
[The shell and the runtime](shell-and-runtime.md).

## The sheet, in the world

The page is a rectangle of world: its corner at `output.x, output.y` — the
origin for a new project — and its size in points. `game_config::presentation_of`
turns a print project's page into a fixed box the size of the sheet, so the
existing `main.js` layout — Phaser `FIT` against a fixed width and height —
frames it with no second layout written. `config.print` carries the sheet in
points, its corner and the DPI, and `shared/canvas.js`'s `applyCamera` holds the
camera at zoom 1 with its scroll on the corner.

On the canvas, `screen-guide.ts`'s `pageBox` draws the sheet: hung from its
corner rather than centred on the origin, scaled by the camera alone, and
solid rather than dashed, because it is the page edge for edge rather than
*about this much world*. A **label** sits on its top-left corner —
`describePage`: the paper's name and size in inches, or `Custom` and the size
as typed in its own unit — and the label is the handle the page is dragged by.
It is a sibling of the guide rather than a child, at the rail's layer above the
ink, because the guide takes no pointer and sits under the ink's sheet; the
frame follows the drag at once and the corner is written once, on release.

## ExportForPrint()

`templates/print/js/shared/print.js`, written into every print project and
installed by `main.js` on the game it starts. The print variant of `main.js` is
three anchored replacements of the common one (`templates::print_main`) rather
than a second copy, and a test pins each anchor. Each scene of a new print
project calls it once its artwork has loaded — `templates::scene_file_for`
writes the line in, live, so Output shows a page the first time it opens.

```js
ExportForPrint({ name, folder, formats, snapshot, stop })   // → Promise<{ page, pages }>
```

**A call captures; it does not write.** The page is posted to the editor and
drawn in the preview from the screen-resolution files; nothing is written until
Save. `name` and `folder` are what the page is called when it is saved,
`formats` sets what Save is set to, `snapshot: true` adds the page and lets the
code carry on, and `stop` — default true, except on a snapshot — pauses every
scene once the page is read. The promise settles once the editor has the page,
with its index and the count so far, so a run of snapshots is a loop with an
`await` in it; the run ends at the first call without `snapshot`.

**The page is read at the end of the next frame drawn** — on Phaser's
`POST_RENDER` — so whatever the calling code just changed has been through a
render, and a call made straight out of `create()` finds the document placed.

**`stop` pauses the scenes, not the game.** Stopping the game's loop stops the
drawing as well as the updating, and a page captured before the first frame
left the canvas blank. A paused scene does not update, but it is still drawn,
and a later call reads paused scenes as well as running ones.

What it reads, back to front, into Containers and Layers:

- **An image or sprite drawn from a file under `assets/`** is sent as that
  file's path, the frame's crop in the screen copy, the screen copy's size, and
  a six-number matrix mapping the frame's unit square onto the page in points.
  The matrix is the quad Phaser 4's own `TransformerStamp` builds — display
  origin, frame offset, flip as a negative scale — under the camera's matrix
  from `GetCalcMatrix`. Alpha, a single multiply tint and the blend mode ride
  with it.
- **Anything else that draws** — Graphics, shapes, text, particles — has no
  file behind it. Consecutive runs of those are captured into one page-sized
  `DynamicTexture` at the project's DPI (or the device's maximum texture size,
  if smaller) and read back with the texture's own `snapshot`. Text is
  re-rendered at that resolution for the capture and put back after.

**The file path comes from the loader, not the texture.** Phaser fetches an
image as a blob and hands the texture an object URL that is revoked once it
has decoded, so `print.js` listens at `LoaderPlugin.fileProcessComplete` and
keeps a map of texture key to URL.

Inside the editor the page is posted to the parent with an id, its name, its
formats and whether it is a snapshot, and the editor answers
`idlewild-print-done` with the same id once it has it. Anywhere else there is
no parent and the promise settles at once. The editor's Save asks for a page
with `idlewild-print-request`, which calls the same function.

## The PDF

`print_pdf::export_print_pdf` takes the page and writes
`<project>/exports/<out>.pdf`, which the asset server serves to the preview.
Where it goes is `print_files::export_path`: each segment of the folder and
name the page asked for is reduced to letters, digits, `-` and `_` — a PSD
key's rule — so nothing a page sends can climb out of `exports/`. The project's
code runs in a web page, and writing anywhere else on the disk is not
something to hand it; getting the files out is the person's, through
`save_print_file` (one) or `save_print_files` (several, as a zip).

Each item becomes one image XObject placed with one `cm`. Page space is
y-down from the top and PDF's is y-up from the bottom, and an image's first row
is at the top of its unit square, so both flips fold into the matrix:
`[a, −b, −c, d, c + e, H − d − f]`. Alpha and blend mode are an ExtGState each.
An asset is cut from its full-resolution twin by scaling the screen crop by the
ratio of the two files' widths; one with no twin — a tile layer's slices, a
merged palette — is drawn from the screen copy and named in the result, so the
preview's bar can say so.

`print_pdf::prepare` is the step both writers share: it cuts each sprite
from its best file, tints it, trims it and shrinks it, and hands back the
pixels and the matrix.

Three things keep the file small. Fully transparent margins are trimmed, with
the matrix carried. An image drawn far smaller than its pixels is shrunk to the
project's DPI at the size it is drawn. And the same part of the same file at
the same drawn size is **one** XObject however many times it is placed — a
pattern of five hundred copies is five hundred `Do`s and one picture — because
position is not in the cache key.

The writer is `pdf_writer.rs`: a catalog, a page, a deflated content stream,
RGB images with their alpha as a DeviceGray soft mask, and a cross-reference
table. A crate would be more than a one-page document needs.

## The PSD

`print_psd.rs` writes the same page as a layered PSD at the project's DPI —
the page as something to keep working on rather than something to print. It is
built from the same `print_pdf::prepare` the PDF is, so the two cannot
disagree about what is on the page: each prepared item is one layer, in the
order the scene drew them, named after the file it came from (`roof`,
`roof 2`…) or `Drawn` for a run rendered in the game.

**Each layer is resampled; the PDF is not.** A PDF places an image with a
matrix and leaves the transform to whoever renders it. A PSD layer is a grid of
pixels aligned to the document's, so a sprite turned thirty degrees is redrawn
turned: every pixel of the layer's box is mapped back through the inverse of
its matrix and sampled bilinearly, in premultiplied alpha so the edge does not
darken. Alpha is the layer's opacity and the blend mode is its blend mode, so
both stay editable in Photoshop.

The flattened image — what a viewer that cannot read layers shows, and what
the preview pane shows, since a webview cannot show a PSD — is composited
here with every layer drawn normally at its opacity. Blend modes are carried on
the layers but not applied to the flattened copy; Photoshop recomposites on
open. The file is stamped with its resolution (`psd_resolution::stamp`), and
`preview_png` writes `print-out/preview.png` at 1600 pixels on the long side,
over white.

Checked with psd-tools as well as the fork: the layers, their boxes, their
opacity and the ResolutionInfo resource all read back, and the flattened copy
of the Chromium page matches the PDF's rendering.


## The PNG and the JPG

`print_png.rs`: the page flattened into one picture at the project's DPI by the
same `print_psd::flatten` the PSD's flattened copy comes from — the PSD builder
was split into `render`, which draws and composites and hands each layer to a
callback, and the writers over it. The PNG is clear where nothing was drawn;
the `image` crate's encoder writes no `pHYs` chunk, so `with_resolution`
splices one in after the header, or every viewer opens a 300 DPI page at four
times the size of the paper. The JPG is the same picture laid on white — a JPG
has no transparency — at quality 92, with its DPI in the JFIF header through
`JpegEncoder::set_pixel_density`.

## Output

A print project has two sections: the header leaves Play out
(`HeaderCallbacks.withoutPlay`) and calls Code **Output** (`codeLabel`). Output
is the code panel and, over the canvas, the `PrintExport` pane
(`editor/print-export.ts`) — the preview, its bar, and a column of thumbnails —
and nothing beside it. The game runs underneath the pane, full size and
covered: a frame that is `display: none` or off screen is one the browser stops
drawing, and a game that never reaches the end of a frame never captures.

**The game starts as Output opens, and otherwise only when asked.** The mode
switch calls `GameFrame.run` on the way in. `GameFrame` implements
`CodeRunner` — `run`, `restart`, `halt`, `isRunning`, `onRunningChange` — and
`CodePanel` puts Stop and Restart (running) or Run (stopped) at the head of the
file bar's right-hand cluster through `CodeBar.addControl`; Run and Restart save
the open file first. `GameFrame.reload` returns false on a print project, so a
code save, a PSD changing and Project Options leave it alone. A change to the
sheet's size or corner restarts a running game 350 ms after the last change.

**Captured pages are drawn, not written.** `print-preview.ts` draws a page's
list onto a canvas from the screen-resolution files the game was using —
each sprite cut from `assets/` and placed with its matrix through
`setTransform`, each raster laid over the page, alpha and blend modes the
canvas's own — for the preview at 1600 pixels and each thumbnail at 180.
Nothing reaches Rust until Save.

**Save does every step.** It is the bar's one button, labelled with the
format and the count — `Save PNG`, `Save 24 PNGs`. With a finished run it
writes each page through `export_print_pdf` / `_psd` / `_png` / `_jpg` into
`exports/`, then hands one file over with `save_print_file` or several as one
zip with `save_print_files`, inside `saveAs`'s `write` so the platform's order
holds. Pressed before anything is captured, or while a run of snapshots is
open, it posts `idlewild-print-request` and saves when the ending page arrives.
A page with no name is `page`, or `page-N` in a run; a repeated name gets `-2`.

**Before a page arrives** the pane shows an indeterminate bar. An error the
game logs through the console bridge while nothing is captured replaces it
with that error; ten seconds without a call replaces it with a note that
`ExportForPrint()` has not fired. Stopping keeps what was captured, ready to
save.

Page Setup on a print project is `editor/print-setup.ts`: the dimension rows,
and the resolution reported rather than offered.

## What it does not do yet

See [Known gaps](known-gaps.md#print-projects).
