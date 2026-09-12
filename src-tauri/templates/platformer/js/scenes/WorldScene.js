import { createGrid } from "../shared/grid.js";
import { solidsFromDocument } from "../shared/physics.js";
// idlewild:if character
import { createCharacter } from "../prefabs/character.js";
// idlewild:end if
import config from "../game.config.json" with { type: "json" };

// The platformer template. Side-on: gravity pulls down the screen, the
// character runs and jumps, and the document's *blocking* geometry — every
// fill marked not-walkable, every blocking boundary — is the ground it stands
// on rather than an obstacle to route around. That is the whole difference
// between the two styles: the same document, read as a floor plan or as a
// cross-section.
//
// Physics is hand-rolled in physics.js rather than taken from Arcade. What a
// platformer needs from a body is an AABB sweep against a list of solids, and
// keeping it in a file of the project's own is what makes it something to
// change rather than a plugin to configure around.
//
// Nothing draws the grid: the editor's light blue lattice is scaffolding for
// building on, and a game is the thing you built.
//
// This is the program the editor's Play runs, over the project's own files.
//
// `config.layers` is the layers of the scene the editor has open, which is
// the one this places. `config.scenes` carries every scene the project has —
// id, name and layers — and `config.activeScene` says which of them
// `config.layers` mirrors, so switching to another one in your own code is a
// matter of reading its layers and placing them the same way.
//
// Lines between an `idlewild:begin` and its `idlewild:end` belong to the
// editor: they read the config it writes beside this file, and the code modal
// shows them read-only with a Reset beside each block. Everything else here is
// yours. You can still type new lines *inside* a managed block — only the
// lines the editor wrote are locked — and Reset puts that block back as it
// came, dropping whatever was added to it.
export class WorldScene extends Phaser.Scene {
  constructor() {
    super("World");
  }

  // idlewild:begin preload
  preload() {
    this.grid = createGrid(config.projection, config.grid);
    for (const key of config.psdKeys ?? []) {
      this.P2P.load.load(this, key, `assets/${key}`);
    }
  }
  // idlewild:end preload

  create() {
    this.solids = solidsFromDocument(this.grid, config.layers ?? []);
    this.applyCamera();
    this.placeDocument();
    // idlewild:if character
    this.spawnCharacter();
    // idlewild:end if
  }

  update(_time, delta) {
    // Nothing to step in a project that scaffolded no character, and nothing
    // to step before `create` has run.
    if (this.character) this.character.step(delta);
  }

  /**
   * The camera the project opens at.
   *
   * `config.zoom` is the default zoom from Project Options, and
   * `config.roundPixels` the other half of pixel-perfect rendering — the
   * renderer is told about it in main.js, and the camera has to be told too
   * or a fractional scroll still smears what it draws.
   */
  // idlewild:begin applyCamera
  applyCamera() {
    this.cameras.main.setZoom(config.zoom ?? 1);
    this.cameras.main.roundPixels = config.roundPixels === true;
  }
  // idlewild:end applyCamera

  // idlewild:begin placeDocument
  placeDocument() {
    const layers = config.layers ?? [];
    layers.forEach((layer, index) => {
      const depth = layers.length - index;
      if (layer.visible === false) return;

      for (const fill of layer.fills ?? []) this.paintFill(fill, depth);
      // Back to front, once for the whole layer. Seen from the side nothing
      // sorts on Y — a cross-section has no nearer and further — so this is
      // the order things were placed in, with each PSD's own stack inside it.
      const order = drawOrder(layer.placements ?? [], false);
      order.forEach((placement, step) => {
        const object = this.P2P.place(this, placement.psdKey, placement.layerPath);
        if (object && object.setPosition) {
          object.setPosition(placement.x, placement.y);
          applyScale(object, placement);
          applyDepth(object, depth * 1000 + step);
        }
      });
    });
  }
  // idlewild:end placeDocument

  // idlewild:begin paintFill
  paintFill(fill, depth) {
    const g = this.add.graphics().setDepth(depth * 1000);
    const color = Phaser.Display.Color.HexStringToColor(
      fill.color ?? "#ec3013",
    ).color;
    g.fillStyle(color, 1);
    for (const box of this.grid.fillBoxes(fill)) {
      g.fillRect(box.x, box.y, box.width, box.height);
    }
  }
  // idlewild:end paintFill

  // idlewild:if character
  /**
   * Where the character starts, and what runs there.
   *
   * `config.spawn` is the space the editor's Point tool designated as this
   * scene's start point, or the origin when it has none. Every point in the
   * scene is in `config.layers[].points` beside it — an id, a name and a
   * cell — so a door, a trigger or a second spawn is a matter of finding the
   * one you named and reading its cell.
   *
   * The character itself is a prefab: `js/prefabs/character.js`, which owns
   * the body, the keyboard and the step. This is the one line that says where
   * it stands.
   */
  spawnCharacter() {
    const start = config.spawn ?? { cx: 0, cy: 0 };
    this.character = createCharacter(this, {
      grid: this.grid,
      start,
      solids: this.solids,
    });
    this.cameras.main.startFollow(this.character.sprite, true, 0.14, 0.14);
  }
  // idlewild:end if
}

/**
 * Everything on one document layer, back to front.
 *
 * Two orderings, one inside the other.
 *
 * **Between placed PSDs.** An isometric scene sorts them on screen Y, so a
 * thing standing nearer the viewer draws in front of one behind it. A unit
 * sorts on its *own* Y rather than each of its layers separately: a roof sits
 * higher up the screen than the tower under it, and sorting the two against
 * each other would put the roof behind the building every time. Flat
 * projections leave them in the order they were placed.
 *
 * **Within one placed PSD.** The author's stack, and nothing else — that is
 * what `order` is, counting up from the back of the file.
 *
 * Shared with the editor's own `drawOrder`, in `src/game/doc-renderer.ts`.
 * Keep the two in step.
 */
// idlewild:begin drawOrder
function drawOrder(placements, isometric) {
  const units = [];
  const byInstance = new Map();
  for (const placement of placements) {
    // A placement with no unit is a unit of one. Documents written before
    // units existed have none, and the editor fills them in on open.
    if (!placement.instance) {
      units.push([placement]);
      continue;
    }
    const held = byInstance.get(placement.instance);
    if (held) {
      held.push(placement);
    } else {
      const unit = [placement];
      byInstance.set(placement.instance, unit);
      units.push(unit);
    }
  }

  if (isometric) {
    const top = (unit) => Math.min(...unit.map((p) => p.y));
    units.sort((a, b) => top(a) - top(b));
  }

  return units.flatMap((unit) =>
    [...unit].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );
}
// idlewild:end drawOrder

/**
 * Give a placed object its depth, keeping a group's own stacking under it.
 *
 * `place()` returns a Phaser **Group**, and a Group's children live on the
 * scene's own display list rather than inside it — so `setDepth` on the group
 * writes the same depth onto every child and the artwork's order collapses.
 * Phaser then draws them in the order it was handed them, which is the
 * manifest's top-first order, which is upside down.
 *
 * So each child is ranked by the depth psd-to-phaser already gave it and
 * spaced inside this placement's own slot: the file's stack survives, and the
 * whole group still sits between the placement below it and the one above.
 *
 * Shared with the editor's own `applyDepth`, in `src/game/doc-renderer.ts`.
 * Keep the two in step.
 */
// idlewild:begin applyDepth
function applyDepth(object, depth) {
  const children = object.getChildren ? object.getChildren() : [];
  if (children.length < 2) {
    object.setDepth(depth);
    return;
  }
  const ranked = [...children].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  ranked.forEach((child, rank) => {
    if (child.setDepth) child.setDepth(depth + (rank + 1) / (ranked.length + 1));
  });
}
// idlewild:end applyDepth

/**
 * Scale a placed object to the size the editor displays it at.
 *
 * Shared with the editor's own `applyScale`. An import lands at half size, so
 * a placement's `width` is half the `naturalWidth` the manifest exported and
 * their ratio is the scale; a placement written before resizing existed has
 * no natural size and is already at 1. `setScale` is forwarded by the plugin
 * to the group's children, and a sprite placed with `setOrigin(0, 0)` scales
 * away from its top-left — the corner the placement's x/y describes, so the
 * image lands exactly where the editor drew it.
 */
// idlewild:begin applyScale
function applyScale(object, placement) {
  const naturalWidth = placement.naturalWidth ?? placement.width;
  const naturalHeight = placement.naturalHeight ?? placement.height;
  if (!naturalWidth || !naturalHeight || !object.setScale) return;
  object.setScale(placement.width / naturalWidth, placement.height / naturalHeight);
}
// idlewild:end applyScale

/**
 * The flat point lists `grid.js` returns, as Phaser's graphics want them.
 *
 * Nothing in a side-on scene needs it — a fill is a box here — but a diamond
 * cell is a polygon, and whatever you draw over the lattice yourself will
 * want the same conversion the top-down template does.
 */
// idlewild:begin pointsToVectors
function pointsToVectors(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push(new Phaser.Math.Vector2(flat[i], flat[i + 1]));
  }
  return out;
}
// idlewild:end pointsToVectors
