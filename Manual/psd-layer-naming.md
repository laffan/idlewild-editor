# PSD layer naming

psd-to-json decides what a layer *is* from its name, and everything
downstream — the editor's placement, the collider, the exported game — follows
from that. A layer named outside the convention is not an error; it is simply
not recognised, and nothing loads it.

This matters when you bring a file in from Photoshop. Anything Idlewild writes
is named correctly already.

Part of [the Idlewild manual](README.md).

---

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
An image background is written as `T | Background` holding `S | background`,
so the runtime loads it a tile at a time as the camera reaches each piece.

`P | anchor` is the one layer an object layer insists on: without it a file
placed on the grid has nothing to line up on when it comes home from
Photoshop, and its row says so.
