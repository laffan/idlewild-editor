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

  /**
   * The grid, and every PSD the document places.
   *
   * Through `loadMultiple` rather than `load`, even for a single file: it is
   * the only one of the plugin's two loading paths that keys a texture
   * `<psdKey>_<layerName>` rather than on the layer's name alone. On the other
   * path two PSDs with a same-named layer — two files each holding a
   * `S | layer 1`, which is what New layer names its rows — share one texture:
   * Phaser silently declines a key it already holds, so one file's artwork is
   * drawn for the other's. `place` reads back the same flag this sets, so both
   * halves agree about the name.
   *
   * What it costs is the sequencing. `loadMultiple` parses each `data.json`
   * and queues its images from a promise callback, and that callback lands one
   * microtask *after* Phaser has decided the pass is finished and called
   * `create` — so the document cannot be placed from `create`. It is placed
   * from the plugin's own completion signal instead, and `placeDocument` does
   * nothing until that has arrived. A pattern layer needs no such care: it
   * places what the camera can see every frame and retries what it could not.
   */
  // idlewild:begin preload
  preload() {
    this.grid = createGrid(config.projection, config.grid);
    this.nav = this.grid.snaps ? this.grid : createGrid("orthogonal", config.grid);
    const psds = (config.psdKeys ?? []).map((key) => ({
      key,
      path: `assets/${key}`,
      position: { x: 0, y: 0 },
    }));
    // Nothing to wait for: the document places from `create`, as it always has.
    this.psdsReady = psds.length === 0;
    if (this.psdsReady) return;

    let timer = 0;
    const ready = () => {
      if (this.psdsReady) return;
      clearTimeout(timer);
      this.psdsReady = true;
      this.placeDocument();
    };
    this.events.once("psdLoadComplete", ready);
    // An asset that never arrives must not mean a document that never places.
    timer = setTimeout(ready, 15000);
    this.P2P.load.loadMultiple(this, psds);
  }
  // idlewild:end preload

  create() {
    this.readColliders();
    this.applyCamera();
    this.paintBackgrounds();
    this.placeDocument();
    this.placePatterns();
    // idlewild:if character
    this.spawnCharacter();

    this.input.on("pointerup", (pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.character.moveTo(this.nav.worldToCell(world.x, world.y));
    });
    // idlewild:end if
  }

  /**
   * Every frame, because both of these follow the camera.
   *
   * A backdrop is wherever you are looking and a pattern is a rule evaluated
   * over the spaces in view, so neither is a thing that was placed once. Both
   * are cheap when there is nothing of the kind in the scene.
   */
  // idlewild:begin patternUpdate
  update() {
    this.drawBackdrops();
    this.syncPatterns();
  }
  // idlewild:end patternUpdate

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
    // Every PSD has to be loaded before anything is placed from one, and they
    // are not in yet when `create` runs — see `preload`, which calls this
    // again once they are.
    if (!this.psdsReady) return;
    // Layers are stored top-first; Phaser depth counts upward, so the last
    // layer in the list is the furthest back.
    const layers = config.layers ?? [];
    layers.forEach((layer, index) => {
      const depth = layers.length - index;
      if (layer.visible === false) return;
      // A pattern layer's placements are the palette it scatters rather than
      // things standing anywhere — `placePatterns` generates from them.
      if (layer.kind === "pattern") return;

      for (const fill of layer.fills ?? []) {
        this.paintFill(fill, depth);
      }
      // Back to front, once for the whole layer: each placement takes the
      // next depth up, so what is above what is decided here rather than by
      // the order Phaser happened to be handed the objects in.
      //
      // Screen Y only on an *object* layer. Sorting on Y answers which of two
      // things standing in the space is nearer, and a layer of backdrops holds
      // no such things — they are behind everything and often behind each
      // other at the same Y — so it keeps the order it was given. The editor
      // lists and reorders it the same way; see `ordersByHand` there.
      const sortOnY =
        config.projection === "isometric" && (layer.kind ?? "object") === "object";
      const order = drawOrder(layer.placements ?? [], sortOnY);
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

  /**
   * Colours and gradients behind everything, following the camera.
   *
   * A backdrop has no extent. It is not a very large rectangle somebody has
   * to remember to make larger — it is wherever the camera is looking, which
   * on a world with no edge is the only reading that never shows its own.
   * So what is drawn is the camera's own world view, every frame it moves.
   *
   * Phaser's graphics take one colour per corner, so an angled gradient is
   * each corner sampled off the gradient's own axis. Zero degrees is top to
   * bottom, which is what a sky is.
   */
  // idlewild:begin paintBackgrounds
  paintBackgrounds() {
    const layers = config.layers ?? [];
    this.backdrops = [];
    layers.forEach((layer, index) => {
      if (layer.kind !== "background" || layer.visible === false) return;
      const depth = (layers.length - index) * 1000 - 1;
      const g = this.add.graphics().setDepth(depth);
      this.backdrops.push({ g, backgrounds: [...(layer.backgrounds ?? [])].reverse() });
    });
    this.drawBackdrops();
  }

  drawBackdrops() {
    if (!this.backdrops || this.backdrops.length === 0) return;
    const view = this.cameras.main.worldView;
    for (const { g, backgrounds } of this.backdrops) {
      g.clear();
      for (const background of backgrounds) {
        if (background.kind === "gradient" && background.gradient) {
          const { from, to, angle } = background.gradient;
          const c = gradientCorners(from, to, angle ?? 0);
          g.fillGradientStyle(c[0], c[1], c[2], c[3], 1);
        } else {
          g.fillStyle(colorOf(background.color ?? "#2b3b4a"), 1);
        }
        g.fillRect(view.x, view.y, view.width, view.height);
      }
    }
  }
  // idlewild:end paintBackgrounds

  /**
   * A pattern layer, placed.
   *
   * The placements on such a layer are the *palette* the pattern is made of
   * rather than things standing anywhere, so `placeDocument` skips them and
   * this generates instead: the rule in `layer.pattern`, run over the spaces
   * the camera can see, one repeat tile at a time — see `shared/pattern.js`.
   *
   * Copies are made as they come into view and destroyed as they leave, keyed
   * by the tile they belong to, so panning back over ground you have already
   * crossed re-uses what is there. The same four numbers give the same
   * arrangement every time, which is why nothing has to be stored.
   */
  // idlewild:begin placePatterns
  placePatterns() {
    this.patternLive = new Map();
    this.patternLayers = (config.layers ?? [])
      .map((layer, index) => ({ layer, index }))
      .filter(({ layer }) => layer.kind === "pattern" && layer.visible !== false)
      .map(({ layer, index }) => ({
        id: `pattern-${index}`,
        depth: ((config.layers ?? []).length - index) * 1000,
        spec: layer.pattern ?? { type: "random", density: 8, repeat: { cols: 20, rows: 20 }, seed: 1, shapes: [] },
        elements: patternElements(layer, this.grid),
      }));
    this.syncPatterns();
  }

  syncPatterns() {
    if (!this.patternLayers || this.patternLayers.length === 0) return;
    const range = this.visibleCells();
    const seen = new Set();
    for (const layer of this.patternLayers) {
      if (layer.elements.length === 0) continue;
      for (const made of patternInstances(layer.spec, layer.elements, range)) {
        const key = `${layer.id}:${made.id}`;
        seen.add(key);
        if (this.patternLive.has(key)) continue;
        const object = this.P2P.place(this, made.element.psdKey, made.element.path);
        if (!object || !object.setPosition) continue;
        const world = this.grid.cellToWorld(made.cell.cx, made.cell.cy);
        object.setPosition(world.x + made.element.offsetX, world.y + made.element.offsetY);
        if (object.setScale) object.setScale(made.element.scaleX, made.element.scaleY);
        object.setDepth(layer.depth);
        this.patternLive.set(key, object);
      }
    }
    for (const [key, object] of this.patternLive) {
      if (seen.has(key)) continue;
      object.destroy(true);
      this.patternLive.delete(key);
    }
  }

  /** The inclusive range of spaces the camera can see, with a little over. */
  visibleCells() {
    const view = this.cameras.main.worldView;
    const corners = [
      this.grid.worldToCell(view.x, view.y),
      this.grid.worldToCell(view.x + view.width, view.y),
      this.grid.worldToCell(view.x, view.y + view.height),
      this.grid.worldToCell(view.x + view.width, view.y + view.height),
    ];
    const xs = corners.map((c) => c.cx);
    const ys = corners.map((c) => c.cy);
    return {
      from: { cx: Math.min(...xs) - 2, cy: Math.min(...ys) - 2 },
      to: { cx: Math.max(...xs) + 2, cy: Math.max(...ys) + 2 },
    };
  }
  // idlewild:end placePatterns

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
 * each other would put the roof behind the building every time. Otherwise
 * they are left in the order they were placed, which is what `isometric`
 * false means — a flat projection, or a layer holding nothing that stands in
 * the space for the sort to answer about. The caller decides.
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

/**
 * The four corner colours a gradient at this angle comes out as.
 *
 * Phaser's graphics interpolate between one colour per corner, which is a
 * gradient at any angle if — and only if — each corner is the colour the
 * gradient's own axis has there. So each corner is projected onto the axis
 * and the two stops mixed at the fraction that comes back.
 *
 * Shared with the editor's own `background-render.ts`. Keep the two in step.
 */
// idlewild:begin gradientCorners
function gradientCorners(from, to, angle) {
  // The direction the gradient runs: zero is down, ninety is right. Screen y
  // counts downward, which is why this is sin/cos rather than cos/sin.
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = Math.cos(radians);
  const box = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ];
  const dots = box.map(([x, y]) => x * dx + y * dy);
  const low = Math.min(...dots);
  const span = Math.max(...dots) - low || 1;
  const a = colorOf(from);
  const b = colorOf(to);
  return dots.map((dot) => mixColor(a, b, (dot - low) / span));
}

function mixColor(a, b, t) {
  const at = Math.max(0, Math.min(1, t));
  const channel = (shift) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * at) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function colorOf(hex) {
  return Phaser.Display.Color.HexStringToColor(hex ?? "#2b3b4a").color;
}
// idlewild:end gradientCorners

/**
 * Where a pattern layer's elements land.
 *
 * A pattern layer stores a rule rather than a list, because the world it
 * covers has no edge: the editor recomputes it from the camera over exactly
 * the spaces the viewport can see, and this is the same arithmetic so the
 * game can do it too. Nothing here holds state. It is asked *what falls in
 * this repeat tile*, one tile at a time, and the tile's own coordinates are
 * part of the seed — which is what makes the same space answer the same way
 * whatever route the camera took to get there, and what lets four numbers in
 * `game.config.json` stand in for ten thousand positions.
 *
 * Shared with the editor's own `src/lib/pattern.ts`. **Keep the two in step**
 * — the same rule the editor drew has to come out of the game, or Play shows
 * a different world from the one you built.
 *
 * It is here rather than in `js/shared/` for the reason `drawOrder` and
 * `applyDepth` are: these are lines the editor goes on owning, and a marked
 * block is how it offers them to a project that was made before they existed.
 * An import at the top of this file is outside every block, so a helper in
 * another file could never reach one.
 */
// idlewild:begin patternRule
function patternElements(layer, grid) {
  return (layer.placements ?? []).map((placement) => {
    const anchor = grid.cellToWorld(placement.anchor.cx, placement.anchor.cy);
    const naturalWidth = placement.naturalWidth || placement.width || 1;
    const naturalHeight = placement.naturalHeight || placement.height || 1;
    return {
      psdKey: placement.psdKey,
      path: placement.layerPath,
      scaleX: placement.width / naturalWidth,
      scaleY: placement.height / naturalHeight,
      offsetX: placement.x - anchor.x,
      offsetY: placement.y - anchor.y,
    };
  });
}

/**
 * Every copy that falls inside a range of grid spaces.
 *
 * Whole repeat tiles are generated and their contents filtered, rather than
 * the range being generated directly: a tile is the unit the rule is defined
 * over, and generating half of one would give a different answer at the edge
 * of the view from the one the middle of the view gives a moment later.
 *
 * `limit` is a ceiling and not a detail — a density typed one digit too long
 * is thousands of sprites, and the difference between a slow frame and a game
 * that has stopped is whether anything said no.
 */
function patternInstances(spec, elements, range, limit = 1200) {
  if (!elements.length) return [];

  const cols = Math.max(1, Math.round(spec.repeat?.cols ?? 20));
  const rows = Math.max(1, Math.round(spec.repeat?.rows ?? 20));
  const lowX = Math.min(range.from.cx, range.to.cx);
  const lowY = Math.min(range.from.cy, range.to.cy);
  const highX = Math.max(range.from.cx, range.to.cx);
  const highY = Math.max(range.from.cy, range.to.cy);

  const out = [];
  for (let ty = Math.floor(lowY / rows); ty <= Math.floor(highY / rows); ty++) {
    for (let tx = Math.floor(lowX / cols); tx <= Math.floor(highX / cols); tx++) {
      for (const made of patternTile(spec, elements, tx, ty)) {
        const { cx, cy } = made.cell;
        if (cx < lowX || cx > highX || cy < lowY || cy > highY) continue;
        if (!insideShapes(spec.shapes ?? [], made.cell)) continue;
        out.push(made);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/**
 * What one repeat tile holds.
 *
 * **Random** puts `density` elements at spaces drawn from the tile's own
 * hash. Two can land on the same space, and that is deliberate: rejecting
 * collisions would make the count depend on the order they were drawn in.
 *
 * **Grid** lays the same count out on the tightest square lattice that holds
 * it. The positions stop being random; which element stands at each of them
 * does not.
 */
function patternTile(spec, elements, tileX, tileY) {
  const cols = Math.max(1, Math.round(spec.repeat?.cols ?? 20));
  const rows = Math.max(1, Math.round(spec.repeat?.rows ?? 20));
  const count = Math.max(1, Math.round(spec.density ?? 8));
  const seed = (spec.seed ?? 1) >>> 0;
  const originX = tileX * cols;
  const originY = tileY * rows;

  const side = Math.ceil(Math.sqrt(count));
  const down = Math.ceil(count / side);

  const out = [];
  for (let i = 0; i < count; i++) {
    let cx;
    let cy;
    if (spec.type === "grid") {
      cx = originX + Math.floor(((i % side) + 0.5) * (cols / side));
      cy = originY + Math.floor((Math.floor(i / side) + 0.5) * (rows / down));
    } else {
      cx = originX + (patternHash(seed, tileX, tileY, i, 1) % cols);
      cy = originY + (patternHash(seed, tileX, tileY, i, 2) % rows);
    }
    out.push({
      id: `${tileX}:${tileY}:${i}`,
      element: elements[patternHash(seed, tileX, tileY, i, 3) % elements.length],
      cell: { cx, cy },
    });
  }
  return out;
}

/**
 * Whether a space is inside the pattern's shapes.
 *
 * An empty list is everywhere, which is the default and what makes a pattern
 * layer infinite. A shape is stored as the spaces it covers — one drawn with
 * the pencil is baked down to them in the editor — so this is a set
 * membership rather than a polygon walk per element per frame.
 */
function insideShapes(shapes, cell) {
  if (!shapes.length) return true;
  return shapes.some((shape) =>
    (shape.cells ?? []).some((c) => c.cx === cell.cx && c.cy === cell.cy),
  );
}

/**
 * A 32-bit hash of a tile, an index and a channel.
 *
 * A pure function of what it is given rather than a seeded generator object:
 * the editor has to produce the same numbers from the same inputs, and a
 * stateful generator would have to be stepped in the same order by both.
 */
function patternHash(seed, tileX, tileY, index, channel) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const value of [tileX, tileY, index, channel]) {
    h = (h ^ (value >>> 0)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}
// idlewild:end patternRule
