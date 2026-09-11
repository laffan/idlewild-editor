/**
 * The console bridge play mode injects into the page it runs.
 *
 * Play mode runs the project's own program in a frame over the canvas, served
 * from the asset server's loopback origin. That is a different origin from the
 * editor, so the editor cannot reach into the frame and read its console the
 * way `lib/log.ts` reads its own. The frame reports instead.
 *
 * Injected by `file_server.rs`, and only for a request that asks for it, so
 * nothing in the project's own `index.html` mentions this and what publishes
 * is exactly what was edited.
 *
 * Arguments are stringified here rather than posted as they are: a structured
 * clone of a live Phaser object throws, and a clone of a scene would carry the
 * whole game across the wire to be printed as one line. Stack traces survive,
 * because a stack is the argument that matters when something has gone wrong.
 */
(function () {
  var host = window.parent;
  if (!host || host === window) return;

  var MAX_DEPTH = 2;
  var MAX_ITEMS = 24;

  function render(value, depth, seen) {
    if (typeof value === "string") return value;
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "bigint") return String(value) + "n";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") {
      return "ƒ " + (value.name || "anonymous") + "()";
    }
    if (value instanceof Error) {
      return value.stack || value.name + ": " + value.message;
    }
    if (typeof Element !== "undefined" && value instanceof Element) {
      return "<" + value.tagName.toLowerCase() + ">";
    }
    if (seen.indexOf(value) !== -1) return "[Circular]";
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]";

    seen.push(value);
    try {
      if (Array.isArray(value)) {
        var items = value.slice(0, MAX_ITEMS).map(function (item) {
          return render(item, depth + 1, seen);
        });
        if (value.length > MAX_ITEMS) items.push("…" + (value.length - MAX_ITEMS) + " more");
        return "[" + items.join(", ") + "]";
      }
      // A class instance says which class it is; a plain object does not need
      // to, and `Object {…}` would be noise on every log line.
      var name = value.constructor && value.constructor.name;
      var label = name && name !== "Object" ? name + " " : "";
      var keys = Object.keys(value).slice(0, MAX_ITEMS);
      var parts = keys.map(function (key) {
        return key + ": " + render(value[key], depth + 1, seen);
      });
      if (Object.keys(value).length > keys.length) parts.push("…");
      return label + "{" + parts.join(", ") + "}";
    } catch (err) {
      return String(value);
    } finally {
      seen.pop();
    }
  }

  function send(level, args) {
    var rendered = [];
    for (var i = 0; i < args.length; i++) {
      rendered.push(render(args[i], 0, []));
    }
    try {
      host.postMessage(
        { source: "idlewild-game-console", level: level, args: rendered },
        "*",
      );
    } catch (err) {
      // The editor has gone, or the frame is being torn down mid-log.
    }
  }

  // The originals stay in place, so Safari's own devtools still show the page
  // exactly as it would without this.
  var levels = { log: "info", info: "info", debug: "info", warn: "warn", error: "error" };
  Object.keys(levels).forEach(function (method) {
    var original = console[method] ? console[method].bind(console) : null;
    console[method] = function () {
      if (original) original.apply(null, arguments);
      send(levels[method], arguments);
    };
  });

  window.addEventListener("error", function (event) {
    send("error", [event.error || event.message]);
  });
  window.addEventListener("unhandledrejection", function (event) {
    send("error", ["Unhandled rejection:", event.reason]);
  });
})();
