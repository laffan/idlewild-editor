# Known gaps

What is not done, what is done narrowly, and what is a trade rather than a
bug.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

- **Nothing in a scaffolded project draws a tile layer yet.** The data reaches
  the exported game — `game.config.json` carries `tiles` per layer and
  `tilesets` beside them, in the shape every Phaser tilemap helper already
  expects — and no template reads it, so a published project shows its object,
  pattern and background layers and none of its tiles. The half that had to be
  right first is the format, because that is the half a document is written in
  and cannot be changed afterwards without rewriting everybody's projects; a
  scene that reads a config is a scene. See [Tile layers](tile-layers.md).
- **Tile layers are painted with two tools.** The Pencil and Fill, re-pointed,
  because those are the two that already existed and the first version is a
  re-pointing rather than a second toolbar. A rectangle, a tile picker and a
  terrain brush are all things Tiled has that this does not, and each is a
  tool rather than an argument — they were left out to keep the first version
  about the *data*, not because they are hard.
- **An external `.tsx` tileset is refused rather than resolved.** A map that
  keeps its tilesets in separate files names them by a path relative to
  itself, and following that would mean a second read, a second parse and a
  second set of failure modes at a door that already has four encodings behind
  it. The refusal names the remedy — save the map with its tilesets embedded —
  which is one checkbox in Tiled's save dialog.
- **zstd tile data is refused.** The webview's only decompressor is
  `DecompressionStream`, which does gzip and deflate and not that. A wrong
  answer would be a map full of plausible rubbish, so it is a sentence naming
  the three encodings that do work.
- **The server publish is SFTP, not rsync**, so a changed file is sent whole
  rather than as a diff against what is already there. The manifest recovers
  skipping unchanged files, which is most of the benefit, and not the rest. The
  sending half of rsync's wire protocol is published as a library by nobody and
  is defined by rsync's own source rather than a specification.
- **The iOS build has never been compiled.** There is no macOS or Xcode in the
  environment this was written in. `libgit2-sys` defining `GIT_SECURE_TRANSPORT`
  for `apple` targets, `ring` cross-compiling to `aarch64-apple-ios`, and
  `vendored-openssl` covering git2-rs's `not(target_os = "macos")` gate are all
  arguments from how those crates are built rather than from having watched
  them build. It is the first thing to check on a device.
- **The iOS save staging is argued, not watched.** The 0-byte export is
  understood and fixed from tauri-plugin-dialog's own iOS source — the empty
  placeholder, the `if !fileManager.fileExists` guard that leaves a staged file
  alone, and `.documentDirectory` being `$HOME/Documents` — rather than from
  having stepped through it on a device. If a future version of that plugin
  stages somewhere else or stops checking whether the file is already there,
  the symptom returns. What is different now is that it will say so: an export
  that built nothing logs a warning naming the path, instead of leaving an
  empty file to be found in Files. See
  [Leaving with a file, and the order iOS needs](exports.md#leaving-with-a-file-and-the-order-ios-needs).
- **The GitHub token and the ssh key are in a file, not in the system
  keychain.** `publish.json` is `0600`, beside the project store — anything that
  can read it can already read every project's source — but Keychain and its
  iOS counterpart are the right answer, and are a dependency and a platform
  pair that have not been taken on. The key's passphrase sitting beside the key
  is the sharper half of that: it is the difference between somebody who has
  the file having a key and having a *usable* key.
- **An ssh password is not an option, only a key.** Storing one would mean
  carrying a password to disk with nothing better to put it in, and
  `ssh-copy-id` is the answer everybody already has — but it does mean a host
  that only takes passwords cannot be published to from here.
- **A server certificate is trusted on first use like a bare key.** Checking one
  properly means carrying the issuing authority's key, and nothing in this app
  has anywhere to get one.
- **A publish target does not travel in a `.idlewild` file.** It names a server
  by an id that exists only in this install's settings, and `meta.json` does not
  travel anyway. A project opened on another machine has to be pointed
  somewhere again.
- A publish says how it went in the console rather than showing progress.
  `rsync` and `git` are run to completion and their last lines are reported;
  neither is parsed as it goes, so a large first publish is a line saying it
  started and then a line saying it finished.
- ⌘C on an iPad puts a `public.file-url` on the pasteboard and nothing else, so
  what it copies is pasteable into Idlewild and not into another app — which is
  the half the gesture is for, and *Share PSD* is the other half. Offering the
  bytes beside it there means an `NSDictionary` through `setItems:`, since
  `setData:forPasteboardType:` sets one representation on the first item. See
  *Copying is not pasting backwards*.
- A PSD imported out of another project arrives as its artwork alone: the
  document's record of it — the solid behind an extruded layer, a collider
  somebody edited — lives in that project's `doc.json` and does not travel. The
  export that carries them is `.idlewild`, which brings the whole project, and
  there is no half-way format between the two.
- Pattern fills store their PSD key and render as a tint; the texture is not
  yet sampled into the fill. That is a *fill* whose texture is a **PSD in the
  project**, and it is a third sense of the word, unrelated to a pattern layer
  and unrelated to the app-wide library. A fill made of a library pattern or
  shape does draw — see [The pattern and shape libraries](pattern-and-shape-libraries.md).
- There is no **combination** editor, which is the one thing
  simple-tileset-generator has that this does not: a shape spanning several
  tiles, with a pattern per path. Every piece is here — the shapes, the
  patterns, the lattice, the boolean — and what is missing is the editor and
  somewhere for a multi-tile stamp to live in the document, since a `Stroke`'s
  stamp is one space.
- A shape stroke carries a shape *or* a pattern, never both. The combination
  editor's per-path patterns are the obvious place that would be wanted, and
  `PaintSpec.kind` would have to stop being one of three things first.
- The SVG reader does not convert arcs. An `A` comes through as a straight
  line to its endpoint, which is honest but lossy; every other command, in
  both cases, round-trips.
- The boolean cut answers in polygons, not curves. A cut edge is the curve
  walked at twelve samples a segment, which reads as the curve at a tile's
  size and does not if the shape is later scaled far up. A boolean over
  beziers is a much larger piece of work, and upstream makes the same trade.
- A painted fill larger than 3072 world pixels a side keeps its flat colour:
  the canvas texture it would need is the trap `fill-actions.ts` guards
  against when it generates a PSD, measured in hundreds of megabytes.
- The library is per install and a document names a row by id, so a project
  moved to another machine loses any custom pattern or shape it used — it
  draws in its colour and says so. A library export, or carrying used rows in
  the `.idlewild` file, is the fix and neither is written.
- A pattern layer is absent from the minimap in both directions: its
  placements are a palette standing nowhere, so drawing them would show a
  heap of elements on one space, and the pattern made of them reaches
  everywhere, so there is nothing about it a map of where your work *is*
  could usefully frame.
- A pattern's elements are placed one Phaser group at a time, which is what
  `MAX_ON_SCREEN` exists to bound. A scatter dense enough to matter wants a
  blitter or a render texture, and at that point the ceiling becomes a
  performance note rather than a wall.
- An image background is written as a canvas covering the spaces asked for,
  with one clear sprite layer inside `T | Background`. Nothing samples what
  the artist paints back into a *smaller* file, so a backdrop asked for at
  thirty spaces stays thirty spaces wide however much of it is left
  transparent.
- The progress a background sheet shows is indeterminate. The pipeline names
  the stage it has reached and not how far through it is, and a bar filling at
  a rate nobody measured would be a guess dressed as a measurement.
- A pattern shape drawn with the pencil is baked to cells when it is made and
  never re-baked. Changing the grid size afterwards leaves the spaces where
  they were rather than following the line that produced them.
- A character sorts into the isometric ordering of **one** layer — the
  front-most object layer — so scenery on another object layer is either
  always in front of it or always behind. That is a useful thing to be able to
  say and a limitation where it was not meant.
- Nothing sorts on Y under a flat projection, in the editor or in the game, so
  a top-down orthogonal character is always in front. The sort key exists and
  the machinery is the same; what is missing is a reading of `cy` that a
  square grid's placements agree with.
- Only the character sorts itself in. Anything else the project's own code
  adds to an isometric scene — a second walker, a projectile, a door that
  opens — has to do the same lookup, and `walkDepth` is exported into the
  scene for exactly that, but nothing does it for you.
- A colour's opacity reaches the exported game and the PSD pipeline, but
  **not** a PSD's own pixels: ink applied in PSD Edit mode is composited into the
  file at the opacity it was drawn with, which is correct, and there is no way
  to change a layer's opacity in the file afterwards.
- The point-to-point fill's shape reaches no history. It is drawing-layer
  state rather than a document object, so ⌘Z does not take a corner back —
  Undo corner on the floating bar is the whole of it, and leaving the layer
  throws the shape away without a way back. The thing it *becomes* is a
  stroke, which undoes like any other.
- The floating bars keep a fixed left gutter rather than one that knows where
  the tool columns actually are. The rail hangs from the top and the drawing
  toolbar stands on the bottom, so between them they cover most of that edge
  and a constant is honest most of the time — but a bar over something in the
  vertical middle of the canvas is pushed right by 88px for nothing.
- The Boundary tool sweeps freehand and nothing else. There is no
  point-to-point boundary the way there is a point-to-point fill, and the two
  are the same shape of problem — a polygon tapped out and adjusted — so the
  second one is a matter of reusing the first rather than of new thinking.
- A boundary swept with the tool arrives blocking, and the only way to make it
  passable is the inspector row afterwards. There is no modifier or toggle on
  the tool itself, because a bar for one tool is chrome and the row is one tap
  away.
- Mask mode sweeps rectangles and nothing else. A boundary that is genuinely
  diagonal is a staircase of sweeps, and the obvious answer — dragging a
  freehand path that paints the spaces under it — is one method away. The
  rectangle is what the working half of the old route did, so it is what
  shipped first.
- A pattern shape edited in mask mode loses the outline a pencil gave it, and
  that is deliberate rather than pending: the line described spaces that are
  no longer the shape's. What is missing is the other direction — no way to
  take a drawn line *into* the mode and adjust it as a line.
- The drawing layer's re-anchor still re-bakes what is visible rather than
  sliding the baked pixels and repainting the newly exposed strips (Hush's
  delta #25), and its done canvas is a single buffer rather than the
  opacity-swap pair (#29/#31). Both are about panning and re-anchoring; the
  stroke path itself has been through the rest of Hush's deltas — see **What a
  stroke costs**.
- There is no tile index over the strokes on a layer. A re-bake culls on each
  stroke's bounding box against the backing, which is enough at the sizes a
  sketch reaches and is not the same thing as knowing which strokes touch a
  dirty rectangle.
- Two PSDs with a same-named **mask** still collide in Phaser's texture cache.
  Artwork no longer does — every load goes through `loadMultiple`, which keys a
  texture on the PSD as well as the layer — but `place` looks a mask up as
  `<name>_mask` on both of the plugin's loading paths, so there is no key to
  scope it under. Masks are rare, and a shared one is a wrong shape rather than a
  missing picture. See **The texture keys**.
- A placed group is still a Phaser Group rather than a Container. Its parts
  are positioned and scaled one at a time, from the offsets they were made
  at, which is what makes a composition move and resize as one — but there is
  no single object underneath it, so there is nothing to rotate, clip or mask
  as a whole.
- Strokes are listed under a layer as one row rather than individually, and
  are the one thing that cannot be carried to another layer from the panel. A
  sketch is a few hundred strokes and each is a stroke of a pen, not an
  object; the row selects the lot, which is the granularity both conversions
  work at anyway.
- The project thumbnail is a snapshot of Phaser's canvas, so a layer that is
  only a sketch photographs blank. It is also the one thing leaving a project
  waits for, and `renderer.snapshot` queues its callback for the end of the
  next render pass — so a pass that cannot finish used to mean a promise that
  never settled and a Back button that did nothing. It times out now: no
  picture is an answer, and a thumbnail must not be able to hold the door
  shut.
- The minimap re-bakes whenever the framing moves, and the framing moves on
  every pan where the camera is not already inside the work — which is most of
  them. It is cheap because what it draws is boxes and sampled lines rather
  than artwork, and a heavy scene measured under software rendering costs it
  under two milliseconds a frame; the version after this one bakes the content
  once at its own framing and blits it, the way the drawing layer presents its
  backing rather than repainting it.
- A minimap tap moves the camera but never the zoom, so there is no framing a
  region by dragging a box on it, and no way back to the whole document in one
  gesture.
- **A step has no name.** The stack holds snapshots and nothing else, so the
  buttons say "Undo" rather than "Undo Move image", and the console says
  nothing when a step goes back. Labelling would mean threading a string
  through every mutation on `DocStore`, and what the canvas does when you
  press it is already the answer most of the time.
- Undoing an import leaves the PSD it wrote in `psd/`, and undoing a
  conversion leaves the file the fill or the sketch became. Nothing points at
  them, and redo finds them still registered — but a project accumulates
  orphans that only a re-export sheds.
- The two file operations that raise a history barrier — renaming a PSD, and
  bringing an edited one back — clear **both** stacks rather than fencing the
  part of the document they actually touched. Twenty steps of grid work are
  gone the moment a file is renamed, which is heavy-handed for safety that a
  per-key fence would give more cheaply.
- An undo that lands in another scene switches to it, which is right, but it
  arrives with no notice — the canvas simply becomes somewhere else.
- A canvas mode's history is the session's and dies with it, so Cancel is
  still all-or-nothing: there is no undoing your way out of a mode, and no
  redoing a shape you cancelled. Apply is the same door in the other
  direction — the pulls that made a solid collapse into the one document step
  that placed it.
- Strokes do not reach a publish, and play mode is a publish now, so they do
  not reach play either. They are scaffolding for the PSDs and boundaries they
  become.
- Play mode is the published game, which means it does not inherit the
  editor's camera: it opens where the project's own scene puts it. That was a
  deliberate trade for running the user's code, but "play from where I am
  looking" is a real thing to want.
- The code modal has none of phaser-bench's Phaser-aware completions, and the
  binding runs one way: the canvas drives the code, through the generated
  config, and code does not yet drive the canvas.
- **A 1× asset still arrives at half size.** `IMPORT_SCALE` is a constant
  rather than a per-project setting, so an 8px project importing 1× art has to
  resize it once — and `defaultZoom` does not help, because it is a camera.
  Neither of them is "this project's art is 1×", which is the setting a
  pixel-art project actually wants.
- Pixel art applies to the *editor's* textures and the game's renderer, and to
  the camera for whole pixels — but the drawing layer's own backing canvases are
  not re-filtered with them, so ink drawn while it is on can still be smoothed
  as the canvas scales. The ink is baked at its own resolution; making it blocky
  is a question about the brush engine rather than about this setting.
- A project made before the eye column keeps its own `placeDocument`, so its
  game draws a hidden layer until that block is Reset — `applyHidden` is
  offered as a block it has never had, but nothing can add the line that calls
  it. The editor's own canvas hides it either way, which is the half that is
  not template code.
- Hiding a layer inside a **merged** group — an `S | name` over a group, a
  tileset, an atlas — bakes it out of the composited image rather than
  carrying it as a flag. That is psd-to-json's behaviour and the right one for
  a single image, but it means "hidden is still exported and accessible" holds
  only for layers that are placed separately.
- A project's `game/` tree is never migrated, which is what makes it the user's
  — and what means the new layout, the camera block and the dropped grid reach a
  project made before them only as far as the offer to add a missing block goes.
  There is no "bring my tree up to date", and the three shims that keep the old
  layout working (the server's runtime paths, the exporter's, and
  `templates::MOVED`) are the price of not having one.
- Re-import replaces a whole PSD. There is no diff against the previous
  parse, so a placement is matched to the new file only by its layer path.
- The anchor mark is written on import and read on every parse after, but
  there is no way to move it from inside the editor — that is Photoshop's
  job, which is the point, but it does mean a PSD imported from elsewhere
  anchors on its canvas centre until someone adds one.
- A stroke selection converted to a PSD is still centred on the cell under
  its middle rather than sending an `art` offset, so it can land up to half a
  space from where it was drawn. A fill conversion is exact.
- Play mode's character is a placeholder rectangle, not a sprite from the
  template, in both styles. It is the template's own rectangle now, so it is at
  least a thing you can go and change.
- A managed block's ownership is decided by a line diff, so two identical lines
  inside one block — a bare `}`, a blank line — can swap which of the pair is
  called the editor's. Nothing breaks; a line you typed may simply be the
  locked one. Reset is the way out.
- A re-import reconciles the placements of that PSD in the **open scene**
  only: other scenes keep the geometry they had, and a layer the new file
  added does not appear in them. Staleness rather than corruption — the
  placements still point at a key that exists — but it is a scene switch away
  from being visible and there is nothing that says so.
- There is one Phaser scene per Idlewild scene now, and the exported game
  opens on the one the editor had open. What there is no shape for yet is
  **transitions**: `this.scene.start("Cave")` works and is documented in the
  scaffold, and anything softer than a cut is the author's to write.
- `canvas.js`, `character.js`, `main.js` and the generated config carry
  managed blocks. `grid.js`, `navigation.js` and `physics.js` are the
  project's alone, even though the scaffold wrote them and the editor's
  config is what they read — and a **scene** file is the project's by
  design, which is the point of the split.
- A platformer takes a blocking boundary as its bounding box, and a
  collider's spaces go through the same reduction in `physics.js`. Resolving
  against the polygon — sloped ground — is a different feature.
- **Resizing a placement does not resize its collider.** The shape is a fact
  about the file and the size is a fact about the placement, so a copy scaled
  to twice the size goes on blocking the spaces the original did. Re-opening
  the collider and drawing the difference is the way round it; making it
  follow the scale would mean the two copies of a referenced PSD could no
  longer share one record.
- A collider record outlives the last placement of its key, the way an
  extrusion's solid does. Nothing reads it while nothing is placed, and
  placing the file again finds the shape it had.
- A collider on a project whose grid does not snap is the artwork's box and
  cannot be edited: there are no spaces to paint. The box follows the artwork
  as it is dragged, so the honest gap is that it cannot be made tighter than
  the picture.
- Renaming a PSD moves the file, not the layer inside it, so a renamed file
  keeps the layer path it was imported under. That is what makes the rename
  safe for every placement on it; the inspector's PSD layer list is where the
  layer's own name is changed.
- A blank project's play mode navigates on a square lattice of the project's
  nominal unit rather than on what was actually drawn. A* over single pixels
  would neither finish nor mean anything, but a coarse lattice over free-form
  geometry is a compromise, not an answer.
- Opening a `.idlewild` from Files or the Finder is not wired: the format is
  real and the in-app Open reads it, but there is no system file-type
  declaration and nothing handles a file the OS hands the app.
- An import trusts the archive's `assets/` rather than re-running the
  pipeline over its `psd/`. That is what makes an import instant, and it means
  an archive whose assets were stale carries the staleness across; the fix is
  the same Re-import that fixes it anywhere else.
- An export ships the `game/` tree as it stands on disk, which is what makes
  it the user's source — so a project scaffolded before a fix to the template
  keeps its own copy of the old scene, and its managed blocks reset to the
  template the *current* binary holds rather than the one it was made with.
  `game.config.json` is the exception twice over: it is generated, kept in step
  on every save, and rewritten again on the way into the zip.
- Pattern fills export as a flat colour, matching what the editor draws, and
  a pattern's PSD key is not among the `psdKeys` an export loads.
- Neither the Tauri build nor the iPad target has been exercised in CI; both
  need a machine with the platform SDKs. The pasteboard's Apple arms are
  type-checked against both Apple targets but have never been run on one.
- **The iPad now advertises multi-window, and nothing refuses the second one.**
  `UIApplicationSupportsMultipleScenes` is true in the patched Info.plist
  because in tao 0.35.3 that key is the only switch for the whole UIScene path,
  and without the scene path iOS 27 will not launch the app at all — see **The
  iPad needs a scene**. The consequence is that the system offers a second
  window of the editor, and a second editor over one project store is the
  condition **One game at a time** exists to prevent: `PluginCache` is a
  module-level singleton, and the second game's `PsdToPhaser` would be refused
  the key the first still holds. Nothing handles `SceneRequested` and nothing
  declines it. Two ways out and both are elsewhere: tao 0.37 makes the flag
  unnecessary, and until then the honest fix is to answer the event rather than
  to hope nobody drags the icon.
- An import takes its key from the file's name and overwrites a PSD already
  under it. That is deliberate for the clipboard — it is how *Replace from
  clipboard* works — but it means a dropped `roof.png` silently replaces an
  earlier `roof.psd`, where a drop *onto* an image asks first. The two ought
  to agree, and making them agree is a decision about what an import means,
  not a bug fix.
- Dropping several files at once takes the first one the pipeline can read.
  A drop is one gesture landing on one space, and a run of images would need
  somewhere to put the rest.
- Continuing an extrusion is refused on a PSD carrying masks or clipping,
  which the fork cannot express. The cube is still offered on such a file and
  Apply says why it will not write, which is one step later than it could be.
- Renaming an extrusion's *file* no longer renames the group inside it. The
  group is named for the key the file had when it was written, and only Apply
  renames it.
- Two groups sharing a name fold and unfold together, because a fold is held
  by name. Photoshop allows the duplicate; the alternative keys all come apart
  on a re-parse, which is the case the folds are most worth keeping through.
- The layer list shows nesting and reorders within a level, but offers no way
  to move a layer into or out of a group. That is a different gesture — a
  horizontal one, or a drop onto the group row — and a drag that could do it
  by accident would be worse than not offering it.
- A preserved layer that hung off the edge of the old canvas is cropped to it,
  because `crop` reads from the canvas-sized buffer the fork hands back and
  what was outside it was never in that buffer. The same is true of a rename,
  and has been all along.
- A continued extrusion keeps whatever scale its placement was resized to, so
  a block-out scaled to 80% comes back at 80% rather than snapping to the
  grid. The shape is right and the displayed size is the user's; they are only
  the same thing until someone resizes it.
- A fill or a sketch converted to a PSD is still a one-way door. Only an
  extrusion keeps what it was made from.
- Extrude mode has no undo of its own. A pull too far is corrected by pulling
  the face back, which the carve rule makes exact, and a space too many by
  rubbing it out; Cancel is the only way back to nothing.
- A sweep across faces stops growing when the pointer wanders onto a face of
  another orientation rather than following the surface round the corner.
  Wrapping a selection around an edge is a different question from sweeping a
  rectangle, and the rectangle is what a drag describes.
- X-ray mode shows the far side but not the inside: a voxel walled in on every
  side has no exposed face, so there is no way to select or rub out a space
  buried inside a solid block.
- An extrusion is greybox: one palette, three shades, no way to colour it.
  What comes out is a stand-in to paint over in Photoshop rather than
  finished artwork, which is what the marks in the file are for.
