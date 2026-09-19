# Idlewild — Technical Documentation

How the app is put together, in one document. The detail is in
[`Docs/`](Docs/), one file per area, and this page is the map to it — read this
first and then only the page you need.

[README.md](README.md) is the other half: what Idlewild *is*, for somebody who
has not used it, with the feature-by-feature manual under [`Manual/`](Manual/).

---

## Hard rules

- **No source file may exceed 700 lines.** Carried over from phaser-bench and
  hush. `npm run check:lines` enforces it over `src/`, `src-tauri/src/` and
  `scripts/`.
- **Document objects are immutable once stored.** Every mutation replaces the
  object rather than writing through it. Hush's drawing engine diffs strokes
  by identity, so an in-place write would make its sync shim miss the change.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Tauri window                            │
│  ┌──────────────────────── header ─────────────────────────┐  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────┐  ┌─────────────────────────────┐  ┌───────────┐  │
│  │ Scenes  │  │ ▣▣  Phaser 4 canvas         │  │ TOOL      │  │
│  │ Layers  │  │   ┌─────────────────────┐   │  ├───────────┤  │
│  │ Minimap │  │   │  drawing stage      │   │  │ LAYER     │  │
│  │         │  │   │  (baked ink, one    │   │  ├───────────┤  │
│  │         │  │   │   CSS transform)    │   │  │ OBJECT    │  │
│  │         │  │   └─────────────────────┘   │  │           │  │
│  └─────────┘  │ ▣▣  grid · fills · zones ·  │  └───────────┘  │
│               │ ▣▣▣▣▣  placements           │                 │
│               └─────────────────────────────┘                 │
│  ┌─────────────────────── console drawer ──────────────────┐  │
└──┴─────────────────────────┬───────────────────────────────┴──┘
                             │ Tauri IPC (invoke) + events
┌────────────────────────────▼──────────────────────────────────┐
│                        Rust backend                            │
│  store.rs        per-project directories on disk               │
│  projects.rs     the command surface over the store of them    │
│  psd_write.rs    image / RGBA → PSD  (psd fork, write half)    │
│  psd_merge.rs    several placed PSDs, written back out as one  │
│  psd_paint.rs    ink → a layer already in a PSD                │
│  psd_palette.rs  the palette, into a PSD leaving for Photoshop │
│  clipboard.rs    the system pasteboard, which WebKit hides     │
│  psd_pipeline.rs PSD → game assets   (psd-to-json-rust)        │
│  templates.rs    the four scaffolds, per-projection grid       │
│  game_files.rs   the editable game/ tree, as the code modal    │
│                  sees it                                       │
│  scene_names.rs  what a scene's file is called                 │
│  game_search.rs  ⇧⌘F, over that same tree                      │
│  publish.rs      what a published site is made of, and the zip │
│  deploy.rs       that site, staged and pushed somewhere real   │
│  deploy_ssh.rs     the site over SFTP, on our own connection   │
│  deploy_github.rs  clone the branch, replace the path, commit  │
│  publish_targets.rs  the logins, which are the device's        │
│  github_api.rs   the two questions git cannot answer           │
│  compare.rs      the far end beside the staged site            │
│  site_files.rs   that site, as a list of files with hashes     │
│  export_assets.rs  chosen PSDs alone: sources, output, or both │
│  archive.rs      a whole project, as one .idlewild file        │
│  import_assets.rs  the same door inward, several files at once │
│  save_staging.rs where a file is built before iOS's picker     │
│  game_config.rs  the document, as the exported game reads it   │
│  file_server.rs  tiny_http over the project store              │
└───────────────────────────────────────────────────────────────┘
```

### Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | iPad and macOS from one codebase, as in phaser-bench and hush |
| Frontend | TypeScript, no framework | Same vanilla module style as both sources; typecheck is the main local check |
| Engine | Phaser 4 + WebGL | psd-to-phaser `main` requires it — layer masks are built on Phaser 4's Filter system |
| Editor | CodeMirror 6 | Ported from phaser-bench |
| PSD read/write | `psd` (fork) | Read for parsing, write for turning images and sketches into PSDs |
| PSD → assets | `psd-to-json` (Rust) | In-process, no system binaries — the iPad constraint |
| Runtime | `psd-to-phaser` | The plugin everything is built around |

---

## The shape of it

Three things carry most of the weight, and almost everything in `Docs/` is a
consequence of one of them.

**Everything that enters becomes a PSD.** A dropped PNG, a pasted screenshot,
a lassoed sketch, a filled run of grid spaces, an extruded solid: all of them
are written out as a Photoshop document by the `psd` fork and then parsed by
psd-to-json, so psd-to-phaser sees one kind of input and the editor has one
pipeline rather than six. It is the most consequential decision in the
project and the reason the Rust half is as large as it is. See
[`Docs/psd-pipeline.md`](Docs/psd-pipeline.md).

**The document is the truth, and it is immutable.** `GameDoc` — scenes,
layers, fills, placements, zones, strokes, extrusions — is what is saved, what
undo walks, what the minimap draws, what an export carries and what the
exported game reads through a generated config. Every mutation replaces the
object it touches rather than writing through it. See
[`Docs/data-model.md`](Docs/data-model.md).

**The iPad is a target, not a port.** No subprocess, so git and ssh are
linked as libraries rather than run as programs. No pointer, so every hover
affordance has a tap. No writable path outside the sandbox, so a save dialog
is an export picker wearing a costume. Where a decision here looks strange on
a Mac, that is usually why. See [`Docs/ipad.md`](Docs/ipad.md),
[`Docs/publishing.md`](Docs/publishing.md) and
[Leaving with a file, and the order iOS needs](Docs/exports.md#leaving-with-a-file-and-the-order-ios-needs).

### Where the seams are

| Seam | What crosses it | Where |
|---|---|---|
| Tauri IPC | `invoke` commands and events; bytes as base64 | [`Docs/shell-and-runtime.md`](Docs/shell-and-runtime.md) |
| The asset server | psd-to-phaser reading the project store over HTTP on `127.0.0.1`, because it concatenates onto a base path and lazy-loads | [`Docs/shell-and-runtime.md`](Docs/shell-and-runtime.md) |
| The game frame | Play and a published export load the project's own `game/` tree; the editor's Phaser never runs the user's code | [`Docs/exported-game.md`](Docs/exported-game.md) |
| The drawing stage | Hush's stroke engine on its own canvas, over Phaser's, moved by one CSS transform | [`Docs/drawing.md`](Docs/drawing.md) |
| The save dialog | A path on macOS, an export of a file that already exists on iOS | [`Docs/exports.md`](Docs/exports.md) |

---

## The map

| Page | What is in it |
|---|---|
| [The shell and the runtime](Docs/shell-and-runtime.md) | Where Phaser runs and why there are two answers; one game at a time; the local HTTP server; the IPC surface |
| [The data model](Docs/data-model.md) | `GameDoc` and the store on disk; the four scaffolds; undo; one file per scene |
| [The canvas, the camera and the gestures](Docs/canvas-and-camera.md) | The one-screen-pixel rule, the minimap, where a project opens, the three sections, the two columns of tools |
| [Gesture routing](Docs/gestures.md) | One surface, several things that want a touch, and who gets it |
| [The PSD pipeline](Docs/psd-pipeline.md) | Write half, psd-to-json, the round trip out to Photoshop and home |
| [A PSD's own layers](Docs/psd-layers.md) | The stack inside a file: the inspector's list, visibility, reordering, the empty layer, PSD Edit mode |
| [Three kinds of layer](Docs/layers.md) | Object, pattern and background |
| [Tile layers](Docs/tile-layers.md) | The fourth kind, and the one whose data is Tiled's rather than ours |
| [The drawing layer](Docs/drawing.md) | The surface, the brushes, the tools, and how a colour carries its opacity |
| [The colour picker](Docs/colour.md) | One control everywhere, the eyedropper, the palette, the browsed ones, and the strip a PSD carries out |
| [Selection](Docs/selection.md) | Grid runs, bare rectangles, placed PSDs, several at once, lassoed ink |
| [The pattern and shape libraries](Docs/pattern-and-shape-libraries.md) | Two app-owned libraries and the two editors that fill them |
| [Extrude mode](Docs/extrude.md) | Pulling a solid out of the grid and writing it back as a PSD |
| [Colliders](Docs/colliders.md) | The spaces a placed PSD blocks, guessed and then edited |
| [The inspector](Docs/inspector.md) | Three zones, folding sections, explanations on headings |
| [Exports, imports and the home screen](Docs/exports.md) | The three exits, the two doors in, the iOS save order, Select |
| [Publishing somewhere real](Docs/publishing.md) | SSH and GitHub as libraries; the login is the device's, the destination the project's |
| [The exported game](Docs/exported-game.md) | What a site is made of, what Play runs, the config, the page, the owned lines |
| [The code panel](Docs/code-panel.md) | CodeMirror over the real tree, the three places it sits, the reference, the console |
| [The iPad](Docs/ipad.md) | The safe area, and the scene manifest the app will not launch without |
| [Testing](Docs/testing.md) | What is covered and where |
| [Known gaps](Docs/known-gaps.md) | What is not done, and what is a trade rather than a bug |

### Every section, and where it lives

These pages refer to each other by section name — *see the PSD pipeline*,
*see Three kinds of layer*. This is that lookup.

| Section | Page |
|---|---|
| A colour carries its own opacity | [`Docs/drawing.md`](Docs/drawing.md) |
| Attach palette to PSDs | [`Docs/colour.md`](Docs/colour.md) |
| Adding a layer, and the empty one | [`Docs/psd-layers.md`](Docs/psd-layers.md) |
| Browse Palettes | [`Docs/colour.md`](Docs/colour.md) |
| Colliders | [`Docs/colliders.md`](Docs/colliders.md) |
| Console | [`Docs/code-panel.md`](Docs/code-panel.md) |
| Data model | [`Docs/data-model.md`](Docs/data-model.md) |
| Drawing layer | [`Docs/drawing.md`](Docs/drawing.md) |
| Editing a PSD's layer stack without leaving | [`Docs/psd-layers.md`](Docs/psd-layers.md) |
| Editing a PSD, and getting it back | [`Docs/psd-pipeline.md`](Docs/psd-pipeline.md) |
| Extrude mode | [`Docs/extrude.md`](Docs/extrude.md) |
| Eyedropper | [`Docs/colour.md`](Docs/colour.md) |
| It reads a patch, not a pixel | [`Docs/colour.md`](Docs/colour.md) |
| Gesture routing | [`Docs/gestures.md`](Docs/gestures.md) |
| Import Assets, which is that door inward | [`Docs/exports.md`](Docs/exports.md) |
| IPC surface | [`Docs/shell-and-runtime.md`](Docs/shell-and-runtime.md) |
| Known gaps | [`Docs/known-gaps.md`](Docs/known-gaps.md) |
| Layer visibility | [`Docs/psd-layers.md`](Docs/psd-layers.md) |
| Leaving with a file, and the order iOS needs | [`Docs/exports.md`](Docs/exports.md) |
| Lines the editor owns | [`Docs/exported-game.md`](Docs/exported-game.md) |
| One file per scene, named after it | [`Docs/data-model.md`](Docs/data-model.md) |
| Four scaffolds, one document | [`Docs/data-model.md`](Docs/data-model.md) |
| One picker, five places | [`Docs/colour.md`](Docs/colour.md) |
| One game at a time, and why that is load-bearing | [`Docs/shell-and-runtime.md`](Docs/shell-and-runtime.md) |
| One screen pixel, whatever the camera is doing | [`Docs/canvas-and-camera.md`](Docs/canvas-and-camera.md) |
| PSD Edit mode | [`Docs/psd-layers.md`](Docs/psd-layers.md) |
| Publish, and what the exported game reads | [`Docs/exported-game.md`](Docs/exported-game.md) |
| Publishing somewhere real, and logging in once | [`Docs/publishing.md`](Docs/publishing.md) |
| Reordering layers | [`Docs/psd-layers.md`](Docs/psd-layers.md) |
| Select, on the home screen | [`Docs/exports.md`](Docs/exports.md) |
| Selection | [`Docs/selection.md`](Docs/selection.md) |
| Testing | [`Docs/testing.md`](Docs/testing.md) |
| The config the game reads | [`Docs/exported-game.md`](Docs/exported-game.md) |
| The inspector's sections fold | [`Docs/inspector.md`](Docs/inspector.md) |
| The iPad needs a scene | [`Docs/ipad.md`](Docs/ipad.md) |
| The iPad's safe area | [`Docs/ipad.md`](Docs/ipad.md) |
| The minimap | [`Docs/canvas-and-camera.md`](Docs/canvas-and-camera.md) |
| The origin, and the screen the game opens at | [`Docs/canvas-and-camera.md`](Docs/canvas-and-camera.md) |
| The page around the game | [`Docs/exported-game.md`](Docs/exported-game.md) |
| The palette, and the two rows of swatches | [`Docs/colour.md`](Docs/colour.md) |
| The pattern and shape libraries | [`Docs/pattern-and-shape-libraries.md`](Docs/pattern-and-shape-libraries.md) |
| The PSD pipeline | [`Docs/psd-pipeline.md`](Docs/psd-pipeline.md) |
| The reference along the bottom of the code modal | [`Docs/code-panel.md`](Docs/code-panel.md) |
| The tools, on two columns | [`Docs/canvas-and-camera.md`](Docs/canvas-and-camera.md) |
| Three exits | [`Docs/exports.md`](Docs/exports.md) |
| Three kinds of layer | [`Docs/layers.md`](Docs/layers.md) |
| Tile layers | [`Docs/tile-layers.md`](Docs/tile-layers.md) |
| The rule the rest of it hangs from | [`Docs/tile-layers.md`](Docs/tile-layers.md) |
| Infinite, because this canvas has no edge | [`Docs/tile-layers.md`](Docs/tile-layers.md) |
| A PSD on a tile layer is a palette | [`Docs/tile-layers.md`](Docs/tile-layers.md) |
| The tools are the drawing tools, re-pointed | [`Docs/tile-layers.md`](Docs/tile-layers.md) |
| Import Tiled | [`Docs/tile-layers.md`](Docs/tile-layers.md) |
| Three sections, not two modes | [`Docs/canvas-and-camera.md`](Docs/canvas-and-camera.md) |
| Three zones, not one heading | [`Docs/inspector.md`](Docs/inspector.md) |
| Undo | [`Docs/data-model.md`](Docs/data-model.md) |
| What Play runs | [`Docs/exported-game.md`](Docs/exported-game.md) |
| Where the code panel sits | [`Docs/code-panel.md`](Docs/code-panel.md) |
| Where the panel's explanations went | [`Docs/inspector.md`](Docs/inspector.md) |
| Why the editor runs Phaser in-window, and the game does not | [`Docs/shell-and-runtime.md`](Docs/shell-and-runtime.md) |
| Why there is still an HTTP server | [`Docs/shell-and-runtime.md`](Docs/shell-and-runtime.md) |
