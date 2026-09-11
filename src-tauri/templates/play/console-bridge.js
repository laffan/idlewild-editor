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
 * Two things are worked out here rather than in the editor, because only this
 * side has them:
 *
 * **The value.** A structured clone of a live Phaser object throws, and a
 * clone of a scene would carry the whole game across to be printed as one
 * line. So each argument is flattened into the tagged shape `lib/log-value.ts`
 * describes — depth-capped, circular-safe, keeping the difference between `5`
 * and `"5"` and naming the class an object came from — and the drawer builds
 * its tree from that. Snapshotted at the moment of logging, so opening a line
 * an hour later shows what was true when it was written rather than what is
 * true now.
 *
 * **The site.** A thrown error's stack names the file and line the call came
 * from. Mapped back to a path inside `game/`, that is what makes the drawer's
 * level chip a link into the code modal. Frames from this script and from the
 * vendored runtimes are stepped over, so a `console.log` reached through a
 * Phaser callback still reports the line you wrote.
 *
 * Both halves are deliberately reachable — `window.__idlewildSnapshot` and
 * `window.__idlewildSiteIn` — before this looks for a parent to report to.
 * `src/lib/__tests__/log-value.test.ts` runs the snapshot and the TypeScript
 * one over the same fixtures, which is what holds two implementations of one
 * contract together, and `console-site.test.ts` puts real stacks from both
 * engines through the frame reader.
 */
(function () {
  var MAX_DEPTH = 4;
  var MAX_ENTRIES = 100;

  /** Own enumerable entries, plus what a Map or Set keeps behind an iterator. */
  function pairs(value) {
    var out = [];
    var i;
    if (typeof Map !== "undefined" && value instanceof Map) {
      value.forEach(function (v, k) {
        out.push([String(k), v]);
      });
      return out;
    }
    if (typeof Set !== "undefined" && value instanceof Set) {
      i = 0;
      value.forEach(function (v) {
        out.push([String(i++), v]);
      });
      return out;
    }
    var keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) out.push([keys[i], value[keys[i]]]);
    return out;
  }

  function labelOf(value) {
    if (typeof Map !== "undefined" && value instanceof Map) {
      return "Map(" + value.size + ")";
    }
    if (typeof Set !== "undefined" && value instanceof Set) {
      return "Set(" + value.size + ")";
    }
    var name = value.constructor && value.constructor.name;
    return name && name !== "Object" ? name : undefined;
  }

  /**
   * Flatten one value. `seen` is the chain of ancestors rather than everything
   * visited, so the same sprite logged twice side by side is shown twice and
   * only a real cycle is cut.
   */
  function snapshot(value, depth, seen) {
    depth = depth || 0;
    seen = seen || [];

    if (typeof value === "string") return { t: "string", v: value };
    if (typeof value === "number") {
      return { t: "number", v: Object.is(value, -0) ? "-0" : String(value) };
    }
    if (typeof value === "boolean") return { t: "boolean", v: value };
    if (value === null) return { t: "empty", v: "null" };
    if (value === undefined) return { t: "empty", v: "undefined" };
    if (typeof value === "bigint") return { t: "number", v: String(value) + "n" };
    if (typeof value === "symbol") return { t: "other", v: value.toString() };
    if (typeof value === "function") {
      return { t: "other", v: "ƒ " + (value.name || "anonymous") + "()" };
    }
    if (value instanceof Error) {
      return { t: "other", v: value.stack || value.name + ": " + value.message };
    }
    if (typeof Element !== "undefined" && value instanceof Element) {
      return { t: "other", v: "<" + value.tagName.toLowerCase() + ">" };
    }

    if (seen.indexOf(value) !== -1) return { t: "other", v: "[Circular]" };
    if (depth >= MAX_DEPTH) {
      return { t: "other", v: isArray(value) ? "[Array]" : "[Object]" };
    }

    var chain = seen.concat([value]);
    var out;
    var i;

    if (isArray(value)) {
      var items = [];
      for (i = 0; i < Math.min(value.length, MAX_ENTRIES); i++) {
        items.push(snapshot(value[i], depth + 1, chain));
      }
      out = { t: "array", items: items };
      if (value.length > MAX_ENTRIES) out.more = value.length - MAX_ENTRIES;
      return out;
    }

    var all = pairs(value);
    var entries = [];
    for (i = 0; i < Math.min(all.length, MAX_ENTRIES); i++) {
      try {
        entries.push([all[i][0], snapshot(all[i][1], depth + 1, chain)]);
      } catch (err) {
        // A getter that throws is a fact about the object, not a failure here.
        entries.push([all[i][0], { t: "other", v: "[unreadable]" }]);
      }
    }
    out = { t: "object", entries: entries };
    var label = labelOf(value);
    if (label) out.label = label;
    if (all.length > MAX_ENTRIES) out.more = all.length - MAX_ENTRIES;
    return out;
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
  }

  // ── where a call came from ────────────────────────────────────────────────

  var FRAME = /(https?:\/\/[^\s)'"]+?):(\d+):(\d+)/;

  /**
   * The first frame of `stack` that is the project's own code, as a path the
   * code modal names files by — or null when there is no such frame.
   *
   * Pure, and given its `base` and `selfPath` rather than reading them, so
   * the editor's tests can put a real Safari stack and a real Chrome stack
   * through it without a browser.
   */
  function siteIn(stack, base, selfPath) {
    if (!base) return null;
    var lines = String(stack).split("\n");
    for (var i = 0; i < lines.length; i++) {
      // One regex for two engines: JSC writes `fn@url:line:col` and V8 writes
      // `    at fn (url:line:col)`, and the part that matters is the same.
      var match = FRAME.exec(lines[i]);
      if (!match || match[1].indexOf(base) !== 0) continue;
      var path = match[1].slice(base.length);
      // This script's own frames, and the vendored runtimes: a call that
      // reached the console through Phaser was still written by you.
      if (path === selfPath || path.indexOf("lib/") === 0) continue;
      return {
        path: path,
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      };
    }
    return null;
  }

  // Reachable so the editor's tests can hold both implementations of the
  // snapshot contract to the same fixtures, and put known stacks through the
  // frame reader. Harmless to the page.
  window.__idlewildSnapshot = snapshot;
  window.__idlewildSiteIn = siteIn;

  var host = window.parent;
  if (!host || host === window) return;

  /**
   * The project's own URL prefix: everything up to and including `/game/`.
   * A frame under it is a file the code modal can open.
   */
  var base = (function () {
    var at = window.location.pathname.indexOf("/game/");
    if (at < 0) return null;
    return window.location.origin + window.location.pathname.slice(0, at + 6);
  })();

  function stackNow() {
    try {
      throw new Error();
    } catch (err) {
      return err.stack || "";
    }
  }

  /**
   * This script's own path, so its frames can be stepped over.
   *
   * Read rather than assumed: it is `index.html` today because that is where
   * the injection lands, and deriving it means the skip stays right if that
   * ever changes.
   */
  var selfPath = (function () {
    var own = siteIn(stackNow(), base, null);
    return own ? own.path : null;
  })();

  function site(stack) {
    return siteIn(stack, base, selfPath);
  }

  // ── reporting ─────────────────────────────────────────────────────────────

  function send(level, args, where) {
    var flattened = [];
    for (var i = 0; i < args.length; i++) {
      try {
        flattened.push(snapshot(args[i], 0, []));
      } catch (err) {
        flattened.push({ t: "other", v: "[unreadable]" });
      }
    }
    try {
      host.postMessage(
        {
          source: "idlewild-game-console",
          level: level,
          args: flattened,
          site: where || null,
        },
        "*",
      );
    } catch (err) {
      // The editor has gone, or the frame is being torn down mid-log.
    }
  }

  // The originals stay in place, so Safari's own devtools still show the page
  // exactly as it would without this.
  var levels = {
    log: "log",
    debug: "log",
    info: "info",
    warn: "warn",
    error: "error",
  };
  Object.keys(levels).forEach(function (method) {
    var original = console[method] ? console[method].bind(console) : null;
    console[method] = function () {
      if (original) original.apply(null, arguments);
      send(levels[method], arguments, site(stackNow()));
    };
  });

  window.addEventListener("error", function (event) {
    // The event carries the location outright, which beats reading it back
    // out of a stack that may have been rewritten on the way here.
    var where = null;
    if (base && event.filename && event.filename.indexOf(base) === 0) {
      where = {
        path: event.filename.slice(base.length),
        line: event.lineno,
        column: event.colno,
      };
    }
    send("error", [event.error || event.message], where || site(stackNow()));
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    send(
      "error",
      ["Unhandled rejection:", reason],
      reason instanceof Error ? site(reason.stack || "") : null,
    );
  });
})();
