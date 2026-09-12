# Idlewild

A game editor and publisher for iPad and macOS, built around
[psd-to-phaser](https://github.com/laffan/psd-to-phaser). Start from a prefab
template, then build by drawing directly in the editor and importing images.

Tauri 2 (Rust) + Phaser 4 + TypeScript, no frontend framework.

## What it is

Idlewild is a prototyping environment. You pick a template — isometric,
orthogonal or blank — and a style — top down or platformer — and get a light
blue, effectively infinite grid you build on with your fingers: hold to select
a run of spaces, fill them, drop images into them, export a patch as a
transparent PNG. On a blank canvas nothing snaps and a selection is exactly
the rectangle you dragged. Every image that enters, including a pasted PNG,
becomes a PSD and goes through
[psd-to-json](https://github.com/laffan/psd-to-json-rust), so the
psd-to-phaser integration is uniform: a screenshot and a hand-built Photoshop
document arrive at the runtime the same way.

Publishing hands you either a zipped runnable site or a `.idlewild` file — the
whole project, source PSDs included, to open somewhere else. Direct publishing
to a web server over rsync is planned and explicitly out of scope for now.

## Status

This is the first vertical slice — everything below runs end to end, and the
remaining pieces are wired to real slots rather than mocked.

**Working**

- Project list with thumbnails, long-press rename / duplicate / delete
- New Game: template (isometric, orthogonal, blank), style (top down,
  platformer) and grid scale (8–256 px — 8 and 16 are there for pixel art,
  where a space is a sprite rather than a room). Blank has no lattice: a
  selection is the exact rectangle it was dragged across, and a fill on it is
  one rectangle rather than a run of spaces
- And how it renders, on the same sheet. **Pixel perfect** is one box for the
  two settings that go together — nearest-neighbour textures, so a 16px sprite
  scaled up stays blocky, and whole-pixel drawing, so a camera at a fractional
  scroll does not smear it. **Default zoom** is what a scene opens at, here and
  in the game; 8px art usually wants 3× or 4×. Both are in Project Options
  afterwards, as two switches and a number, and changing one is live: the
  canvas re-filters every texture it has and the config the game reads is
  rewritten under it
- **A character controller, optionally.** Ticked — the default — New Game
  writes `js/prefabs/character.js` and the line in the scene that puts it down:
  a prefab that walks the grid over A\*, or runs and jumps along it. Unticked,
  neither is written, and the project places the document and waits for yours.
  It is the one choice Project Options reports rather than offers, because it
  was lines in a file and the file is yours from the moment it is written
- A full-width header carrying the project, undo and redo, and the
  **Draw / Code / Play** toggle, with Publish and Project Options behind its
  menu. It insets itself out of the iPad's status bar, as the console drawer
  does out of the home indicator
- Infinite grid, two-finger zoom, tap-to-pick. Select drags a plain rectangle
  around things to pick up several images at once; press and hold instead and
  it asks for a patch of grid, in the grid's own shape, taking the ground
  rather than whatever is standing on it. Pan drags the camera, and holding
  space borrows it from wherever you are
- Press and hold to ask for a patch of grid, and get Fill, Add Image,
  Generate PSD and Extrude over it
- Fill a selection with any colour, from a full picker with recent swatches
- Generate PSD makes an empty file the size and shape of the selected grid
  area, already marked and anchored — somewhere to go and paint
- Extrude mode pulls a prototype solid out of the grid. The rest of the canvas
  dims, a bar along the bottom offers Apply and Cancel, and the selected
  spaces become a plate to drag: on an isometric project it stands up as a
  shaded block of cubes, on an orthogonal one it fills the spaces the way it
  was pulled. You are not stuck with the first pull — hold on the shape to
  take hold of another face and pull that one somewhere else. What you take
  hold of is a *side of a space*, not a patch of ground, and a sweep from it
  runs in that face's own plane: so a wall goes up ten, one of its side faces
  three from the bottom comes out ten sideways, five of that arm's roof tiles
  go up again, and so on. A face pushed back the way it came carves instead of
  adding, which is how a pull too far is corrected
- Backfaces turns the solid see-through so the sides facing away from the
  camera become the things a click lands on — the only way to pull the far
  wall of a box outward. It is a toggle on the bar, and holding ⌘ borrows it
  the way holding space borrows Pan. Erase, beside it, is a rubber: press or
  drag and the space under the pointer goes, on the far side too
- Apply writes the extrusion as a PSD, marked and anchored on the spaces it
  was built over, and places it where it stood. The solid goes into the
  document with it, so Apply is not a one-way door: the PSD's own layer list in
  the inspector marks the extruded layer with a cube, and clicking it opens the
  same shape back up — the flat artwork steps aside while you work on it, and
  applying again rewrites that file rather than leaving a second copy beside
  it. The artwork goes in as a **group** — `G | extrude-…` holding
  `S | lines-…`, `S | shading-…` and `S | shape-…` — so the silhouette, the
  shading that makes it read as a solid, and the lines between its spaces are
  three things you can take separately in Photoshop. Each is true on its own:
  the silhouette is solid, with no ghost of the lattice printed into it, and
  the lines are the lines you can actually see — an overhang hides the edges
  of what is behind it there exactly as it does on the canvas. The shape outlives every
  edit to the file — a re-parse, a re-import, a layer stack rewritten in the
  inspector — so the way back in is always there. And applying again
  **rewrites** the file rather than replacing it: the group's contents and both
  marks come out regenerated, each back where it was in the stack, and a layer
  painted over the greybox is still there afterwards, still lined up on the
  artwork
- Layers the app owns the name of are listed read-only and say why: the two
  orienting marks on every file the editor writes, and an extrusion's artwork.
  All three are found or regenerated by name, so renaming one is not an edit —
  it is a way to break something quietly
- Every placed PSD has a **collider**: the grid spaces it occupies as far as
  the game is concerned, in a Collider section of the inspector with Make
  blocking / Make walkable beside it. It is given a shape the moment the file
  lands, so nothing has to be visited one at a time — an isometric extrusion
  blocks the spaces its blocks actually stand on, following the same 3D logic
  the mode was pulled with, so you can walk under an arch and round its piers;
  a flat extrusion is every space of it, because every space of it is ground;
  anything else blocks the spaces under its base, which on a diamond grid is
  the bottom of the picture rather than the hillside behind it. Edit collider
  opens the shape on the grid with Add, Remove and Reset along the bottom bar
  and Apply to keep it. It rides in the config the game reads, so a character
  walks round a tower instead of through it — in Play and in a published
  export alike, because those are the same program
- Drag placed images, fills and boundaries, snapped to the grid; resize images
  from their corner handles, or freely from the inspector
- A placed PSD moves as one thing: every layer it came in with drags and
  resizes together, keeping the arrangement it was built with. Double-tap to
  open it up and move a single layer, and tap away to close it again
- Resizable sidebars and console drawer, persisted per install
- Add Image from Files, Photos or the clipboard → PSD → psd-to-json → placed,
  at half size because everything drawn on a retina machine is 2×
- Paste an image or a PSD straight onto the canvas: it is imported like any
  other file — marks and all — and lands in the middle of the view, on the
  layer you are on — ⌘V, or Paste Image in the menu. The clipboard is read
  through the shell rather than the webview, which is what makes a PSD copied
  in Files reachable at all on an iPad, where ⌘V is taken as a keyboard
  shortcut because the webview delivers no paste event over a canvas
- Drag a file onto the canvas and it lands where you let go of it, imported
  exactly as a paste is. Drag it over an image already there and that image
  lights up: dropping on it offers to put the new file behind it instead,
  which changes every placement of that PSD at once
- Every import carries its grid space into the PSD as two marks a game never
  sees: a red dot on the space it is anchored to, and the outline of the
  selection it was dropped into. Move the dot in Photoshop and the artwork
  re-anchors to it — which is how you make something stand on its tile. A
  file that comes back **without** the dot — flattened on save, or brought
  home through Photos as a picture — is held where it is instead of being
  re-centred on its canvas, and the console says the mark has gone
- **Scenes**, the way Phaser means them: a set of layers and a canvas of its
  own. A project is several places — a title screen, a cave, the overworld —
  sharing a grid, a genre and a pile of PSDs but not a single thing standing
  on them. The dropdown at the top of the left sidebar switches between them
  and holds New, Rename, Duplicate and Delete; each scene remembers where you
  were standing in it. A duplicate is a real copy, not a second name for the
  same thing
- Layers, under the scene they belong to: drag by the grip to reorder, rename,
  lock, hide, with live counts and an expandable list of what is on each one —
  selecting there selects on the canvas, and a placed PSD listed under a layer
  has a grip of its own that carries it to whichever layer you let go over.
  The two senses of the word stay apart: a layer here is Phaser's — draw order
  over anything at all — so a placed PSD is **one row** however many layers are
  inside the file, and the stack inside it belongs to the inspector. Select a
  layer and the inspector offers **Delete layer**, under the tally of what
  would go with it — it asks first, and the PSDs themselves stay in the
  project. A scene keeps its last layer, and the button says so rather than
  disappearing
- **Points**, from the rail: tap and a named place lands on that space, in
  the layer palette and on the canvas. Rename it in the inspector, drag it a
  space at a time, delete it. One point per scene can be its **start point** —
  the palette marks it with a flag and the canvas gives it a second ring — and
  that is where the character stands when the game opens, in Play and in an
  export alike. Naming a second point the start releases the first, because
  the scene holds the designation rather than the point. Every point reaches
  the game in `config.layers[].points`, so a door or a trigger is a matter of
  reading back the one you named
- Draw on any layer with Hush's stroke engine: five brushes, pressure and
  Apple Pencil, a slice eraser, and a lasso. Fingers never draw — they pan
  and pinch the game camera, so a hand can rest on the glass
- Hand a lassoed sketch to its layer as a PSD to flesh out elsewhere, or as
  a blocking boundary play mode walks around. The PSD carries the same
  orienting marks an import does — the anchor dot and the grid the sketch was
  drawn over — so there is a grid under the ink when you open it to paint.
  Its canvas is the ink plus the spaces the ink actually covers, not the
  larger diamond enclosing them
- Inspector for layers, selections, fills, placed images, points and
  boundaries, in Info / Transform / Layers sections. A placed image's title is its filename,
  and retyping the part before `.psd` renames the file, moves its assets with
  it, and repoints every placement on it
- Option-drag a fill or an image to copy it. A copied image references the
  same PSD, which the inspector says so you know editing one edits both —
  and Remove Reference gives it a copy of its own. Option-shift-drag skips
  the step: the copy comes out independent
- The selected PSD's own layer stack, in the inspector: drag by the grip to
  reorder it, rename in place, then Apply to rewrite the file and re-run the
  pipeline. Renaming is how a sprite becomes a tileset, so it is worth having
  without a trip to Photoshop. Groups are listed as Photoshop shows them —
  the group, then its contents indented under it, foldable away from the
  group's own second line — and a drag takes a group's contents with it,
  landing only among the things it already sits beside. A PSD with masks or
  clipping is listed read-only, because a rewrite would flatten them
- Convert a fill to a PSD, the same way a sketch converts. Both export at
  double resolution and place at half, so a converted block-out matches an
  imported image pixel for pixel instead of arriving at half its detail
- A fill or an extrusion written out as a PSD gets a **grid space of clear
  canvas** around it, so there is somewhere to paint the eaves that hang past
  the wall. It is the canvas that grows and nothing else: the artwork keeps
  its size and its place on the grid, and blocks exactly what it did. Paint
  into that room and Re-parse, and it comes back where you painted it: the
  layers inside a file keep the arrangement the file gives them, however
  Photoshop has cropped them on the way back
- Delete removes whatever is selected
- **Undo and redo**, from the two buttons beside Edit or from ⌘Z and ⇧⌘Z —
  the same keys on a Mac and on an iPad with a keyboard attached, and the
  buttons for an iPad without one. A step is a thing you did rather than a
  write the editor made: dragging an image across ten spaces is one step, and
  so is a dropped PSD however many layers came in with it. The two buttons
  follow what you are working on — put the caret in the code editor and they
  undo there instead, in that file's own history, which is the same one ⌘Z has
  always had in it, and while extrude or collider mode is up they undo *in
  that*, a pull or a rub at a time, with the document's history waiting
  untouched underneath. The code panel carries a pair of its own beside Save,
  for when it is floating over the header. Undo does not reach across the things
  the editor cannot take back: renaming a PSD, or bringing an edited one home,
  moves a file on disk, and the history stops there rather than restoring a
  document that names a file which is no longer where it says
- Export a selection as a transparent PNG (save or copy), from the inspector
- Edit a placed PSD outside the app and bring it back: Open PSD hands the file
  to the system editor on macOS and to the share sheet on iPadOS. Re-import
  asks where the edited file came back from — Files, the photo library or the
  clipboard — and replaces it under the same key, re-running the pipeline
- The exported game places the scene you have open, and carries the rest: the
  config holds every scene's layers and loads every scene's PSDs, so switching
  in your own code is a matter of reading `config.scenes`
- Play runs **the project's own code**: the `game/` tree you see in the code
  modal, loaded over the local server exactly the way a published export loads
  it, in a frame over the canvas. No grid lines: the editor's light blue lattice
  is scaffolding to build on, and a game is the thing you built. Save a file while it is up and the game
  restarts on what you just wrote. Top down is a character that walks the grid
  over A*, side-on is one that runs and jumps with the arrow keys — and both
  of those are files in the project now, so they are something to change
  rather than something the editor does. A platformer reads
  the same document from the side: every non-walkable fill, blocking boundary
  and placed PSD's collider is the ground it stands on rather than an obstacle
  to route around
- `js/game.config.json` — the document in the shape the project's code reads
  it — is rewritten on every save, so the file the code modal opens describes
  the canvas beside it and the game you play is the game you built
- Code is a section rather than a panel that happens to be open: the middle of
  the three at the top, and the inspector folds away while you are in it because
  nothing in a file is on the canvas. The panel sits in one of **four** places,
  on a row of buttons in its own header — a row above the console (the default:
  code here is code about the canvas beside it), a column to the **left** or
  the **right** of the canvas, where a wide screen gives a file the window's
  full height, or over the whole editor. Each remembers its own size, and which
  one you left it in is remembered too
- The project's real file tree in CodeMirror 6. New File and New Folder sit in
  the modal's header; rename, duplicate, delete and dragging files between
  folders are on the rows, in a column with a divider of its own. A drag carries
  a **ghost** of the row under your finger, naming the folder it would land in,
  and that folder's row lights up as you pass it — pointer events have no drag
  image of their own, and a finger drag with nothing following it looks like
  nothing happening
- The editor and you do not fight over the code. A scaffolded file marks the
  runs the editor maintains — `preload`, `placeDocument` and the rest — and
  those lines come up in their own colour and refuse to be typed over. It is
  decided **line by line**, so a `console.log` dropped into the middle of one
  is yours to edit and delete while the lines around it stay locked, and every
  marked block has a **Reset** beside it that puts it back the way it came.
  When a fix to the editor adds a block your file has never had, it says so and
  offers to put it in — your `game/` tree is your copy, and nothing writes into
  it unasked. The generated config is the whole-file case: read-only, and
  re-read as you build
- Docs, along the bottom of the code modal: Phaser's concept guides, Phaser's
  own API, MDN's JavaScript, CSS and HTML reference, and psd-to-phaser's docs.
  Automatic follows the caret — put it on `this.add.sprite` and the page for it
  appears — and the MDN half follows the file, so a `.css` asks about CSS.
  Search, and a table of contents for the written guides. All of it is on the
  device, so it works on an iPad with no network
- Console drawer in Fira Code — selectable, `%c`-aware — carrying the
  editor's own commentary, psd-to-json's progress, and the JavaScript console:
  this page's and the running game's, errors and stack traces included, so a
  `console.log` in your `WorldScene.js` shows up where you are looking. **App**
  and **JS** toggles on the right of its header bar, when it is open, filter
  one from the other
- Log an object and you get an object: a disclosure triangle, a one-line
  preview, and its contents a level at a time, with keys, strings, numbers and
  nulls each shown as what they are. Classes say which class they are, a Map
  and a Set open like anything else, and a cycle says so rather than hanging
- **LOG** beside a line from your own code is a link to the line that wrote
  it: it opens the file in the code modal and puts the caret on it. Works for
  warnings and errors too, and steps over Phaser's own frames — a
  `console.log` reached through a callback still names the line you typed
- The game a project scaffolds is laid out the way you would lay one out
  yourself:

  ```text
  index.html
  styles.css
  js/main.js
  js/game.config.json     the document, generated on every save
  js/lib/                 Phaser and psd-to-phaser
  js/scenes/WorldScene.js
  js/prefabs/character.js
  js/shared/grid.js       the projection, and the document's geometry
  js/shared/navigation.js A* — or physics.js, for a platformer
  ```

  `js/lib/` is the only directory that is not on your disk while you work: the
  two runtimes are 1.5 MB that would be the same in every project, so the local
  server answers for them and an export writes them in. A project made before
  this layout keeps the one it was made with — your `game/` tree is your copy —
  and plays and publishes from wherever its own `index.html` says
- Publish has two exits. **Export site** is a zip you can serve: the game, its
  processed assets and both runtimes, so the exported game opens showing what
  the editor showed. **Export project** is a `.idlewild` file — the project
  itself, source PSDs and all, with the document, the processed assets and the
  code as it was edited. A published site cannot give you back the file a
  sprite was drawn in; that is what the second one is for
- **Open**, beside New Game on the home screen, reads a `.idlewild` back in as
  a project of its own. Everything comes with it, including the solids behind
  extruded layers — so a shape you pulled on one machine is a shape you can go
  on pulling on another

**Next**

- Hush's blit-forward re-anchor, so panning a stroke-heavy layer past the
  drawing backing's edge slides its pixels instead of re-baking them
- Pattern fills rendering their PSD texture rather than a tint
- Phaser-aware autocomplete in the code modal, and the other direction of the
  canvas ↔ code binding: the canvas drives the code today, through the config
  the editor writes, and code does not yet drive the canvas
- Play starting from the camera the editor is looking through, rather than
  where the project's own scene opens
- One Phaser scene per Idlewild scene in the exported game, with transitions
  between them — today the template places the open one
- Sloped ground for the platformer: a blocking boundary is currently taken as
  its bounding box
- rsync publish targets
- Opening a `.idlewild` straight from Files or the Finder — the format is
  real, but it is not declared to the system and nothing handles a file the OS
  hands the app

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

The reference in the code modal carries [MDN Web Docs](https://developer.mozilla.org)
content, used under CC BY-SA 2.5, alongside Phaser's and psd-to-phaser's own
documentation.

See [README-TECHNICAL.md](README-TECHNICAL.md) for architecture.

## PSD layer naming

Layers must follow psd-to-json's pipe convention to be recognised:

| Format | Example | Result |
|---|---|---|
| `S \| name` | `S \| player` | Sprite |
| `S \| name \| animation` | `S \| hero \| animation` | Animated spritesheet |
| `S \| name \| atlas` | `S \| items \| atlas` | Texture atlas |
| `T \| name` | `T \| background` | Tileset |
| `G \| name` | `G \| enemies` | Group |
| `P \| name` | `P \| spawn` | Point |
| `Z \| name` | `Z \| boundary` | Zone |

Images converted on import are named `S | <stem>`, so they arrive as sprites.
