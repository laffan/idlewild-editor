/**
 * The drag bridge Code mode injects into the page it runs.
 *
 * With the caret inside a `setPosition(…)` or a `setScale(…)` in the code
 * panel, the editor names the sprite that call places — by its texture,
 * psd-to-phaser's `<psdKey>_<layer>`, and where its `setPosition` says it
 * stands — and this finds it in the running game, outlines it, and lets it be
 * dragged: moved, for a `setPosition`, or scaled about its origin — the
 * top-left corner psd-to-phaser places a sprite by — for a `setScale`, with a
 * handle on the far corner to say so. Every move is posted back, and the
 * editor writes the new numbers into the call as it goes.
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
        ? {
            texture: data.texture,
            x: Number(data.x),
            y: Number(data.y),
            mode: data.mode === "scale" ? "scale" : "position",
            uniform: data.uniform !== false,
          }
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
      if (wanted && wanted.mode === "scale") {
        held.outline.fillStyle(0xec3013, 1);
        held.outline.fillRect(box.right - 5, box.bottom - 5, 10, 10);
      }
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
        // A scale's call may come with no position to look near.
        var d =
          isFinite(target.x) && isFinite(target.y)
            ? Math.hypot(object.x - target.x, object.y - target.y)
            : 0;
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
      var object = held.object;
      dragging = {
        x: object.x - at.x,
        y: object.y - at.y,
        scaleX: object.scaleX,
        scaleY: object.scaleY,
        // Where the press was, from the origin a scale is taken about.
        dx: at.x - object.x,
        dy: at.y - object.y,
      };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    function (event) {
      if (!dragging || !held) return;
      event.stopImmediatePropagation();
      var at = worldAt(event);
      if (wanted && wanted.mode === "scale") {
        var scale = scaled(held.object, at);
        held.object.setScale(scale.sx, scale.sy);
        window.parent.postMessage(
          { source: MOVE, phase: "move", sx: scale.sx, sy: scale.sy },
          "*",
        );
        return;
      }
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
      // Still the same call: found again where it now stands after a restart.
      wanted = Object.assign({}, wanted, { x: object.x, y: object.y });
      window.parent.postMessage(
        {
          source: MOVE,
          phase: "end",
          x: object.x,
          y: object.y,
          sx: round(object.scaleX),
          sy: round(object.scaleY),
        },
        "*",
      );
    },
    true,
  );

  /**
   * The scale a drag has reached: how much further from the origin the
   * pointer is than the press was. One ratio for a `setScale(s)`, taken along
   * the line from the origin; one per axis for `setScale(x, y)`. A press
   * nearer the origin than a few pixels says nothing about an axis, so that
   * axis stays as it was rather than leaping.
   */
  function scaled(object, at) {
    var NEAR = 8;
    var dx = at.x - object.x;
    var dy = at.y - object.y;
    if (wanted.uniform) {
      var from = Math.hypot(dragging.dx, dragging.dy);
      var s =
        from < NEAR
          ? dragging.scaleX
          : round((dragging.scaleX * Math.hypot(dx, dy)) / from);
      return { sx: s, sy: s };
    }
    return {
      sx:
        Math.abs(dragging.dx) < NEAR
          ? dragging.scaleX
          : round((dragging.scaleX * dx) / dragging.dx),
      sy:
        Math.abs(dragging.dy) < NEAR
          ? dragging.scaleY
          : round((dragging.scaleY * dy) / dragging.dy),
    };
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }
})();
