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
  block by block and shown in a different colour, and whatever you wrote went
  in between. The machinery is in `js/shared/` — `canvas.js` puts the document
  on screen, `character.js` wires up whatever moves in it — and a scene file is
  a short one that calls six of them and is otherwise yours, with nothing in it
  marked at all. `canvas.js` is the same file for every Phaser scaffold; what
  differs between a game seen from above and one seen from the side is the
  character, which is what `character.js` is — and a **Blank PSD to Phaser**
  project has no `character.js` at all, so its scene file calls five of the six
  and nothing moves
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
  to route around. A **Blank PSD to Phaser** project plays too, and what it
  plays is your artwork placed and nothing else; a **Vanilla** one plays its
  own page, which is whatever you have written in `script.js`
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
  between folders are on the rows. A drag carries a **ghost** of the row under
  your finger, naming the folder it would land in, and that folder's row lights
  up as you pass it — pointer events have no drag image of their own, and a
  finger drag with nothing following it looks like nothing happening
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
- **The file you were in is still there when you come back.** The panel is
  built on the way into Code and taken down on the way out, so which file it
  showed used to be decided fresh each time — by a filename no project
  scaffolded since one-per-scene has, which is also why a new project opened
  into an empty editor. It is remembered per project now, across modes and
  across launches, and a project that has never been opened in Code lands on
  its scene

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

- **Blank PSD to Phaser** is that tree with the bottom four lines gone. No
  `shared/character.js`, no `shared/navigation.js` or `physics.js`, no
  `prefabs/character.js` — the plugin is registered, every PSD is loaded, the
  document is placed, and the scene file stops there. Nothing to read past
  before you start, and nothing to delete either

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
  published site carries the assets either way; a vanilla one simply does not
  carry Phaser with them

## Page Setup

- **Page Setup**, beside Project Options in the menu — on every scaffold but
  Vanilla, which has no scaffolded page for it to describe — is the HTML and
  CSS *around* the game rather than the game. Six settings: a **fixed size** with a
  width and a height — or the window, which is what every project has done until
  now — **centred** or top left, a **margin**, a **corner radius**, and the
  **page colour** behind it all. That last one is the HTML background, not
  Phaser's own: they are only both visible once one of the other three has
  pulled the game back from an edge, which is exactly when you want to pick them
  separately — and why they start out different. The world keeps the pale blue
  it has always had; the page behind it is a neutral dark, the way a video
  player mats a picture. A frame the same colour as the sky just reads as the
  world carrying on past its own border. A 320×568 phone game is a 320×568 game on a desktop now instead of
  one stretched across it. None of it rewrites a line of your `styles.css`: the
  values ride in the generated config, `js/main.js` puts them on the document as
  custom properties, and every rule in the stylesheet reads one with a fallback
  — so a rule you change stays changed, and deleting the block gives you back
  exactly the page the scaffold always wrote. There is no preview on the canvas,
  because the canvas is a world rather than a page; with **Play** up the sheet is
  its own preview, since it restarts a running game the way saving code does
