/**
 * The drag bridge Code mode injects into the page it runs.
 *
 * With the caret inside a `setPosition(…)` in the code panel, the editor names
 * the sprite that call places — by its texture, psd-to-phaser's
 * `<psdKey>_<layer>`, and where the call says it stands — and this finds it in
 * the running game, outlines it, and lets it be dragged. Every move is posted
 * back, and the editor writes the new numbers into the call as it goes.
 *
 * Injected by `file_server.rs` at the end of `<head>`, after the page's own
 * Phaser has loaded, and only for a request that asks for the console bridge,
 * so nothing in the project's own `index.html` mentions it. It finds the game
 * by wrapping `Phaser.Game.prototype.boot`, which a game binds when it is
 * constructed — after this has run, since the page's own code is a module.
 *
 * The drag is the bridge's own, on the window and in the capture phase, so it
 * neither needs the sprite to be interactive nor lets a press on it reach the
 * game's own input underneath.
 */
(function () {
  if (!window.parent || window.parent === window) return;
  if (!window.Phaser || !Phaser.Game) return;

  var TARGET = "idlewild-drag-target";
  var MOVE = "idlewild-drag";
  var READY = "idlewild-drag-ready";

  var game = null;
  var wanted = null;
  var held = null;
  var dragging = null;

  var boot = Phaser.Game.prototype.boot;
  Phaser.Game.prototype.boot = function () {
    if (!game) {
      game = this;
      this.events.on("poststep", follow);
      window.parent.postMessage({ source: READY }, "*");
    }
    return boot.apply(this, arguments);
  };

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== TARGET || event.source !== window.parent)
      return;
    if (dragging) return;
    wanted =
      typeof data.texture === "string"
        ? { texture: data.texture, x: Number(data.x), y: Number(data.y) }
        : null;
    if (!wanted || (held && held.object.texture.key !== wanted.texture))
      release();
  });

  /** Find what is wanted, once there is a scene to find it in. */
  function follow() {
    if (held && (!held.object.scene || !held.object.active)) release();
    if (wanted && !held) {
      var found = find(wanted);
      if (found) {
        held = {
          object: found.object,
          scene: found.scene,
          outline: found.scene.add.graphics().setDepth(1e9),
        };
      }
    }
    if (held) {
      var box = held.object.getBounds();
      held.outline.clear();
      held.outline.lineStyle(2, 0xec3013, 1);
      held.outline.strokeRect(box.x, box.y, box.width, box.height);
    }
  }

  function release() {
    if (held && held.outline.scene) held.outline.destroy();
    held = null;
  }

  /** The sprite with that texture nearest where the code says it is. */
  function find(target) {
    var best = null;
    var scenes = game.scene.getScenes(true);
    for (var i = 0; i < scenes.length; i++) {
      walk(scenes[i].sys.displayList.list, function (object) {
        if (!object.texture || object.texture.key !== target.texture) return;
        var d = Math.hypot(object.x - target.x, object.y - target.y);
        if (!best || d < best.d)
          best = { d: d, object: object, scene: scenes[i] };
      });
    }
    return best;
  }

  function walk(list, visit) {
    for (var i = 0; i < list.length; i++) {
      if (Array.isArray(list[i].list)) walk(list[i].list, visit);
      else visit(list[i]);
    }
  }

  /** A page point, in the world the held sprite's scene draws. */
  function worldAt(event) {
    var x = game.scale.transformX(event.pageX);
    var y = game.scale.transformY(event.pageY);
    return held.scene.cameras.main.getWorldPoint(x, y);
  }

  window.addEventListener(
    "pointerdown",
    function (event) {
      if (!held || event.target !== game.canvas) return;
      var at = worldAt(event);
      if (!held.object.getBounds().contains(at.x, at.y)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragging = { x: held.object.x - at.x, y: held.object.y - at.y };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    function (event) {
      if (!dragging || !held) return;
      event.stopImmediatePropagation();
      var at = worldAt(event);
      var x = Math.round(at.x + dragging.x);
      var y = Math.round(at.y + dragging.y);
      held.object.setPosition(x, y);
      window.parent.postMessage(
        { source: MOVE, phase: "move", x: x, y: y },
        "*",
      );
    },
    true,
  );

  window.addEventListener(
    "pointerup",
    function (event) {
      if (!dragging || !held) return;
      event.stopImmediatePropagation();
      dragging = null;
      var object = held.object;
      wanted = { texture: object.texture.key, x: object.x, y: object.y };
      window.parent.postMessage(
        { source: MOVE, phase: "end", x: object.x, y: object.y },
        "*",
      );
    },
    true,
  );
})();
