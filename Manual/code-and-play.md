# Code, Play and the page around the game

The project's own code is a real file tree you edit in the app, and Play runs
*that* — not a rehearsal of it.

Part of [the Idlewild manual](README.md).

---

## What Play runs

- The exported game places the scene you have open, and carries the rest: the
  config holds every scene's layers and loads every scene's PSDs, so switching
  in your own code is `this.scene.start("Cave")`, under the name you gave it
- **The scaffold and your code are different files now.** A scene used to be
  one thousand-line file with the editor's machinery at the top of it, marked
  block by block and shown in a different color, and whatever you wrote went
  in between. The machinery is in `js/shared/` — `canvas.js` puts the document
  on screen, `character.js` wires up whatever moves in it — and a scene file is
  a short one that calls six of them and is otherwise yours, with nothing in it
  marked at all. `canvas.js` is the same file for both games; what differs
  between a game seen from above and one seen from the side is the character,
  which is what `character.js` is. A **PSD to Phaser** project has no
  `js/shared/` at all — see below
- **One file per scene, named after it.** Add a scene in the sidebar and
  `js/scenes/<Name>.js` appears beside the others; rename it and the file, the
  class and the Phaser key all move together, carrying whatever you wrote in
  it; delete it and the file goes with it. A name with spaces in it becomes a
  class name — *Title Screen* is `TitleScreen.js` — because a scene's name has
  to be a filename too. `js/scenes/index.js` is the list `main.js` registers
  and the editor keeps it in step, so adding a scene is never a request to go
  and edit an import. The game opens on the scene the editor has open, which is
  three lines in `main.js` you can change
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
  to route around. A **PSD to Phaser** project plays what its scene files
  place, and nothing else — artwork you drew but have not placed in code is in
  `assets/`, loaded and waiting; a **Phaser** or **Vanilla** one plays its own
  page, which is whatever you have written in `script.js`
- **A file you change while the game is running restarts it**, the way saving
  code does: ink applied in PSD Edit mode, a layer renamed or turned off, a
  re-parse, a PSD replaced by a drop. Code runs the game beside the canvas,
  and it was holding the artwork it loaded when it started
- `js/game.config.json` — the document in the shape the project's code reads
  it — is rewritten on every save, so the file the code modal opens describes
  the canvas beside it and the game you play is the game you built

## The Code section

- Code is a section rather than a panel that happens to be open: the middle of
  the three at the top. **The canvas shows what Play shows** — the project's own
  game, running — and what Code keeps that Play does not is the left sidebar
  and the panel the code is in. Save a file and the thing in front of you
  restarts on it; switch scene and it restarts there. Play is then the full
  test rather than the first look
- **The left sidebar in Code is a directory of the project**, which is what
  that column is for while you are writing against it: the scenes, the Phaser
  layers in each, the PSDs standing on those, and — this is the new level —
  the **layers inside each PSD**, in the file's own order and nesting, with a
  group's contents indented under it and the category beside each name. Those
  are the names the project's own code addresses things by, and reading one
  off the file in Photoshop or out of `game.config.json` is two windows away
  from where the line is being typed. Every row is inert except its
  disclosure — tap a layer to open it, tap a placed PSD to open *that* — and
  the names can be selected and copied, which they cannot anywhere else in the
  shell. The handles are all gone with the edits: no rename, no eye, no lock,
  no grip, no `+`, and the scene dropdown offers the scenes and nothing else.
  Nothing in there had a canvas to act on anyway
- **The properties sidebar is down in Code.** It describes what is selected on
  the canvas, and in Code the canvas is behind a running game — so it was a
  column of controls for a selection nobody could reach. The **toggle that
  folds the sidebar that is left** is back, too: it was there the whole time,
  drawn underneath the running game, so the one control for getting the column
  out of the way was invisible for the whole of the mode
- The panel sits in one of **three** places, from the pin in its bar — a row
  above the console (the default: code here is code about the canvas beside
  it), a column to the right of it, where a wide screen gives a file the
  window's full height, or over the whole editor. Each remembers its own size,
  and which one you left it in is remembered too. The reference goes where
  there is room for it: beside the editor when the panel is wide, under it
  when the panel is itself a column
- **One bar of chrome, where there were three.** There was a header across the
  top carrying three placement buttons, Docs and Close; the bar naming the open
  file; and a footer carrying Save, the words ⌘S and a pair of undo buttons.
  A hundred and sixty pixels of the window on nine controls, in a section whose
  whole subject is a file taller than the screen — which on an iPad is a third
  of the panel gone before a line of code is shown. Now it is the file bar and
  nothing else: the path, whether it is saved and whatever the editor last had
  to say on the left, and right-aligned the pin, the reference and Close, as
  three icons. The pin opens a menu rather than standing its three places in a
  row, and it ticks the one you are in. The path is cut in the middle rather
  than at the end when the column is narrow, so what you can always read is the
  filename
- **The save bar is gone rather than moved.** Nothing on it did anything the
  keyboard does not — ⌘S, ⌘Z, ⇧⌘Z — and nothing typed can be lost without it:
  the panel writes a dirty file when you open another one and when you leave
  Code, and the editor's own undo and redo follow the caret into the code.
  The one thing it costs is the full-screen placement on a device with no
  keyboard, where the header is covered and there is now no button to undo with

## The file tree

- The project's real file tree in CodeMirror 6. New File and New Folder sit over
  the column they create into, folders fold away — and stay folded, per
  install — and a switch beside the open file's path takes the whole column off
  when the code wants the room. Rename, duplicate, delete and dragging files
  between folders are on the rows.
- **The column is everything a publish sends**, not only the code. `assets/`
  is there — the pictures every PSD in the project was turned into, which is
  most of what an export weighs — along with the two runtime libraries and the
  README a publish writes. Those rows are dimmed and carry no menu: they are
  written for you, from the files they came from, and an edit to one would be
  undone by the next import. They are listed so that *what will be uploaded*
  is something you can look at rather than take on trust. A drag carries a **ghost** of the row under
  your finger, naming the folder it would land in, and that folder's row lights
  up as you pass it — pointer events have no drag image of their own, and a
  finger drag with nothing following it looks like nothing happening
- The editor and you do not fight over the code. A scaffolded file marks the
  runs the editor maintains — `preload`, `placeDocument` and the rest — and
  those lines come up in their own color and refuse to be typed over. It is
  decided **line by line**, so a `console.log` dropped into the middle of one
  is yours to edit and delete while the lines around it stay locked, and every
  marked block has a **Reset** beside it that puts it back the way it came.
  When a fix to the editor adds a block your file has never had, it says so and
  offers to put it in — your `game/` tree is your copy, and nothing writes into
  it unasked. The generated config is the whole-file case: read-only, and
  re-read as you build
- **The file you were in is still there when you come back.** The panel is
  built on the way into Code and taken down on the way out, so which file it
  showed used to be decided fresh each time — by a filename no project
  scaffolded since one-per-scene has, which is also why a new project opened
  into an empty editor. It is remembered per project now, across modes and
  across launches, and a project that has never been opened in Code lands on
  its scene

## Code settings

- **The gear** at the end of the New File / New Folder strip opens three
  settings. They are about this device rather than about the project, so they
  are remembered here and travel with neither
- **Text size** is how large the code is drawn. It takes effect as you change
  it — the editor behind the sheet redraws at every step — so you pick it by
  looking at the code rather than by imagining it
- **Tidy on save** reprints the file with Prettier on the way to disk:
  spacing, indentation, quotes and semicolons, from the code's own structure
  rather than only its left edge. Lines the editor owns are never moved — a
  tidy that would reprint one is declined, says so, and the file is saved as
  you wrote it — and a file with a syntax error cannot be reprinted, so the
  save writes it unchanged and the bar says where the trouble is. **⇧⌥F**
  tidies the file once without turning the setting on
- **Code hinting** is two tick boxes. **Phaser** offers the members of the
  expression you are typing, out of the same reference the panel under the
  editor shows. **JavaScript** offers the words already in this file and the
  browser's own names. Both are JavaScript files only, both are offers —
  Escape closes the list, and nothing is written into the file unless you
  choose it

## Find

- **Find, twice, because there are two questions.** ⌘F searches the file that
  is open and floats in the corner of it — a box rather than a fifth dock,
  since it is up for as long as it takes to type six characters. Every match
  is marked, the one in hand more strongly, Enter and ⇧Enter walk them
  wrapping round the ends, and the count says which of how many. ⇧⌘F asks the
  same of every file in `game/` and appears at the top of the file column,
  because its answers are files and that column is already the list of them:
  results stand where the tree was, grouped by file, and a line opens that file
  with the match selected. Both are plain text with an **Aa** switch rather
  than regular expressions — what anyone searches for in here is
  `config.scenes` or `place(` — and ⇧⌘F arrives carrying whatever ⌘F was
  looking for

## The reference

- Docs, along the bottom of the code modal: Phaser's concept guides, Phaser's
  own API, MDN's JavaScript, CSS and HTML reference, and psd-to-phaser's docs.
  Automatic follows the caret — put it on `this.add.sprite` and the page for it
  appears — and the MDN half follows the file, so a `.css` asks about CSS.
  Search, and a table of contents for the written guides. All of it is on the
  device, so it works on an iPad with no network. Beside the editor it is the
  same panel turned sideways — the contents list stays *beside* the page rather
  than stacking above it, and it takes the whole height of the row rather than
  half of it with the page cut off at the same line however long the page was

## The console

- Console drawer in Fira Code — selectable, `%c`-aware — carrying the
  editor's own commentary, psd-to-json's progress, and the JavaScript console:
  this page's and the running game's, errors and stack traces included, so a
  `console.log` in your scene file shows up where you are looking. **App**
  and **JS** toggles on the right of its header bar, when it is open, filter
  one from the other, and **Clear** beside them empties it — which is how you
  see what the next thing you try writes rather than reading it out of an
  afternoon
- Log an object and you get an object: a disclosure triangle, a one-line
  preview, and its contents a level at a time, with keys, strings, numbers and
  nulls each shown as what they are. Classes say which class they are, a Map
  and a Set open like anything else, and a cycle says so rather than hanging
- **LOG** beside a line from your own code is a link to the line that wrote
  it: it opens the file in the code modal and puts the caret on it. Works for
  warnings and errors too, and steps over Phaser's own frames — a
  `console.log` reached through a callback still names the line you typed

## What a project scaffolds

- A **Top Down** or **Platformer** project is laid out the way you would lay
  one out yourself:

  ```text
  index.html
  styles.css
  js/main.js              registers the scenes and starts the game
  js/game.config.json     the document, generated on every save
  js/lib/                 Phaser and psd-to-phaser
  js/scenes/index.js      the scene list, written by the editor
  js/scenes/Scene1.js     one per scene, named after it — and yours
  js/shared/canvas.js     the document, drawn
  js/shared/character.js  what moves in it, and what stops it
  js/shared/grid.js       the projection, and the document's geometry
  js/shared/navigation.js A* — or physics.js, for a platformer
  js/prefabs/character.js the body, the walk and the artwork — yours
  ```

  The two files you write in are the scene and the prefab. Everything in
  `js/shared/` is the editor's: it is there to read, it has a Reset beside
  every block the editor maintains, and you can still type between them.

  `js/lib/` is the only directory that is not on your disk while you work: the
  two runtimes are 1.5 MB that would be the same in every project, so the local
  server answers for them and an export writes them in. A project made before
  this layout keeps the one it was made with — your `game/` tree is your copy —
  and plays and publishes from wherever its own `index.html` says

- **PSD to Phaser** has no `js/shared/` and no `js/prefabs/` at all — none of
  the editor's own code:

  ```text
  index.html
  styles.css
  js/main.js              loads every PSD in a Load scene, then starts yours
  js/game.config.json     the document, generated on every save
  js/lib/                 Phaser and psd-to-phaser
  js/scenes/index.js      the scene list, written by the editor
  js/scenes/Scene1.js     one per scene — and yours
  ```

  A scene places its own artwork, in `create`, the way psd-to-phaser's demos
  do — one `place` per piece, then where it stands, its size and its depth:

  ```js
  create() {
    // Place PSDs here.
    const tree = this.P2P.place(this, "tree", "tree");
    tree.setPosition(120, 80);
    tree.setScale(0.5);
    tree.setDepth(3);
  }
  ```

  `setDepth` is the draw order, counted back to front across the scene, so a
  file's layers and the files around it stack the way the canvas shows them.
  **Anything you place in Draw is placed here too, and follows Draw** until
  you edit it: its lines are added after the last ones in its scene's file as
  it is placed, and while they are exactly what the editor wrote, every change
  in Draw — moving it, resizing it, restacking it, hiding it, or removing it —
  is written into them as the document saves, whether or not the code has
  been opened. **Edit any line of that block and it is yours**: Draw stops
  moving it, and you can add, take away or change whatever you like in it.
  Only the block the editor placed follows Draw — a second `place` of the same
  layer, dragged in or typed, is yours from the start. Where a block of yours
  no longer stands where Draw has it, the sidebar says so (below)
- **The camera starts centred on the world's origin** —
  `this.cameras.main.centerOn(0, 0)` at the top of each scene's `create` — so
  what you laid out inside Draw's dashed screen boundary is what the game opens
  on, at a fixed Page Setup size as much as at the window's. A scene file
  written before that line existed has the origin at the screen's top-left
  instead: add the line, or rewrite the scene with Project Options' Change…
  (its old version goes to `Backups/`)
- **A background layer's colours and gradients are written as Phaser's own
  Graphics**, since they are not PSDs and psd-to-phaser has nothing to place:

  ```js
  const sky = this.add.graphics().setScrollFactor(0).setDepth(1);
  sky.fillGradientStyle(0x87ceeb, 0x87ceeb, 0xffffff, 0xffffff, 1, 1, 1, 1);
  sky.fillRect(0, 0, this.scale.width, this.scale.height);
  ```

  Held still against the camera and the size of the screen, under the
  artwork on their layer — the way Draw draws them. They are written in as
  they are added, like placements, and drag in from the sidebar the same way.
  An image backdrop is a PSD placed on the layer and is written as one. Fills
  and pattern layers are not drawn by this scaffold; a Game draws them

- **Phaser** is Vanilla with Phaser on the page: `index.html`, `style.css`,
  `script.js` with a running game in it, and `game.config.json`. No
  psd-to-phaser and nothing loaded — the PNGs psd-to-json wrote are in
  `assets/` for Phaser's own loader

- **Vanilla** is four files and no Phaser:

  ```text
  index.html
  style.css
  script.js
  game.config.json        the document, generated on every save
  ```

  The config is at the root here because there is no `js/` for it to sit
  under, and `script.js` fetches it — that is the one line in there doing
  anything. Everything else is a blank page. There is no Page Setup on a
  vanilla project, because the page it would describe is this `index.html`,
  and that file is yours from the moment it is written

- **Every scaffold gets the same `assets/`.** Importing a PSD writes its output
  beside `game/` rather than inside it, so what you picked on the New Project
  sheet decides the code around your artwork and never the artwork. A
  published site carries the assets either way; a Phaser one carries Phaser
  and not the plugin, and a vanilla one neither

## Dragging placement code out of the sidebar

- In a **PSD to Phaser** project, Code's sidebar is a source of code as well
  as a list of names. Pick up a **layer**, a **placed PSD** or a **layer inside
  one** by dragging it sideways, let go anywhere over the canvas area or the
  code panel, and the lines that place it are written into the open file **at
  the caret** — a whole layer's worth, a whole file's, or one layer's. Up and
  down the column is still a scroll
- Where the lines go is the caret, not where you let go: on a blank line they
  take its place, anywhere else they go on the lines after it, indented to
  match. A caret outside `create` writes them outside `create`, so put it
  where the code belongs first
- The names are taken from the layers and never clash with one the file
  already declares — a second tree is `tree2`. The depth is the one it would
  have among everything else in the scene, so a dragged layer stacks where
  the canvas draws it
- **A drop saves the file**, so the game beside it restarts with the new lines
  in it straight away

## Where the code and the canvas disagree

- A placed PSD, or a layer inside one, whose block you have edited and whose
  position, scale, depth or visibility no longer matches Draw carries a
  **reset** (the circular arrow) at the end of its row in Code's sidebar.
  Pressing it writes Draw's values into those lines — any lines you added to
  the block stay — saves, and **links the block to Draw again**, so it follows
  Draw from then on until you next edit it
- **Draw shows them too.** A placed PSD whose block is yours and no longer
  matches Draw carries a **broken link** at the right-hand end of its row in
  the layer list, after its size, and beside its top right-hand corner on the
  canvas. Pressing either opens Code at the line that places it
- Which blocks follow Draw is remembered with the project, beside its
  document rather than in the code, so the code reads as psd-to-phaser and
  nothing else. Blocks written by an earlier version are taken on the first
  time a project opens: one still made only of the lines the editor writes
  follows Draw, and one with anything added to it is treated as yours

## Renaming a PSD or a layer renames it in the code

- **Rename a PSD** — in the sidebar or the properties panel — or **a layer
  inside one** in the properties panel's layer list, and every `.js` file in
  the project is rewritten where it names that file or that layer. On any
  scaffold, and however the code is written:
  - the key in any psd-to-phaser call — `this.P2P.place(this, "tree", …)`,
    `getTexture`, `getData`, split over lines or not — a `key:` handed to
    `loadMultiple`, a path into `assets/tree/`, and a texture key made from the
    file, `"tree_trunk"`
  - a layer's name in the path of a call on that file, in the path handed to
    `.target(…)` or `.remove(…)` on something placed from it, and at the end
    of its texture key
  - either one held in a name first — `const KEY = "tree";` used as
    `this.P2P.place(this, KEY, …)` — at the line that names it
- The same word anywhere else is left alone: `"tree"` as a scene's key, a
  label or a log line is not the file, and comments are not touched. Nor is
  `Backups/`. The console lists the files that changed, and a running game
  restarts on them

## Dragging a sprite by its `setPosition` or `setScale`

- **With the caret inside a `setScale(…)`** the same sprite is outlined with a
  handle on its far corner, and dragging it scales it about its top-left
  corner — the point psd-to-phaser places a sprite by. `setScale(s)` scales
  both ways by how far the pointer moves from that corner; `setScale(x, y)`
  takes each axis on its own. The call keeps the number of arguments it had
- **Put the caret inside a `setPosition(…)`** and the sprite that call places
  is outlined in the running game. Drag it there: the numbers in the call
  follow it as it moves, and letting go saves the file. Move the caret out of
  the call and the sprite is let go

## Page Setup

- On a **print project** Page Setup is the sheet of paper instead — its size,
  its orientation, and the resolution, reported. The rest
  of this section is about a game's page. See [Printing](printing.md)

- **Page Setup**, beside Project Options in the menu — on a Game and on PSD to
  Phaser, but not on Phaser or Vanilla, which have no scaffolded page for it to
  describe — is the HTML and
  CSS *around* the game rather than the game. Six settings: a **fixed size** with a
  width and a height — or the window, which is what every project has done until
  now — **centered** or top left, a **margin**, a **corner radius**, and the
  **page color** behind it all. That last one is the HTML background, not
  Phaser's own: they are only both visible once one of the other three has
  pulled the game back from an edge, which is exactly when you want to pick them
  separately — and why they start out different. The world keeps the pale blue
  it has always had; the page behind it is a neutral dark, the way a video
  player mats a picture. A frame the same color as the sky just reads as the
  world carrying on past its own border. A 320×568 phone game is a 320×568 game on a desktop now instead of
  one stretched across it. None of it rewrites a line of your `styles.css`: the
  values ride in the generated config, `js/main.js` puts them on the document as
  custom properties, and every rule in the stylesheet reads one with a fallback
  — so a rule you change stays changed, and deleting the block gives you back
  exactly the page the scaffold always wrote. There is no preview on the canvas,
  because the canvas is a world rather than a page; with **Play** up the sheet is
  its own preview, since it restarts a running game the way saving code does
