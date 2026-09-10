# Idlewild

A game editor and publisher for iPad and macOS, built around
[psd-to-phaser](https://github.com/laffan/psd-to-phaser). Start from a prefab
template, then build by drawing directly in the editor and importing images.

Tauri 2 (Rust) + Phaser 4 + TypeScript, no frontend framework.

## What it is

Idlewild is a prototyping environment. You pick a template — isometric or
orthogonal — and get a light blue, effectively infinite grid you build on with
your fingers: hold to select a run of spaces, fill them, drop images into them,
export a patch as a transparent PNG. Every image that enters, including a
pasted PNG, becomes a PSD and goes through
[psd-to-json](https://github.com/laffan/psd-to-json-rust), so the
psd-to-phaser integration is uniform: a screenshot and a hand-built Photoshop
document arrive at the runtime the same way.

Publishing hands you a zipped, runnable project. Direct publishing to a web
server over rsync is planned and explicitly out of scope for now.

## Status

This is the first vertical slice — everything below runs end to end, and the
remaining pieces are wired to real slots rather than mocked.

**Working**

- Project list with thumbnails, long-press rename / duplicate / delete
- New Game: template (isometric, orthogonal) and grid scale (32–256 px)
- A full-width header carrying the project and the Edit/Play toggle, with
  Code, Publish and Project Options behind its menu
- Infinite grid, one-finger pan, two-finger zoom, hold-to-select, tap-to-pick
- Fill a selection with any colour, from a full picker with recent swatches
- Drag placed images and fills, snapped to the grid; resize images from
  their corner handles, or freely from the inspector
- Resizable sidebars and console drawer, persisted per install
- Add Image from Files, Photos or the clipboard → PSD → psd-to-json → placed,
  at half size because everything drawn on a retina machine is 2×
- Every import carries its grid space into the PSD as two marks a game never
  sees: a red dot on the space it is anchored to, and the outline of the
  selection it was dropped into. Move the dot in Photoshop and the artwork
  re-anchors to it — which is how you make something stand on its tile
- Layers: drag by the grip to reorder, rename, lock, hide, with live counts
  and an expandable list of what is on each one — selecting there selects on
  the canvas
- Draw on any layer with Hush's stroke engine: five brushes, pressure and
  Apple Pencil, a slice eraser, and a lasso. Fingers never draw — they pan
  and pinch the game camera, so a hand can rest on the glass
- Hand a lassoed sketch to its layer as a PSD to flesh out elsewhere, or as
  a blocking boundary play mode walks around
- Inspector for layers, selections, fills, placed images and boundaries
- Option-drag a fill or an image to copy it. A copied image references the
  same PSD, which the inspector says so you know editing one edits both —
  and Remove Reference gives it a copy of its own. Option-shift-drag skips
  the step: the copy comes out independent
- The selected PSD's own layer stack, in the inspector: drag by the grip to
  reorder it, rename in place, then Apply to rewrite the file and re-run the
  pipeline. Renaming is how a sprite becomes a tileset, so it is worth having
  without a trip to Photoshop. A PSD with groups, masks or clipping is listed
  read-only, because a rewrite would flatten them
- Convert a fill to a PSD, the same way a sketch converts
- Delete removes whatever is selected
- Export a selection as a transparent PNG (save or copy)
- Edit a placed PSD outside the app and bring it back: Open PSD hands the file
  to the system editor on macOS and to the share sheet on iPadOS, Re-import
  PSD replaces it under the same key and re-runs the pipeline
- Play mode: a character, a following camera, tap-to-walk over A*
- Code modal: the project's real file tree in CodeMirror 6, full-screen or
  pinned above the console. New file and folder, rename, duplicate, delete,
  and drag files between folders, in a column with a divider of its own
- Console drawer in Fira Code — selectable, `%c`-aware — fed by the page and
  by psd-to-json's own progress
- Publish: a zipped project carrying both runtimes

**Next**

- Hush's blit-forward re-anchor, so panning a stroke-heavy layer past the
  drawing backing's edge slides its pixels instead of re-baking them
- Undo, which the drawing layer wants first and the rest of the editor
  wants too
- Pattern fills rendering their PSD texture rather than a tint
- Phaser-aware autocomplete in the code modal, and canvas ↔ code binding
- rsync publish targets

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
