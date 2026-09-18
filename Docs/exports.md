# Exports, imports and the home screen

The three exits that hand you a file, the two doors back in, the platform
difference that made every one of them write an empty file on an iPad, and the
bulk-selection mode on the project list.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Three exits

Three *files*, that is. Publishing to a server or to GitHub is a fourth way out
and is not one of these, because nothing is handed over — see
[Publishing somewhere real](publishing.md). These three answer different questions, and the
differences are the source PSDs and whether what comes out is a program at all.

| | Carries | For |
|---|---|---|
| **Export site** (`.zip`) | `game/`, processed `assets/`, both runtimes, a generated config | Serving. Nothing in it is what you would edit the project with |
| **Export project** (`.idlewild`) | the manifest, `doc.json`, `thumbnail.png`, `psd/`, `assets/`, `game/` | Opening somewhere else and carrying on |
| **Export Assets** (`.zip`) | the chosen keys' `psd/<key>.psd`, `assets/<key>/…`, or both | Taking the artwork somewhere that is not a game |

A published site cannot give back the file a sprite was drawn in. That is the
whole reason the second format exists, and why `psd/` is in one and not the
other.

There are two ways **in**, and they are not exits turned round. **Import**, on
the home screen, reads a `.idlewild` back as a project of its own, which is what
makes the second row a round trip; **Import Assets** brings artwork into the
project you are in, off the filesystem or out of another project in this store —
see [Import Assets, which is that door inward](#import-assets-which-is-that-door-inward). Nothing reads an Export Assets
zip back: what is in one is `psd/<key>.psd` and `assets/<key>/…` under a
project's own name, and a person who has one of those has files a picker can
already reach. The first of the two was called **Open** for as long as it
existed, and [Where it is in the app](#where-it-is-in-the-app) below is why it is not any more.

Two of the three exits write a `.zip` and neither round-trips, which is a
sentence this documentation could say and the app could not. Both are now
recognised on the way in and **named** — see [A zip that is not a backup](#a-zip-that-is-not-a-backup).

All three are written straight to a path by Rust — `publish::publish_site`,
`archive::export_project`, `export_assets::export_assets_zip`, each living with
the code that builds it the way `game_files`'s commands do. The site export used
to come back across the IPC boundary as base64 and be written by `save_bytes`;
an archive carrying every processed asset — let alone every source PSD — has no
business being a string in a JSON message first.

*Which* path, though, is a platform question rather than a settled one, and
getting it wrong wrote an empty file on every iPad. See
[Leaving with a file, and the order iOS needs](#leaving-with-a-file-and-the-order-ios-needs),
below.

### Export Assets, and why it is a row under Export

The other two hand back something only a program can read. What was missing is
the pictures: the sprite sheets a tileset was sliced into, for another engine or
a document, and the source PSDs, so a file drawn on an iPad opens on a desktop.

It stood on the header menu in its own right for a while, which was right when
the alternative was putting it *inside* Publish — nothing about it runs, and it
is not a publish. With Publish and Export split into two verbs it is simply the
third row under Export, beside the site zip and the project file: all three hand
you a file, and having two of the three in one place and the third somewhere
else was the arrangement nobody could have explained.

So the sheet asks two questions and nothing else. **Which files**, as a list with
a checkbox each, everything ticked to begin with because "all of them" is the
common answer and un-ticking three is less work than ticking twelve. And **what of
them** — assets, PSDs, or both — as one segmented control rather than two
checkboxes, because two boxes let somebody tick neither and find out at the far
end of a save dialog.

It lists what is in `psd/` rather than what the document places
(`export_assets::list`). A file whose placement has been deleted is still a file
somebody drew, and artwork is the one thing this export exists to rescue; the
document's own list would quietly refuse to hand back the only copy of it. A file
the pipeline has never run over says so on its row, because it has no generated
half to give.

Inside the archive the paths are **the store's own** — `psd/<key>.psd` and
`assets/<key>/…` under the project's sanitised name — because that layout is
already described everywhere else in this app and a second one invented for the
zip would be a second thing to learn.

A key the project has not got is **skipped**, not failed on: the list came from a
picker, so the only way to ask for a missing one is to have deleted it between
opening the sheet and pressing the button, and losing the other nine files to
that is not a trade worth making. What *is* refused is an archive that would come
out empty — neither half chosen, no files chosen, or every chosen key missing —
because a zip somebody has to open to discover was empty is worse than one that
did not happen.

### The format

```text
<name>.idlewild            (a zip)
  idlewild.json            format, app version, exportedAt, and the project's own fields
  doc.json                 layers, fills, placements, zones, strokes, extrusions
  thumbnail.png            if one has been taken
  psd/                     the source files
  assets/                  psd-to-json's output, so an import opens without a re-parse
  game/                    the project's own code, as it was edited
```

**Extrusions travel in `doc.json`**, and so do every scene and the one that
was open. `GameDoc.extrusions` maps a PSD key to the voxels its solid was
built from and the space it was anchored to — document-level, because a PSD
is the project's rather than a scene's — and an extruded layer's way back into
extrude mode is that record plus the PSD it wrote — the cube in the inspector's layer list, and the shape that opens when
you click it. Both halves are in the archive, and the map is keyed by *file
stem* rather than by anything about this install, so a re-opened project can
still take hold of a face and pull it. `tests/archive.rs` pins that, because a
project that came back without them would look entirely fine right up until
someone tried.

**`meta.json` does not travel.** A project's id is a directory name in *this*
store; carrying one across would be a second source of truth for where a
project lives. The fields worth keeping are in the manifest and an import
writes a fresh `meta.json` around them — new id, the original `createdAt`,
`updatedAt` of now, since the home screen sorts by it and an import you just
made should be the one at the top.

**A format number, not a guess.** An archive from a later build is refused by
name rather than half-read: one that silently dropped what it did not
understand would look like a project that had lost work.

### An archive is a file someone hands you

`CARRIED_DIRS` and `CARRIED_FILES` are read in both directions — an export
puts nothing else in, an import takes nothing else out — and that second half
is the guard. On the way in, every entry goes through the zip crate's
`enclosed_name` (which refuses absolute paths and `..`) *and* that allowlist,
so the five things an archive is allowed to be made of are the five things it
can write. There are ceilings on entry count and unpacked bytes for the same
reason. A hostile zip is a test rather than an assumption
(`an_archive_cannot_write_outside_the_project_it_claims_to_be`).

An import that fails partway removes the directory it was filling: a
half-written project in the list is worse than a failed import. A `game/` tree
that did not arrive is scaffolded, and the config is rebuilt from the document
that did — so an archive assembled by hand still opens.

### Where it is in the app

**Import**, on the home screen beside New Project. The picker is unfiltered on a
touch device and filtered on a desktop, the same split as the editor's Add
Image and for the same reason: iPadOS reads the filter list to decide *which
picker* to show, and an extension it has never heard of is not a reliable way
to ask for the document browser.

**It was called Open, and that was the wrong word.** The button and the command
behind it have existed since the archive format did; what had not happened was
anybody finding them. A grid of project cards is a screen whose entire subject
is opening things, so *Open* beside *Select* and *New Project* reads as "open
one of these", and the one door on the screen that takes a file was the one
nobody saw. The word people go looking for is *Import*, and it pairs with the
editor's own **Import Assets** rather than competing with the cards: one brings
a project in, the other brings artwork into the project you are in. Nothing
underneath it changed — same command, same guard, same tests.

**The desktop filter takes `.zip` too**, because a `.idlewild` *is* a zip and
the extension is this app's private name for one. Nothing on a machine knows
that name, so a backup that has been through mail, a chat client, a download or
somebody's own Compress arrives as `.zip` — and a file the picker will not show
is a backup that has been lost as surely as if it were deleted. Nothing is
loosened by it: `import` has always decided what a file is by looking for a
manifest at its root, never by its extension, so the filter was the only thing
refusing those and it was refusing them for a reason that was never true. The
touch picker is unfiltered and was never affected either way.

`.idlewild` is not declared as a system file type. Doing so without wiring the
open would put Idlewild in macOS's "Open with" for a file it then ignores; the
declaration and the `RunEvent::Opened` / deep-link handling behind it belong
together, and neither has been exercised on either platform yet.

### A zip that is not a backup

"This file has no idlewild.json — it is not an Idlewild project" is true, and it
is no help at all to the person most likely to read it. Export writes three
files and **two of them are zips**; only the middle row comes back. Somebody who
picked *Site* a week ago, called it a backup and is now holding it in front of
the importer is being told their backup is broken, when what happened is that
they exported the other thing.

So a zip with no manifest is **told apart by its shape and named**. Both of the
others unpack into one directory called after the project, so the first path
segment is dropped before anything is read; `.idlewild` has no such wrapper,
which is the same fact that puts its manifest at the root. A site is
`index.html` or `js/game.config.json` — tested **first**, because a site carries
`assets/` too and would otherwise answer to the test below it. An assets export
is `psd/` or `assets/` and nothing that runs. Anything else keeps the old
sentence, because a zip this app did not write is a zip nothing here can name.

Each answer says which of the three the file is, and points at the row that does
open — *Export → Project* for both, plus *Import Assets* for the artwork one,
which is where those files were actually going. `not_a_project` is the whole of
it, and two tests pin the two shapes; a message that drifted off the sheet's own
wording would send somebody looking for a menu item that is not there.

A site is **not** made importable by any of this, and could not be: it has no
`psd/` and no `doc.json`, so there is no project in it to rebuild. Pretending
otherwise — importing one as an empty project named after it, say — would hand
back something that looked like a recovered backup and was not, which is worse
than a refusal that explains itself.

---

## Leaving with a file, and the order iOS needs

Every exit that hands you a file was written the same way — ask the save
dialog where, then write there — and on an iPad every one of them wrote a
**0-byte file**. The zip, the `.idlewild`, the assets zip, a PSD copy, a
pattern, a shape, an exported selection: all of them, every time, on one
platform, with nothing said about it anywhere the person could see.

The cause is that **iOS has no save dialog**, and the shape of the thing it
has instead is the whole bug.

`UIDocumentPickerViewController(url:in:.exportToService)` answers one
question: *copy **this file** to somewhere the person picks*. There is no API
on iOS that answers *give me a path I may write to later* — that is what a
sandbox is for. So tauri-plugin-dialog fakes one. Its `saveFileDialog` creates
an **empty** file at `<app Documents>/<fileName>`, hands that to the export
picker, and returns the URL the copy landed at, with a comment saying the file
contents "must be actually provided by the tauri dev after the path is
resolved".

Except they may not be. The URL that comes back names a file in *another
process's container* — iCloud Drive's, a file provider's, another app's On My
iPad folder — and reaching it needs a security-scoped resource this app was
never handed. `std::fs::write` there fails. What the person finds in Files is
the empty placeholder the picker had already copied, which is exactly as large
as the export they asked for was not.

**The fix is to build the file where the picker is already going to look.**
The plugin only writes its placeholder `if !fileManager.fileExists`, so a file
already sitting at `<Documents>/<fileName>` is left alone and exported as it
stands. Nothing is ever written outside the sandbox, iOS does the copy itself
with rights this app does not have, and the destination never has to be
readable or writable from here at all.

That inverts the order of the two steps, on iOS and only on iOS:

```text
macOS   ask where  →  build the file there
iPadOS  build the file here  →  ask where  →  iOS copies it
```

### Where both orders live

`lib/save-as.ts`. `saveAs` takes a file name, a filter, a name for the console
and a `write(path)`, and calls `write` with a path that is correct on the
platform it is running on. No exit knows which order it is in, which is the
point: seven ways out were written across six call sites, and the bug was in
every one of them because it was in the shape they shared.

`save_staging.rs` is the Rust half, and it is two commands.

| | |
|---|---|
| `save_staging(fileName)` | `Some(path)` on iOS, `None` everywhere else. Clears a stale file at that path first — a crash between building and exporting would otherwise export the *last* file under this one's name, which is the same silent wrong answer by another route |
| `save_staged_done(path)` | Measures the staged file, then clears it. Called whether the picker was used or backed out of: a cancelled export has still built a file, and a project zip left in `Documents` until the next one is tens of megabytes of nothing |

`None` off iOS is what keeps the ordinary order honest rather than making
every platform pay for one. On a Mac the dialog names a destination the app
may write to — it widened the sandbox to say so — and building somewhere else
first would be a copy for its own sake and a second place for an export to go
wrong. Android gets `None` too, and deliberately: its half of the plugin
resolves a `content://` URI through the Storage Access Framework, which the
app *is* granted write access to, so the ordinary order is already correct
there. This is an iOS-shaped problem and it gets an iOS-shaped answer.

### Where `<Documents>` is, from Rust

The plugin asks Foundation for `.documentDirectory` in `.userDomainMask`,
which on iOS is `$HOME/Documents` with `$HOME` the app's container.
`dirs::document_dir()` compiles to `home_dir().map(|h| h.join("Documents"))`
on any Apple target — `dirs` gates its `mac` module on
`any(target_os = "macos", target_os = "ios")` — and its `home_dir()` reads
`$HOME`, which is the container the OS set. The same directory, by the same
rule, approached from the other side.

The project store is under `dirs::data_dir()`, which is
`$HOME/Library/Application Support`, so nothing staged here can collide with a
project. And `staging_path` refuses anything that is not a bare file name — a
separator or a `..` would put the staged file somewhere the picker does not
look, which is the 0-byte export all over again.

### What the console can honestly say

"I have no visibility into why this is happening" was the whole experience of
this bug, and it is worth being precise about why. The destination is in
another process's container; it cannot be stat'd from here any more than it
could be written to. So the app cannot report the size of the file that
arrived.

What it *can* report is the size of the file iOS was handed, measured just
before it is cleared — and that is the size that arrives, because the copy is
iOS's own and either happens or is reported as a failure by the picker. So an
export now logs `Exported site → <destination> (4.2 MB)`, and an export that
built nothing says **that**, out loud, as a warning, rather than leaving it to
be discovered in Files a week later.

### What moves, and what it costs

The delay moves. Building before the picker means a large project spends its
seconds before the picker appears rather than after it closes, and the console
says which file is being built so the wait is something happening rather than
nothing. There is no arrangement in which a zip is both built after the
question and written where the answer points; that is the trade, and it is the
platform's rather than this app's.

One consequence worth knowing: a cancelled export on an iPad has still done
the work. `save_staged_done` runs either way, so nothing is left behind, but
the seconds were spent.

---

## Import Assets, which is that door inward

Export Assets hands the artwork back. What was missing is the same door the
other way for **more than one file**: Add Image asks for a file, a paste carries
one, a drop lands one, so a tileset drawn as nine PSDs in another project was
nine trips through a picker. So it is a menu item beside Export Assets — neither
is a publish, and both are about pictures rather than about a program.

**Two routes, and they are the two that are not already served.** *Files* is the
filesystem, with `multiple: true`; *another project* is the rest of this app's
store. The photo library and the clipboard are deliberately absent: both are one
image at a time by their nature, and both already have a route of their own in
Add Image and in ⌘V, which is where anybody looks for them.

The sheet is a **list of routes** rather than a form, the way Add Image, Publish
and Re-parse are, because what somebody came here to say is *where from* and each
answer needs something different next. Files needs a picker and nothing else; a
project needs a project and a set of ticks, so that route opens two more steps in
the same sheet. The project list leaves *this* project out rather than greying it
in: copying a file over itself is not what this is for, and a second copy inside
one project already has a route in **Make Unique**, which gives it a name that
reads as a copy of what it came from.

**Neither route is a new import.** A file off the filesystem goes through the
*paste* path — `read_dropped_file` for the bytes, then `importPasted` — and a
PSD out of another project is copied inside the store by
`import_psd_from_project` and placed. Two things follow from that, and both are
the point. Going through the paste path is what gets the **two orienting marks**
written: they describe where the artwork sits on the grid, and the grid is the
editor's, so a file imported by path arrives with no anchor and says *No anchor*
in the inspector ever after. And a PSD copied between projects needs no marks at
all, because it is already carrying its own — the same reason a `.psd` from Files
is copied rather than rewritten.

The cost of the first is that a padded raster is **cropped** to the pixels in it,
as a drop is and as Add Image is not. A drop off Finder is the same file arriving
by another gesture and it is cropped too, so this sides with the gesture rather
than with the sheet. See *A paste is cropped to the picture in it*.

**Nothing is written over.** Everywhere else a name decides a key outright, which
is what makes bringing `roof.png` home a replacement rather than a second copy.
Here a collision is two files that happen to share a name, and quietly writing
one over the other is the one outcome nobody could have asked for — so
`psd_pipeline::free_key` steps to `roof-2`. It is asked for over the bridge
rather than worked out in the frontend, because the rule for what survives being
a filename is `sanitise_stem`'s and a second copy of it on this side would be a
second answer. `next_free_key` beside it is the same question with a different
answer for **Make Unique**: `roof-copy`, a name somebody can follow back.

**Nothing lands on top of anything else.** Twelve files on the space in the
middle of the view would look like one file, so `importAll` steps each one clear
of the last — by the width of what actually landed plus a grid space, in **world
pixels**, converted back to a cell. World pixels rather than a step in `cx`
because on a diamond grid stepping `cx` walks away from the camera rather than
across the screen. A file that failed to import does not move the cursor: there
is nothing standing there to step around. They go one at a time, which the
pipeline would enforce anyway (`psd_pipeline::exclusive`), and each import's own
width is what decides where the next one goes.

**What a copy between projects does not carry** is the *document's* record of the
file: an extruded PSD arrives as its artwork without the solid behind it, and a
hand-edited collider arrives as the default guessed from the footprint. Both live
in the other project's `doc.json`, which is about a canvas rather than about a
file — and the export that does carry them is `.idlewild`, which brings the whole
project rather than one PSD out of it.

The menu's own wiring moved to `editor/header-wiring.ts` with this, the way the
properties sidebar's lives in `inspect-wiring.ts`: two more destinations put
`editor.ts` over the 700-line rule, and a header that only forwards is exactly
the shape that split is for.

---

## Select, on the home screen

Rename, duplicate and delete have always been a card's long-press menu, one card
at a time. That is right for rename, which is about one thing by definition, and
wrong for the other two the moment there is a shelf of experiments: clearing out
six was six long presses and six confirmations, and the confirmation is the part
that makes it feel like six separate decisions rather than one.

**It is a mode of the grid, not a modifier on a press.** There is no ⌘-click on an
iPad and no rubber band over a grid of cards, so the honest shape is a switch:
while it is on, a tap picks a card instead of opening it, every card carries a box
in the corner of its thumbnail, and the long-press menu stands down. The row that
normally says how to reach that menu carries All, None, the tally, Duplicate,
Delete and Done — the *same strip of screen* either way, so turning the mode on
does not move the cards under the finger that turned it on. The tick and the
disabled buttons are drawn rather than hidden for the same reason.

The mode is read at press time, not captured when a card is built: the grid is
rebuilt on every reload, and a handler that closed over the mode would be a card
built in one mode and pressed in another. Leaving the mode drops what was picked,
because a selection held over no way to see it is a selection that acts on the
next press somebody makes; a reload drops the ids of projects that have gone,
however they went.

`home-select.ts` is the two bulk actions, and both are **sequential**.
Duplicating a project copies its source PSDs and its processed assets, and six of
those at once is six concurrent walks of the same store. A failure part-way
through does not abandon the rest — five copied and one refused is a better answer
than one copied and five silently dropped, which is what a `Promise.all` would
give — and the console says how many landed rather than one line per copy, which
would be the shape of the loop rather than of what was asked for.

A bulk delete **asks once**. It names the projects while the list is short enough
to read and counts them when it is not: "these 14 projects" is a number somebody
can check, and fourteen titles is a wall nobody reads. Declining is answered
differently from deleting nothing — `null` rather than `0` — because the home
screen has to tell "you said no" from "all six failed": the first keeps the
selection lit for another try, and the second has nothing left to keep.
