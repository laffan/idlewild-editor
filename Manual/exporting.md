# Exporting and importing

The three exits that hand you a file, and the two doors back in.

Part of [the Idlewild manual](README.md).

---

## Three ways out

- **Export** holds the three ways out that hand you a file. **Site** is a zip you can serve: the game, its
  processed assets and both runtimes, so the exported game opens showing what
  the editor showed. **Export project** is a `.idlewild` file — the project
  itself, source PSDs and all, with the document, the processed assets and the
  code as it was edited. A published site cannot give you back the file a
  sprite was drawn in; that is what the second one is for
- **Assets**, the third row under Export, is the only exit that hands back
  artwork rather than a program. Tick the PSDs you want and
  say what of them: the assets the pipeline made — each file's `data.json` and
  the sprites and tiles beside it, which is what another engine can read — the
  source PSDs, which is what opens in Photoshop, or both. It lists what is in
  `psd/` rather than what the document places, because a file whose placement
  you deleted is still a file you drew

## And two ways back in

- **Import Assets**, beside it, is the way in for more than one file at a time.
  Add Image asks for a file, a paste carries one and a drop lands one, so a
  tileset drawn as nine PSDs somewhere else was nine trips through a picker.
  Two routes: **Files**, where you pick as many as you like, and **another
  project in this app** — choose the project, tick its PSDs, and they arrive as
  the files they are, anchor marks and all. They land in a row across the middle
  of the view rather than in a heap on one space, and nothing is written over:
  a second `roof` becomes `roof-2`, because two files that happen to share a
  name are two files rather than one coming home
- **Import**, beside New Project on the home screen, reads a `.idlewild` back in
  as a project of its own. Everything comes with it, including the solids behind
  extruded layers — so a shape you pulled on one machine is a shape you can go
  on pulling on another. It was called **Open** until recently, which was the
  wrong word on a screen already full of things to open: the way *in* for a
  backup was the one door nobody found. The picker takes `.zip` as well, because
  a `.idlewild` *is* a zip and nothing outside this app knows the name — a
  backup that went through mail, a chat client or somebody's own Compress comes
  back as `.zip` more often than not, and what a file is gets decided by reading
  its manifest rather than its extension. A zip that turns out to be a **site**
  or an **assets** export is refused *by name*, saying which of the three it is
  and which one does open here, rather than as "not an Idlewild project" —
  all three come out of the same sheet, and only one of them is a backup

## On an iPad, the file is built before the picker

A Mac asks where first and writes there. An iPad cannot: iOS has no save
dialog, only an *export* picker, which copies a file that already exists to
somewhere you choose. So on an iPad the two steps swap — Idlewild builds the
file first, then the picker appears and iOS copies it out.

What you see: tapping **Site** on a large project pauses before the picker
opens rather than after it closes, and the console says which file is being
built while you wait. Backing out of the picker still spent that time, and the
built file is cleared either way.

This is also the fix for exports arriving as 0-byte files on an iPad, which is
what happened while every exit asked first and wrote afterwards — the write
landed outside the app's sandbox and failed, and what reached Files was the
empty placeholder the picker had already copied. An export now reports its
size in the console, and one that built nothing says so.
