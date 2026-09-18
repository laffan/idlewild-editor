# What is not built yet

Idlewild is a first vertical slice: everything in the rest of this manual runs
end to end, and what is below is wired to real slots rather than mocked. This
is the list of what is missing, what is narrower than it looks, and what is a
trade rather than an oversight.

The technical counterpart is
[Known gaps](../Docs/known-gaps.md), which says *why* for each one.

Part of [the Idlewild manual](README.md).

---

- A note that wraps. Text is lines you typed rather than a box the words flow
  into, which is right for a label and wrong for a paragraph — and a wrap width
  is a fourth number on the record and a handle on the canvas to drag it by
- Groups inside groups. A group is flat: a unit is in one of them and a group
  holds no groups. Nesting costs a tree in the panel, a path in the selection
  and a decision about what a double tap means at each level, and none of that
  is worth guessing at before the flat version has been lived with
- Hush's blit-forward re-anchor, so panning a stroke-heavy layer past the
  drawing backing's edge slides its pixels instead of re-baking them
- A flat top-down project sorts nothing on Y, so its character draws in front
  of everything. The machinery is the isometric one and the missing half is a
  reading of the row that a square grid's placements agree with
- A pattern layer on the minimap. Its placements are a palette standing
  nowhere and the pattern made of them has no edges to frame, so the map
  skips it rather than showing a heap of elements on one space
- Pattern fills rendering their PSD texture rather than a tint. (A fill made
  of a *library* pattern or shape does draw — see above. This is the other
  sense of the word: a patch whose texture comes from a PSD in the project)
- A **combination** editor, which is the one thing
  [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator)
  has that this does not: a shape spanning several tiles, with a pattern per
  path. The pieces are all here — the shapes, the patterns, the lattice — and
  what is missing is the editor and a place for a multi-tile stamp to live
- Arcs in an imported SVG. `A` comes through as a straight line to its
  endpoint rather than as a curve, which is honest but lossy
- Phaser-aware autocomplete in the code modal, and the other direction of the
  canvas ↔ code binding: the canvas drives the code today, through the config
  the editor writes, and code does not yet drive the canvas
- Play starting from the camera the editor is looking through, rather than
  where the project's own scene opens
- One Phaser scene per Idlewild scene in the exported game, with transitions
  between them — today the template places the open one
- Sloped ground for the platformer: a blocking boundary is currently taken as
  its bounding box
- True rsync, rather than SFTP with a manifest beside it. A changed file is
  sent whole rather than as a diff against what is already there. The sending
  half of rsync's wire protocol is not published as a library by anyone and is
  defined by rsync's own source rather than a specification, so it is a project
  rather than a dependency
- The system keychain for the GitHub token and the ssh key. Both are in a file
  only you can read, beside the projects; Keychain and its iOS counterpart are
  a dependency and a platform pair that have not been taken on yet
- Opening a `.idlewild` straight from Files or the Finder — the format is
  real, but it is not declared to the system and nothing handles a file the OS
  hands the app
