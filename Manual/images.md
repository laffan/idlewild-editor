# Getting images in

The four doors artwork comes through, what happens to it on the way, and the
way back out to edit a file somewhere else.

Part of [the Idlewild manual](README.md).

---

## The doors

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

## What a paste is

- **A paste is cropped to the picture in it.** Copy a patch out of Photoshop
  or Procreate and what reaches the clipboard is a PNG the size of the
  *document* it came from, with the copied marks somewhere inside it and
  nothing but transparency around them. That is right for pasting back into
  the same document and wrong here: the padding became the artwork's size, so
  a thumbnail-sized sketch arrived claiming a footprint the size of somebody
  else's canvas, with its handles nowhere near the picture. The transparent
  field is taken off before the import, so what lands on the grid is what was
  copied — and nothing is thresholded away, so the soft edge of a brush stroke
  comes across intact. It applies to a drop and to Paste from clipboard, and
  deliberately **not** to replacing a PSD that is already in the project: a
  file coming back is held where it is rather than re-centred, and cropping
  one would slide the artwork out from under everything standing on it
- **And copy one back out, with ⌘C.** Pasting a PSD worked from the start and
  copying one did not, so files only ever travelled one way: into a project and
  never out of it. Select a placed PSD, press ⌘C — or Copy PSD in the menu,
  which is the iPad's route — open another project and ⌘V, and the file is
  there. What goes on the clipboard is the PSD itself rather than a picture of
  it, so what arrives is the layer stack somebody drew, under its own name:
  `tower`, not `pasted-m2k9f1`. On a Mac the bytes go on beside the file, so the
  same ⌘C pastes into Photoshop as a document. A ⌘C with text selected, or with
  the caret in a field, is still a copy of the text

## Every image becomes a PSD

- **Two PSDs with a same-named layer no longer collide.** psd-to-phaser keys a
  texture on the layer's own name, so two files each holding a `S | layer 1` —
  which is what New layer calls its rows, counting within each file — were the
  same key: Phaser declines a key it already holds without saying so, one file's
  artwork was drawn for the other's, and a pattern layer scattered the object
  layer's picture. Every load now names a texture after the file it came from as
  well, in the editor and in the game a publish writes. A project made before
  this keeps its own `game/` tree, so its exported game takes the fix when you
  Reset `preload` in the code panel
- Every import carries its grid space into the PSD as two marks a game never
  sees: a red dot on the space it is anchored to, and the outline of the
  selection it was dropped into. Move the dot in Photoshop and the artwork
  re-anchors to it — which is how you make something stand on its tile. A
  file that comes back **without** the dot — flattened on save, or brought
  home through Photos as a picture — is held where it is instead of being
  re-centred on its canvas, and the console says the mark has gone
- Both marks sit at the **bottom** of the stack and arrive **turned off**.
  They are the editor's rows rather than the artist's picture, and every
  program that opens a PSD draws its flattened composite — so a finished
  import used to open with a red dot and a lattice printed over the artwork
  everywhere except in the editor that wrote it, which draws neither. The eye
  is the way back: turn the grid on to line something up, and off again. It
  costs the anchor nothing, and a rewrite hands the eye back rather than
  forcing it

## And out again

- Edit a placed PSD outside the app and bring it back: Open PSD hands the file
  to the system editor on macOS and to the share sheet on iPadOS, and
  **Re-parse** beside it runs the pipeline over the file again. On a Mac that
  is the whole of it, because the file never moved. On an iPad it asks which
  file first, and the answer at the top of the list is *this one* — the PSD in
  the project, as it stands. **That answer used to be missing on an iPad**,
  which left the platform this editor is mostly used on with no way to re-read
  a file at all: the button was called Re-import and offered only the three
  ways a replacement arrives — Files, the photo library or the clipboard, each
  written over the same key so every placement survives. Plenty changes a PSD
  in the store without a trip to Photoshop — Apply in PSD Edit mode, an
  extrusion, a layer stack rewritten in the inspector, a project opened out of
  a `.idlewild` file — and re-reading one is not something an iPad should have
  to go looking through Files for
