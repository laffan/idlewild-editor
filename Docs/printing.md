# Print projects

A project can be for a page as well as for a game. This is how one is put
together: two resolutions and which part of the app sees which, the sheet as a
rectangle of world, `ExportForPrint()`, and the PDF and PSD written from what
it reads.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Output, and what it fixes

`ProjectMeta.output` — `Output` in `src-tauri/src/print.rs`, mirrored in
`src/lib/print.ts` — is the last question on the New Project sheet:

| field | what it is |
| --- | --- |
| `kind` | `code` (a game, which every project made before this is) or `print` |
| `dpi` | 300 or 600, read as the nearer of the two |
| `paper` | `letter`, `legal`, `tabloid`, `a5`, `a4`, `a3`, `a2` — portrait, in points |
| `landscape` | turns the sheet |
| `formats` | what a page is written as when the call does not say: `pdf`, `psd` or `both` |

Flat and every field defaulting, the way `PublishTarget` is, so a `meta.json`
written before it existed reads as a code project. It travels in a
`.idlewild` manifest beside `options` and `presentation`: the PSDs in the
archive were written at that DPI, and a print project opened as a game would
place every one of them at the wrong size.

**The kind and the DPI are fixed at creation; the paper and the formats are
not.** Every PSD
the project writes is written at its DPI, and a file made at 300 has no 600's
worth of pixels to give. The paper decides where the page falls and how big
the PDF is, and changes nothing that was drawn, so Page Setup has it
(`set_project_paper` → `store::set_paper`, which refuses on a code project).
`formats` rides on the same command as an optional field: the preview's bar
is what changes it, and a second command for one more field of the same record
would be two writers for one row.

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

The page's top-left corner is the world's origin. `game_config::presentation_of`
turns a print project's page into a fixed box the size of the sheet, so the
existing `main.js` layout — Phaser `FIT` against a fixed width and height —
frames it with no second layout written. `config.print` carries the sheet in
points and the DPI, and `shared/canvas.js`'s `applyCamera` holds the camera at
zoom 1 and scroll 0 when it is there.

On the canvas, `screen-guide.ts`'s `pageBox` draws the sheet: hung from the
origin rather than centred on it, scaled by the camera alone, and solid rather
than dashed, because it is the page edge for edge rather than *about this much
world*.

## ExportForPrint()

`templates/print/js/shared/print.js`, written into every print project and
installed by `main.js` on the game it starts. The print variant of `main.js` is
three anchored replacements of the common one (`templates::print_main`) rather
than a second copy, and a test pins each anchor.

```js
ExportForPrint({ name, folder, formats, stop })   // → Promise<{ files }>
```

Every option is optional: `name` and `folder` say where the files go inside
`exports/`, `formats` is `"pdf"`, `"psd"`, `"both"` or an array, and `stop`
(default true) pauses every scene once the page is read. The promise settles
once the editor has written the files, with their paths — so a sequence of
pages, one per frame of an animation, is a loop with an `await` in it.

**The page is read at the end of the next frame drawn** — on Phaser's
`POST_RENDER` — so whatever the calling code just changed has been through a
render, and a call made straight out of `create()` finds the document placed.

**`stop` pauses the scenes, not the game.** The first version stopped the
game's loop, which stops the drawing as well as the updating; called before the
first frame — which is what the scaffold's commented `whenPsdsReady` line does
— it left the game's canvas blank for good. A paused scene does not update, so
tweens, timers, physics and animations hold still, but it is still drawn. A
later call reads paused scenes as well as running ones.

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
  if smaller) and read back with the texture's own `snapshot`, which leaves the
  renderer's state its own; the first version read the framebuffer through the
  WebGL context directly. Text is re-rendered at that resolution for the
  capture and put back after.

**The file path comes from the loader, not the texture.** Phaser fetches an
image as a blob and hands the texture an object URL that is revoked once it
has decoded, so the only place a texture's real address is written down is the
loader's record of the request. `print.js` listens at
`LoaderPlugin.fileProcessComplete`, the one method every file passes through as
it finishes, and keeps a map of texture key to URL.

Inside the editor the page is posted to the parent with an id, the `out` path
and the formats, and the editor answers `idlewild-print-done` with the same id
once the files are written. Anywhere else there is no parent and the promise
settles at once with nothing written. **Export now** posts a request into the
frame that calls the same function.

Checked against Phaser 4.2.1 in Chromium: a scene with Graphics, text, a scaled
image, a rotated and flipped half-transparent image and a flipped image in a
rotated Container, redrawn from the posted page, matches the game; a call from
`create()` leaves the game on screen; and a second call after a stopping one
reads the same five items.

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

## Code, Run and the preview

A print project has two sections. The header leaves Play out
(`HeaderCallbacks.withoutPlay`), and Code is where pages are made: the panel
as usual, and over the canvas `GameFrame` lays out the game on the left and a
`PrintExport` pane (`editor/print-export.ts`) on the right, its bar across the
pane's own top.

**The game runs when Run is pressed, and not otherwise.** A page can be
seconds of work at full resolution, or a loop writing a hundred files, so a
save that set it off again would be a save nobody could afford. `GameFrame`
implements `CodeRunner` — `run`, `halt`, `isRunning`, `onRunningChange` —
and `CodePanel` puts a Run button at the head of the file bar's right-hand
cluster through `CodeBar.addControl`; Run saves the open file, flushes the
document and starts the game, and the button is Stop while it is up.
`GameFrame.reload` returns false on a print project, so the code save, a PSD
changing, Project Options and Page Setup all leave it alone, and the mode
switch shows the frame on the way into Code without starting it.

Pages are written one at a time in the order they arrive, in the formats the
page asked for or the bar's, and each is answered when its files are on disk.
The bar carries the format switch — which, changed after a page, writes the
other format from the page the game is holding — **Export now**, a Save for
each of the last page's files and **Save all** once a run has written more
than one page. Stop, or a fresh Run, drops whatever was still queued.

Page Setup on a print project is `editor/print-setup.ts`: the paper, the
orientation, and the resolution reported rather than offered.

## What it does not do yet

See [Known gaps](known-gaps.md#print-projects).
