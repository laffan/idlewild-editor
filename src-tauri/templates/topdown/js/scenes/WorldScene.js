import { createGrid } from "../shared/grid.js";
// idlewild:if character
import { createCharacter } from "../prefabs/character.js";
// idlewild:end if
import config from "../game.config.json" with { type: "json" };

// The top-down template. One *Phaser* scene serves all three projections —
// the difference between diamonds, squares and bare pixels lives in grid.js,
// and the projection reaches it through the config the editor wrote. That is
// a different sense of the word from the editor's scenes, which are places in
// your project; this one class places whichever of them is open.
//
// What the character routes around: a fill marked not-walkable, and the
// collider of every placed PSD — the spaces the editor says that file stands
// on.
//
// A blank project has no lattice, so it navigates on a square lattice of the
// project's nominal unit — the grid scale chosen in New Game, which is what
// that setting is for on a template that does not snap. Nothing draws the
// lattice here on any template: the editor's light blue grid is scaffolding
// for building on, and a game is the thing you built.
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
    this.nav = this.grid.snaps ? this.grid : createGrid("orthogonal", config.grid);
    for (const key of config.psdKeys ?? []) {
      this.P2P.load.load(this, key, `assets/${key}`);
    }
  }
  // idlewild:end preload

  create() {
    this.readColliders();
    this.applyCamera();
    this.placeDocument();
    // idlewild:if character
    this.spawnCharacter();

    this.input.on("pointerup", (pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.character.moveTo(this.nav.worldToCell(world.x, world.y));
    });
    // idlewild:end if
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
    // Layers are stored top-first; Phaser depth counts upward, so the last
    // layer in the list is the furthest back.
    const layers = config.layers ?? [];
    layers.forEach((layer, index) => {
      const depth = layers.length - index;
      if (layer.visible === false) return;

      for (const fill of layer.fills ?? []) {
        this.paintFill(fill, depth);
      }
      // Back to front, once for the whole layer: each placement takes the
      // next depth up, so what is above what is decided here rather than by
      // the order Phaser happened to be handed the objects in.
      const order = drawOrder(layer.placements ?? [], config.projection === "isometric");
      order.forEach((placement, step) => {
        const object = this.P2P.place(this, placement.psdKey, placement.layerPath);
        if (object && object.setPosition) {
          object.setPosition(placement.x, placement.y);
          applyScale(object, placement);
          applyDepth(object, depth * 1000 + step);
          applyHidden(object, placement);
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

    if (fill.rect) {
      g.fillRect(fill.rect.x, fill.rect.y, fill.rect.width, fill.rect.height);
      return;
    }
    for (const cell of fill.cells ?? []) {
      g.fillPoints(
        pointsToVectors(this.grid.cellPolygon(cell.cx, cell.cy)),
        true,
        true,
      );
    }
  }
  // idlewild:end paintFill

  // idlewild:if character
  /**
   * Where the character starts, and what walks there.
   *
   * `config.spawn` is the space the editor's Point tool designated as this
   * scene's start point, or the origin when it has none. Every point in the
   * scene is in `config.layers[].points` beside it — an id, a name and a
   * cell — so a door, a trigger or a second spawn is a matter of finding the
   * one you named and reading its cell.
   *
   * The character itself is a prefab: `js/prefabs/character.js`, which owns
   * the body and the walk. This is the one line that says where it stands.
   */
  spawnCharacter() {
    const start = config.spawn ?? { cx: 0, cy: 0 };
    this.character = createCharacter(this, {
      grid: this.grid,
      nav: this.nav,
      start,
      isWalkable: (cx, cy) => this.isWalkable(cx, cy),
    });
    this.cameras.main.startFollow(this.character.sprite, true, 0.12, 0.12);
  }
  // idlewild:end if

  /**
   * The spaces placed PSDs block, worked out once.
   *
   * A collider rides on the first placement of each unit, as offsets from the
   * space that unit hangs from — the editor stores it that way so a file can
   * be dropped twice and block the same shape both times. Resolving them here
   * rather than inside `isWalkable` matters: that runs once per node of every
   * search, and the document does not change while a published game is
   * running.
   *
   * Cells where there are cells, boxes where there are not. On a snapping
   * project the character walks the same lattice the collider was drawn on,
   * so the spaces *are* the answer — and reducing an isometric diamond to its
   * box first would block the neighbours its corners reach into.
   *
   * This and `isWalkable` are read whether or not this project scaffolded a
   * character: they are facts about the document, and whatever walks it —
   * the prefab, or something you write instead — asks them.
   */
  readColliders() {
    this.blockedCells = new Set();
    this.colliderBoxes = [];
    for (const layer of config.layers ?? []) {
      if (layer.visible === false) continue;
      for (const placement of layer.placements ?? []) {
        const collider = placement.collider;
        if (!collider || !collider.blocking) continue;
        if (this.grid.snaps && !collider.rect) {
          for (const cell of this.grid.colliderCells(collider, placement.anchor)) {
            this.blockedCells.add(`${cell.cx},${cell.cy}`);
          }
        } else {
          this.colliderBoxes.push(
            ...this.grid.colliderBoxes(collider, placement.anchor),
          );
        }
      }
    }
  }

  isWalkable(cx, cy) {
    const span = config.gridSpan ?? 24;
    if (Math.abs(cx) > span || Math.abs(cy) > span) return false;
    if (this.blockedCells.has(`${cx},${cy}`)) return false;

    const centre = this.nav.cellCentre(cx, cy);
    for (const box of this.colliderBoxes) {
      if (contains(box, centre)) return false;
    }
    for (const layer of config.layers ?? []) {
      for (const fill of layer.fills ?? []) {
        if (fill.walkable) continue;
        for (const box of this.grid.fillBoxes(fill)) {
          if (contains(box, centre)) return false;
        }
      }
    }
    return true;
  }
}

function contains(box, p) {
  // Half-open, so a point on a shared edge belongs to one box rather than to
  // both — otherwise a run of adjacent fills blocks a cell either side of it.
  return (
    p.x >= box.x &&
    p.x < box.x + box.width &&
    p.y >= box.y &&
    p.y < box.y + box.height
  );
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
 * Turn off what the PSD says is turned off.
 *
 * A hidden layer is still **placed**: the asset is exported, the object is
 * made, and `this.P2P.get(...)` finds it — so turning it on is a line of your
 * own code. It simply starts invisible, the way the editor draws it.
 *
 * `hiddenParts` is the same answer one level down. A group is placed whole,
 * so a hidden layer inside one cannot be left out of the document; what is
 * named here are the pieces to turn off once the plugin has made them.
 *
 * Shared with the editor's own `applyHidden`, in `src/game/placed-parts.ts`.
 * Keep the two in step.
 */
// idlewild:begin applyHidden
function applyHidden(object, placement) {
  if (placement.hidden) {
    if (object.setVisible) object.setVisible(false);
    return;
  }
  const names = placement.hiddenParts;
  if (!names || names.length === 0) return;
  hideNamed(object, names);
}

function hideNamed(object, names) {
  const children = object.getChildren ? object.getChildren() : [];
  for (const child of children) {
    if (child.setVisible && names.includes(child.name)) child.setVisible(false);
    hideNamed(child, names);
  }
}
// idlewild:end applyHidden

/**
 * The flat point lists `grid.js` returns, as Phaser's graphics want them.
 *
 * A diamond cell is a polygon rather than a rectangle, so anything filling or
 * stroking one goes through here — `paintFill` does, and so will whatever you
 * draw over the lattice yourself.
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
