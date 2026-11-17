# Idlewild docs site: planning

A plan for the GitHub Pages documentation. It decides what the site spends its
effort on, not what it looks like. The design of the site and the Pages setup
come after this is agreed.

The guiding rule: **Idlewild does a lot of things every game engine does, and
those get a line each. The pages go to the things it does that other engines
don't.**

---

## 1. Pitch

> Idlewild is a game and page editor for iPad and macOS. You draw on an
> infinite grid with an Apple Pencil, bring in artwork from anywhere, and every
> picture becomes a Photoshop file that can go out to Photoshop and come home
> again. The project's code is plain Phaser and psd-to-phaser that you own and
> edit in the app, and the same canvas can end up as a published web game or a
> print-ready PDF.

Shorter, for the top of the home page:

> Draw a game on an iPad. Every picture is a PSD, the code is yours, and it
> ships to the web or to paper.

---

## 2. What already exists

The site does not start from nothing. The repository already has:

| Source | What it is | Use on the site |
|---|---|---|
| `README.md` | Install and build | Install page, close to as is |
| `README_DETAIL.md` | What Idlewild is, the three core ideas, getting started | Raw material for the home page and the "What's different" tour |
| `Manual/` (18 pages) | User documentation, one page per area | The bulk of the user-facing reference, restructured (see §5) |
| `README-TECHNICAL.md` + `Docs/` (24 pages) | Architecture and the reasoning behind each part | An "Internals" section, linked rather than rewritten |
| `Manual/roadmap.md`, `Docs/known-gaps.md` | What is missing and why | A public roadmap page |
| `laffan/test-idlewild` (private) | A real exported site, "Exported from Idlewild" | Proof that exports run; a candidate for embedded demos |

The Manual is written as a changelog-flavored list of bullets ("it used to…,
now it…"). That suits a repo but not a docs site: most of the writing work is
turning those bullets into task-led pages, and dropping the history.

---

## 3. Baseline: what a game engine is expected to do

To decide what is unusual, the comparison set is the engines a reader is most
likely to know: Godot, Unity (2D), GameMaker, Construct, GDevelop, Defold, and
the two Phaser-adjacent tools, Phaser Editor and Tiled. Between them the
expected kit is:

- A scene editor with layers, sprite placement, snapping, undo
- Asset import (PNG, sprite sheets; Unity and Godot plugins also read PSDs)
- Tilemaps, often Tiled-compatible
- Collision, a camera, templates for top-down and platformer games
- A code or script editor with find, a console, play-in-editor
- Web export as a folder or zip

Two comparisons matter more than the rest, because a reader will make them:

- **Phaser Editor** also turns a visual scene into Phaser code. Its scene file
  is the source; the compiler regenerates the code on save and your own code
  lives inside `START-USER-CODE` / `END-USER-CODE` regions
  ([Phaser Editor docs](https://docs.phaser.io/phaser-editor/scene-editor/scene-compiler)).
  Idlewild runs the other way round (see §4.2), and the docs need to say so
  plainly, because "visual editor that writes Phaser code" sounds identical.
- **Xogot** puts the Godot editor on an iPad
  ([Godot showcase](https://godotengine.org/showcase/xogot/)), and hyperPad is
  a no-code iPad engine. "Runs on an iPad" alone is therefore not the claim.
  The claim is that the iPad and the Pencil shaped the tool (see §4.4).

---

## 4. The distinctive features, ranked

Ranked by how far each one sets Idlewild apart from the baseline above, which
is also roughly the order a reader should meet them in. Each entry says what it
is, why it is unusual, and what its page needs.

### 4.1 Everything becomes a PSD, and the PSD goes both ways

**What it is.** Every picture that enters a project (a dropped PNG, a paste, a
lassoed sketch, a filled run of grid spaces, an extruded solid, typed text) is
written out as a Photoshop document and parsed by psd-to-json. A PSD's layer
names (`S |`, `T |`, `G |`, `P |`, `Z |`, animations, atlases) decide what each
layer becomes in the game. Open PSD hands the file to Photoshop or the iPad
share sheet; Re-parse brings it back. Each file carries a red `P | anchor` dot
and the grid outline it was dropped into, so moving the dot in Photoshop
re-anchors the artwork on the grid. Open PSD can also write the surrounding
canvas (`context`), the scene's plan (`plan`) and your palette into the file as
layers, so the artist sees what they are drawing against. Merge writes several
placed PSDs into one file, with layers renamed by origin. ⌘C copies the PSD
itself, so it pastes into another project or into Photoshop as a document.

**Why it is unusual.** Engines that read PSDs treat them as a one-way import:
Unity's PSD Importer regenerates sprites on reimport and clears edits made in
Unity. Here the PSD is the only asset format and the round trip is the main
workflow, with marks inside the file to keep its place on the grid.

**What the page needs.**
- A diagram of the pipeline: source → PSD (with marks) → psd-to-json →
  `assets/` → psd-to-phaser, and the loop back through Photoshop
- A short screen recording of one round trip: drop a sketch, Open PSD, paint
  in Photoshop, Re-parse, artwork updates in place
- Screenshots of a file in Photoshop showing the anchor, grid, `context` and
  `plan` layers, turned on and off
- The layer naming table (already in `Manual/psd-layer-naming.md`) as its own
  reference page
- A "bringing in a file drawn elsewhere" walkthrough: what to name layers, and
  what happens to a file with no anchor

### 4.2 The code is the source, and the canvas writes into it

**What it is.** A project is a real `game/` tree, edited in the app (CodeMirror
6), and Play runs that tree exactly as a published site does. On the **PSD to
Phaser** scaffold, placing something in Draw writes ordinary
`this.P2P.place(...)`, `setPosition`, `setScale`, `setDepth` lines into the
scene's `create`. That block follows Draw (move, resize, restack, hide,
delete) **until you edit any line of it**, at which point it is yours and Draw
stops touching it. A broken-link mark in Draw and a reset arrow in Code show
where your edited code and the canvas now disagree. Rows dragged out of Code's
sidebar write placement code at the caret. With the caret inside a
`setPosition(...)` or `setScale(...)` call, dragging the sprite in the running
game edits the numbers. Renaming a PSD or a layer rewrites every reference to
it in the project's JavaScript. On the Game scaffolds, the editor's lines are
locked line by line, with a Reset per block, and nothing is written into your
tree unasked.

**Why it is unusual.** The usual split is a scene file the editor owns and code
that hangs off it, or (Phaser Editor) code regenerated from the scene with your
code fenced into protected regions. Idlewild has no scene file the game reads;
the exported code is plain psd-to-phaser a person could have written, and the
editor hands each block over to you the moment you touch it.

**What the page needs.**
- A side-by-side: Draw on the left, the scene file on the right, a placement
  appearing as code, then a hand edit breaking the link (screen recording)
- Short GIFs of dragging a sidebar row into the code, and of dragging a sprite
  by its `setPosition` caret
- Code samples of what each scaffold writes (the trees in
  `Manual/code-and-play.md`)
- A plain comparison paragraph against Phaser Editor's compiler, so a Phaser
  user understands the difference in one read
- A note on `game.config.json`: generated, read-only, what is in it

### 4.3 A game engine that prints

**What it is.** A project can be **Print** instead of Web: a fixed DPI (150,
300, 600), one or more artboards with rulers and guides, and the same canvas,
tools and code. `ExportForPrint()` in a scene captures the page as the code
left it; every sprite drawn from a PSD is saved from the **full-resolution**
file while the canvas and your code work on a downsampled copy. Output is a
PDF, a layered PSD (one layer per sprite, with opacity and blend modes), a PNG
or a JPG. `snapshot: true` turns a loop into a run of pages, so every frame of
an animation can be printed.

**Why it is unusual.** No game engine in the baseline treats print as an output
at all. The nearest neighbors are creative-coding tools (Processing, p5.js)
saving frames, which do not keep a layered, full-resolution source per sprite.

**What the page needs.**
- A worked example from new project to saved PDF, with the code
- The `ExportForPrint()` options as a reference table (already written in
  `Manual/printing.md`)
- A snapshot example: a short loop producing a contact sheet or a flip book,
  shown as the output thumbnails
- An explanation of the two resolutions, with numbers (a letter page at
  600 DPI is 5100 × 6600)
- The "not yet" list (RGB only, no bleed or crop marks) kept on the page,
  because a print user needs it before they start

### 4.4 Built for the iPad and the Pencil, with a real drawing engine inside

**What it is.** The drawing layer is Hush's stroke engine: pressure and tilt,
five brushes, smoothing, Pattern and Shape brushes, an eraser version of every
brush, Slice (a knife that cuts strokes), hold the Pencil still to lasso,
double-tap the barrel to erase. Fingers never draw; they pan and pinch, so a
hand can rest on the glass. The iPad is treated as a target rather than a port:
no subprocesses, so git and SSH are linked as libraries; no pointer, so every
hover has a tap; every ⌘ shortcut has a menu item.

**Why it is unusual.** Engine editors that run on an iPad (Xogot, hyperPad)
bring an editor to the device. Few put a pressure-sensitive drawing engine
inside the editor, so a game's art can be drawn in place on the grid it will
stand on.

**What the page needs.**
- Video rather than GIFs: the Pencil gestures are about timing (hold to lasso,
  hold to straighten in PSD Edit mode, barrel double-tap)
- A gesture reference card: Pencil, finger, keyboard, per tool
- A cross-link to the Hush docs for the stroke engine itself, so the two sites
  do not document it twice

### 4.5 Extrude mode: greybox solids pulled from the grid

**What it is.** Select grid spaces and pull them up into a shaded isometric
block (or a flat fill on orthogonal), then grab any face and pull it again in
that face's own plane, push back to carve, see through to backfaces, rub cubes
out. Apply writes it as a PSD with separate silhouette, shading and line
layers, and the solid stays in the document, so clicking the cube on its layer
reopens it and re-applying rewrites the file without losing paint layered on
top. The collider is derived from the same 3D shape, so a character can walk
under an arch and round its piers.

**Why it is unusual.** Greyboxing in 2D engines usually means placing
rectangles. Here a 3D block-out becomes layered 2D artwork that stays
re-editable, with collision that follows it.

**What the page needs.**
- GIFs of a build: pull a wall, pull a face sideways, carve, apply
- A screenshot of the resulting PSD's three layers in Photoshop
- A short explanation of how the collider and the isometric depth sort follow
  the solid (sorting on the collider's near corner)

### 4.6 Publishing from the device

**What it is.** Publish sends the site to a GitHub branch (default `gh-pages`)
or a server over SFTP, from the iPad as well as the Mac. The GitHub side
clones the branch, replaces only the target path, commits and pushes; it never
force-pushes. The server side keeps a hash manifest beside the site and sends
only what changed. A two-pane sheet shows what is there against what you have,
with each file marked new, changed or identical; removals are offered, never
assumed. Host keys are pinned on first connection.

**Why it is unusual.** Most engines stop at "export a folder". Built-in deploy,
with a reviewable diff and no subprocesses so it works on iOS, is rare.

**What the page needs.**
- A walkthrough to a live `gh-pages` site, with screenshots of the two panes
- A plain safety section: what is touched, what is never touched, what a
  host-key change means
- Ideally, demo games on this docs site published by Idlewild itself (see open
  questions)

### 4.7 Choose how much code is written for you, and change your mind later

**What it is.** Four scaffolds, from most to least: **Game** (Top Down with A\*,
or Platformer), **PSD to Phaser**, **Phaser**, **Vanilla** (an HTML page, a
stylesheet, a script and the document as JSON). Drawing is identical on all of
them; the choice only decides the program on the other side of an export.
Project Options can switch scaffolds later, copying every file it replaces
into `Backups/<date>-<from>/` first. Characters move in grid spaces rather than
pixels, so a game plays the same on an 8 px grid as on a 64 px one.

**Why it is unusual.** Templates are standard, but they are normally a one-time
starting point. A switchable scaffold that backs up your files, and a
"no engine code at all" option, are not.

**What the page needs.**
- A table of the four scaffolds: files written, what Play shows, what a publish
  carries
- The file trees as code blocks
- One paragraph on Backups and what a switch overwrites

### 4.8 Pattern layers: an infinite, seeded scatter

**What it is.** A layer that holds a rule rather than objects: drop a PSD on it
and its elements scatter (random or grid) across the infinite canvas, seeded by
tile coordinates so panning never re-rolls it and the exported game regenerates
exactly what you drew. Pattern Masks confine it to swept or freehand areas.

**Why it is unusual.** Engines have tilemap autotiling and particle systems;
a deterministic, infinite, artwork-driven scatter layer that the editor and
the game compute identically is uncommon.

**What the page needs.**
- A GIF of dropping a PSD of trees on a pattern layer and panning
- The density, boundary and Shuffle settings, with before/after images
- A mask-drawing GIF

### 4.9 Plan mode: tracing paper over the scene

**What it is.** A blue sketch layer belonging to the scene but to no layer:
never exported, never printed, never taking a tap outside plan mode. Dropped
reference pictures stay pictures, tinted blue and multiplied. Open PSD's
Include plan writes it into the file for tracing in Photoshop.

**Why it is unusual.** Reference-image layers exist in some editors, but a
dedicated planning surface that travels into the artwork files is particular
to this workflow.

**What the page needs.** One GIF and a short page; this can sit in the
drawing section rather than standing alone.

### 4.10 Smaller distinctive tools

Each of these is a section on an existing page rather than a page of its own:

- **Grid Alignment** (isometric): lay a flat PSD, or text, along the grid's
  axes, flat on the floor or upright like a sign, without changing the file
- **Pixel art upscale and Downsample**: non-destructive nearest-neighbor
  scaling, and a one-way fix for pixel art drawn too big
- **Text as PSD**: typed text (with a little Markdown, local and project fonts)
  becomes pixels in a file named after the words, so a font never has to ship
- **Pattern and shape libraries**: app-wide, with their own pixel pattern
  editor and vector shape editor, from simple-tileset-generator
- **The offline reference** in the code panel: Phaser, MDN and psd-to-phaser
  docs on the device, following the caret
- **Console LOG links**: each `console.log` links to the line that wrote it,
  skipping Phaser's own frames

---

## 5. Standard features: a line each

These matter, but they are what a reader already expects. They get one line on
an overview page and a link to the existing Manual section, not a page of
their own.

- Scenes, one JavaScript file per scene, renamed together
- Object, background and tile layers; reorder, lock, hide
- Infinite grid (isometric, orthogonal, blank), 8–256 px spaces, zoom, minimap
- Snap to grid, arrow-key nudge, multi-select, groups, instances, Make Unique
- Colliders with an edit mode
- Tile layers stored in Tiled's format, Import Tiled (`.tmx`, `.tmj`)
- Fill, color picker with opacity, eyedropper, palettes
- Code editor: file tree, find in file and in project, Prettier on save, hints
- Console with object inspection
- Play-in-editor, live restart on save
- Export: site zip, `.idlewild` project archive, assets only; Import Assets
- Page Setup for the HTML around the game
- Undo and redo across canvas modes

---

## 6. Proposed site structure

```text
Home                      pitch, one hero video, the three core ideas, install
Get started
  Install                 from README.md
  Your first project      new project → draw → Play → publish, in ten steps
What's different          a one-page tour of §4.1–4.7, each linking onward
Core ideas
  Everything is a PSD     §4.1
  Code and canvas         §4.2
  Print projects          §4.3
Working in Idlewild
  Drawing and the Pencil  §4.4, plan mode §4.9, text, brushes
  Building the world      canvas, layers, tile layers, pattern layers §4.8
  Extrude and colliders   §4.5
  Scaffolds               §4.7
  Publishing              §4.6
  Exporting and importing
Reference
  PSD layer naming
  ExportForPrint()
  Scaffold file layouts
  game.config.json
  Gestures and shortcuts
  Standard features       §5, one line each with links
Roadmap                   Manual/roadmap.md
Internals                 README-TECHNICAL.md and Docs/, linked
```

About 20 pages, most of them built from Manual pages that exist. New writing
is concentrated in Home, What's different, Your first project, the three core
idea pages and the gestures reference.

### Media to make

- One hero video (60–90 s) for the home page
- Screen recordings of: a PSD round trip, Draw writing code, extrude, a print
  export, Pencil gestures
- Photoshop screenshots of an Idlewild PSD's layers
- One pipeline diagram (can be SVG, made from §4.1)
- Embedded playable demos if the publishing question below is answered yes

The iPad recordings have to be made on the device, so they are the critical
path for the site rather than the writing.

---

## 7. Open questions for Nate

1. **Which repository and URL.** The engine is `laffan/idlewild-editor`, which
   would make the site `laffan.github.io/idlewild-editor`. Keep that, rename
   the repo, or use a custom domain? Pages is not enabled yet and there is no
   `gh-pages` branch.
2. **Which platforms the site claims.** `README.md` and the release workflow
   build macOS, Windows and Linux installers; `README_DETAIL.md` and the
   Technical README say iPad and macOS. Is Windows and Linux supported, or only
   built? And how does someone get the iPad build?
3. **One source or two.** Should the site be generated from `Manual/` (one set
   of files, the Manual rewritten in place into task-led pages), or should the
   site have its own pages and the Manual stay as the in-repo reference?
4. **Audience.** Artists who have never used an engine, Phaser developers, or
   both? It changes whether §4.1 or §4.2 leads the "What's different" tour.
5. **Live demos.** Idlewild publishes to `gh-pages` by replacing one path. Do
   you want small demo games published by Idlewild into a `demos/` path of the
   docs site's own branch, and is `test-idlewild` or another project a good
   first one?
6. **psd-to-phaser and psd-to-json.** Document their layer rules on this site,
   or link out to their own repositories as the authority?
7. **Hush overlap.** The drawing engine is Hush's. Should drawing pages here
   cover only how it behaves inside Idlewild and link to the Hush site for the
   engine, or stand alone?
8. **The roadmap in public.** Publish `Manual/roadmap.md` as is, including
   trades and known gaps, or keep it in the repo only?
9. **License.** The repository has no LICENSE file. The site will be asked;
   what should it say?
