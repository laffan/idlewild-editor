# Idlewild

A game editor and publisher for **iPad and macOS**, built around
[psd-to-phaser](https://github.com/laffan/psd-to-phaser). Start from a prefab
template, then build by drawing directly in the editor and importing images.

Tauri 2 (Rust) + Phaser 4 + TypeScript, no frontend framework.

---

## What it is

Idlewild is a prototyping environment. You pick a template — isometric,
orthogonal or blank — and a style — top down or platformer — and get a light
blue, effectively infinite grid you build on with your fingers: hold to select
a run of spaces, fill them, drop images into them, export a patch as a
transparent PNG. On a blank canvas nothing snaps and a selection is exactly
the rectangle you dragged.

Three ideas carry most of it.

**Everything you bring in becomes a PSD.** A dropped PNG, a pasted screenshot,
a sketch you lassoed, a filled run of grid spaces — all of them are written out
as a Photoshop document and run through
[psd-to-json](https://github.com/laffan/psd-to-json-rust), so a hand-built
Photoshop file and a screenshot arrive at the runtime the same way. The
practical upshot is that anything on the canvas can be opened in Photoshop and
brought home again.

**The project's code is real, and Play runs it.** A new project scaffolds a
game the way you would lay one out yourself — a `game/` tree of JavaScript you
edit in the app, with one file per scene. Play loads that tree. A `console.log`
you save into it appears in the console drawer, and what the editor shows is
what an export runs.

**Publishing and exporting are two different verbs.** Publish sends the site
somewhere — a directory on a server over SSH, or a branch of a GitHub
repository — and you sign in once, on the device, then point each project at
its own destination. Export hands you a file instead: the site as a zip, the
project as a `.idlewild`, or the artwork on its own.

---

## Getting started

```bash
npm install
npm run dev
```

Then, in the app:

1. **New Project** on the home screen. Pick a template and a style; the grid
   scale is 8–256 px, and 8 and 16 are there for pixel art. See
   [Projects](Manual/projects.md).
2. **Press and hold** on the grid to select a patch of it, and take Fill or Add
   Image from the menu that opens. See [The canvas](Manual/canvas.md).
3. **Draw on it** with the tools down the left edge — five brushes, pressure
   and tilt, an Apple Pencil if you have one. See [Drawing](Manual/drawing.md).
4. **Play**, from the header, to run the project's own code over what you have
   made. See [Code, Play and the page around the game](Manual/code-and-play.md).
5. **Export** or **Publish**, from the menu, when it is worth keeping. See
   [Exporting and importing](Manual/exporting.md).

A note on where things are: this is a **one-project-at-a-time** app. Opening a
project takes over the window, and the home screen is where you go back to.

---

## The manual

One page per area, in roughly the order you meet them.
[`Manual/`](Manual/README.md) is the index; these are the pages.

| | |
|---|---|
| [Projects](Manual/projects.md) | The home screen, the New Project sheet, and the choices that cannot be changed later |
| [The canvas](Manual/canvas.md) | The grid, the camera, where the game's screen falls, the minimap, points and boundaries |
| [Getting images in](Manual/images.md) | Add Image, paste, drop, and what happens to a picture on the way in |
| [Placing, moving and grouping](Manual/placing.md) | Colliders, dragging, copying, and treating several files as one |
| [Scenes and layers](Manual/scenes-and-layers.md) | What a scene is, the three kinds of layer, and the layer list |
| [Drawing](Manual/drawing.md) | The brushes, Fill, the Pattern and Shape brushes, erasing, Slice, Text |
| [Patterns and shapes](Manual/patterns-and-shapes.md) | The two libraries, and the two editors that fill them |
| [Fills, generated PSDs and Extrude mode](Manual/fills-and-extrude.md) | Filling grid spaces, pulling a solid out of them, turning either into a file |
| [The properties sidebar](Manual/inspector.md) | Three zones, folding sections, and where the explanations live |
| [A PSD's own layers](Manual/psd-layers.md) | The stack inside a placed file, and PSD Edit mode |
| [Code, Play and the page around the game](Manual/code-and-play.md) | The project's own code, running it, the console, the reference, Page Setup |
| [Publishing](Manual/publishing.md) | SSH and GitHub, the logins, and what a publish sends |
| [Exporting and importing](Manual/exporting.md) | The three exits that hand you a file, and the two doors back in |
| [PSD layer naming](Manual/psd-layer-naming.md) | The pipe convention psd-to-json reads, for files drawn elsewhere |
| [What is not built yet](Manual/roadmap.md) | What is missing, and what is a trade rather than an oversight |

---

## Status

This is the first vertical slice. Everything in the manual runs end to end, and
the remaining pieces are wired to real slots rather than mocked. The list of
what is missing is [What is not built yet](Manual/roadmap.md); the technical
counterpart, which says *why* for each one, is
[Known gaps](Docs/known-gaps.md).

---

## Development

```bash
npm install
npm run dev          # Vite + Tauri
npm run check        # typecheck + the 700-line file rule
cd src-tauri && cargo test --lib
```

Requires [Rust](https://rustup.rs/) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
platform.

### Runtime libraries

`psd-to-phaser` on `main` targets Phaser 4 but publishes no `dist/`, and the
registry copy (0.0.5) is the Phaser 3 line. `scripts/vendor-p2p.mjs` clones a
pinned ref, builds it, and drops the result into `vendor/` and
`src-tauri/vendor/`. Those builds are committed so a fresh clone works
offline; re-run the script to move the pin.

```bash
npm run vendor:p2p
```

## Where this comes from

| Source | What it contributes |
|---|---|
| [phaser-bench](https://github.com/laffan/phaser-bench) | The PSD pipeline, the local asset server, the CodeMirror editor, the console |
| [psd-to-phaser](https://github.com/laffan/psd-to-phaser) | The runtime the editor is built around, and the only non-Phaser dependency exports ship |
| [psd-to-json-rust](https://github.com/laffan/psd-to-json-rust) | PSD → game assets, in-process |
| [psd](https://github.com/laffan/psd) | Reading PSDs, and the write half that turns images and sketches into them |
| [hush](https://github.com/laffan/hush) | The drawing layer: stroke engine, infinite canvas, Apple Pencil |
| [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator) | The pattern and shape libraries, and both of their editors |

The reference in the code modal carries [MDN Web Docs](https://developer.mozilla.org)
content, used under CC BY-SA 2.5, alongside Phaser's and psd-to-phaser's own
documentation.

---

## Building on it

[README-TECHNICAL.md](README-TECHNICAL.md) is the architecture — how the app
is put together, in one page — and [`Docs/`](Docs/) is the detail behind each
part of it.
