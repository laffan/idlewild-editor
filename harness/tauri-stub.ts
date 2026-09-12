/**
 * A stand-in for @tauri-apps/api/core, so the editor shell can be opened in a
 * plain browser to look at. Dev harness only — never bundled by the app.
 */

const DOC = {
  version: 2,
  // Overridable so the harness can be pointed at a blank or platformer
  // project without a second fixture — see harness/main.ts.
  projection: (window as any).__projection ?? "isometric",
  genre: (window as any).__genre ?? "topdown",
  gridSize: (window as any).__gridSize ?? 64,
  activeSceneId: "scene-main",
  scenes: [
    // Two scenes, so switching between them can be driven here: one with
    // everything in it, one empty, which is what a clean canvas looks like.
    {
      id: "scene-main",
      name: "Main",
      layers: [
        {
          id: "layer-1", name: "Foreground", locked: false, visible: true,
          fills: [{ id: "fill-1", cells: [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }], kind: "color", color: "#ec3013", walkable: true }],
          // Two layers of one file, sharing an instance: on the canvas they
          // are one placed PSD, and a double-tap is what takes them apart.
          placements: [
            { id: "place-1", psdKey: "tower", layerPath: "tower", x: 0, y: 0, width: 64, height: 96, naturalWidth: 64, naturalHeight: 96, anchor: { cx: 0, cy: 0 }, instance: "psd-fixture" },
            { id: "place-2", psdKey: "tower", layerPath: "roof", x: 16, y: -24, width: 32, height: 24, naturalWidth: 32, naturalHeight: 24, anchor: { cx: 0, cy: 0 }, instance: "psd-fixture" },
          ],
          // A boundary, so selecting and dragging one can be driven here.
          zones: [
            {
              id: "zone-1",
              name: "Dock edge",
              blocking: true,
              points: [
                { x: 160, y: 0 },
                { x: 288, y: 64 },
                { x: 160, y: 128 },
                { x: 32, y: 64 },
              ],
            },
          ],
          strokes: [],
        },
        { id: "layer-2", name: "Ground", locked: false, visible: true, fills: [], placements: [], zones: [], strokes: [] },
        { id: "layer-3", name: "Backdrop", locked: true, visible: false, fills: [], placements: [], zones: [], strokes: [] },
      ],
    },
    {
      id: "scene-cave",
      name: "Cave",
      layers: [
        { id: "layer-cave", name: "Walls", locked: false, visible: true, fills: [], placements: [], zones: [], strokes: [] },
      ],
    },
  ],
};

/** A live game tree, so the code column's operations can be driven. */
const TREE: Array<{ path: string; isDir: boolean }> = [
  { path: "index.html", isDir: false },
  { path: "styles.css", isDir: false },
  { path: "js", isDir: true },
  { path: "js/main.js", isDir: false },
  { path: "js/prefabs", isDir: true },
  { path: "js/prefabs/character.js", isDir: false },
  { path: "js/scenes", isDir: true },
  { path: "js/scenes/WorldScene.js", isDir: false },
  { path: "js/shared", isDir: true },
  { path: "js/shared/grid.js", isDir: false },
  { path: "js/shared/navigation.js", isDir: false },
];

/**
 * A mock PSD stack for the inspector's layer editor, mutable so a reorder or
 * a rename can be driven end to end and read back.
 */
interface PsdRow {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Zero at the top level, one inside a group — as Rust reports it. */
  depth?: number;
}

const PSD_LAYERS: PsdRow[] = [
  { name: "P | anchor", x: 58, y: 90, width: 12, height: 12 },
  { name: "Z | grid", x: 32, y: 80, width: 64, height: 32 },
  { name: "S | tower", x: 0, y: 0, width: 128, height: 192 },
];

/**
 * A generated file's stack, one per key, kept so a reorder inside the group
 * can be driven and read back the way `tower`'s flat one can.
 *
 * Every file this editor writes has the same shape — the two marks, then the
 * artwork group with its three parts indented under it — so the stack is
 * built from the key on first ask.
 */
const GENERATED = new Map<string, PsdRow[]>();

function generatedStack(key: string): PsdRow[] {
  const held = GENERATED.get(key);
  if (held) return held;
  const suffix = key.replace(/^extrude-/, "");
  const stack: PsdRow[] = [
    { name: "P | anchor", x: 58, y: 90, width: 12, height: 12 },
    { name: "Z | grid", x: 32, y: 80, width: 64, height: 32 },
    { name: `G | ${key}`, x: 0, y: 0, width: 128, height: 192 },
    ...["lines", "shading", "shape"].map((part) => ({
      name: `S | ${part}-${suffix}`, x: 0, y: 0, width: 128, height: 192,
      depth: 1,
    })),
  ];
  GENERATED.set(key, stack);
  return stack;
}

/** What the layer list is sent: a row, at the depth the file has it. */
function layerInfo(row: PsdRow, index: number) {
  const category = categoryOf(row.name);
  return {
    index, name: row.name, visible: true, opacity: 255,
    width: row.width, height: row.height, x: row.x, y: row.y,
    category, isGroup: category === "group", depth: row.depth ?? 0,
  };
}

const CATEGORIES: Record<string, string> = {
  S: "sprite", T: "tileset", G: "group", P: "point", Z: "zone",
};

function categoryOf(name: string): string {
  const parts = name.split("|").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 4) return "ignored";
  return CATEGORIES[parts[0].toUpperCase()] ?? "ignored";
}

function psdManifest(key = "tower", stack = PSD_LAYERS): string {
  return JSON.stringify({
    name: key, width: 128, height: 192,
    layers: stack.filter((l) => categoryOf(l.name) !== "ignored").map((l) => ({
      name: l.name.split("|")[1].trim(),
      category: categoryOf(l.name),
      x: l.x, y: l.y, width: l.width, height: l.height,
    })),
  });
}

/**
 * What Rust's psd_marks::layout does, so a conversion can be checked end to
 * end: lay the artwork and the grid footprint out around the anchor, grow the
 * canvas to hold both, and report the anchor as a point layer at its centre.
 */
function markedManifest(
  name: string, width: number, height: number, marks: any,
): string {
  const art = marks?.art ?? { x: -width / 2, y: -height / 2 };
  const box = { x: art.x, y: art.y, w: width, h: height };
  const zone = marks?.outline?.length
    ? {
        x: Math.min(...marks.outline.map((p: any) => p.x)),
        y: Math.min(...marks.outline.map((p: any) => p.y)),
        w: Math.max(...marks.outline.map((p: any) => p.x))
          - Math.min(...marks.outline.map((p: any) => p.x)),
        h: Math.max(...marks.outline.map((p: any) => p.y))
          - Math.min(...marks.outline.map((p: any) => p.y)),
      }
    : box;

  const minX = Math.floor(Math.min(box.x, zone.x));
  const minY = Math.floor(Math.min(box.y, zone.y));
  const layers: any[] = [
    { name, category: "sprite", x: Math.round(box.x - minX),
      y: Math.round(box.y - minY), width, height },
  ];
  if (marks?.outline?.length) {
    layers.push({ name: "grid", category: "zone", x: Math.round(zone.x - minX),
      y: Math.round(zone.y - minY), width: Math.round(zone.w), height: Math.round(zone.h) });
    // psd-to-json reports a point as its centre, which is the anchor itself.
    layers.push({ name: "anchor", category: "point", x: -minX, y: -minY,
      width: 12, height: 12 });
  }
  return JSON.stringify({
    name,
    width: Math.ceil(Math.max(box.x + box.w, zone.x + zone.w)) - minX,
    height: Math.ceil(Math.max(box.y + box.h, zone.y + zone.h)) - minY,
    layers,
  });
}

/**
 * The stubbed contents of a file in `game/`.
 *
 * Both `read_game_file` and `read_game_template` answer with it, so the
 * harness's editor sees an untouched file — every marked line still the
 * editor's, which is where the interesting behaviour starts.
 */
function gameFile(path: string, template = false): string {
  if (path.endsWith(".json")) {
    return JSON.stringify({ projection: "orthogonal", grid: 64, layers: [] }, null, 2);
  }
  return [
    `// ${path}`,
    "export class WorldScene extends Phaser.Scene {",
    "  // idlewild:begin placeDocument",
    "  placeDocument() {",
    "    for (const layer of drawOrder(config.layers ?? [])) this.paint(layer);",
    "  }",
    "  // idlewild:end placeDocument",
    "",
    "  create() {",
    "    this.placeDocument();",
    "  }",
    "}",
    ...(template
      ? [
          "",
          "// idlewild:begin drawOrder",
          "function drawOrder(layers) {",
          "  return [...layers].reverse();",
          "}",
          "// idlewild:end drawOrder",
        ]
      : []),
    "",
  ].join("\n");
}

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  (window as any).__calls = [...((window as any).__calls ?? []), { cmd, args }];
  switch (cmd) {
    case "get_server_port": return 8123;
    case "platform": return (window as any).__platform ?? "macos";
    case "read_document": return JSON.stringify(DOC);
    case "write_document": return undefined;
    case "read_thumbnail": return null;
    case "import_image": {
      // Stands in for the marked PSD Rust writes: a 200x160 sprite centred
      // on the anchor, with the grid footprint and the anchor point beside
      // it. Canvas is the union, so the anchor sits at (100, 80).
      (window as any).__lastMarks = (args as any)?.marks ?? null;
      return {
        key: "hut",
        width: 200,
        height: 160,
        manifest: JSON.stringify({
          name: "hut", width: 200, height: 160,
          layers: [
            { name: "hut", category: "sprite", x: 0, y: 0, width: 200, height: 160 },
            { name: "grid", category: "zone", x: 68, y: 64, width: 64, height: 32 },
            { name: "anchor", category: "point", x: 100, y: 80, width: 12, height: 12 },
          ],
        }),
      };
    }
    case "import_image_bytes": {
      // The paste path. Keyed on the name the caller worked out, so a script
      // can check what a screenshot ended up called, and the base64 payload
      // is kept so it can check the bytes made it across.
      const name = String((args as any)?.name ?? "pasted");
      (window as any).__lastPaste = {
        name,
        bytes: String((args as any)?.dataBase64 ?? "").length,
        marks: (args as any)?.marks ?? null,
      };
      return {
        key: name,
        width: 120,
        height: 80,
        manifest: JSON.stringify({
          name, width: 120, height: 80,
          layers: [
            { name, category: "sprite", x: 0, y: 0, width: 120, height: 80 },
          ],
        }),
      };
    }
    case "list_projects": return [];
    // Project Options writes through this, and reads the meta it hands back.
    // Echoed rather than stored: there is no store here, and what the editor
    // does with the answer is set its own copy of the options to it.
    case "set_project_options":
      return {
        id: "demo",
        name: "Marsh Kingdom",
        projection: (window as any).__projection ?? "isometric",
        genre: (window as any).__genre ?? "topdown",
        gridSize: (window as any).__gridSize ?? 64,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        layerCount: 3,
        options: {
          pixelArt: Boolean((args as any)?.pixelArt),
          roundPixels: Boolean((args as any)?.roundPixels),
          defaultZoom: Number((args as any)?.defaultZoom ?? 1),
          character: true,
        },
      };
    // Publish's two exits write to a path the dialog stub hands back; there
    // is no store here to write out of, so both simply succeed.
    case "publish_site":
    case "export_project":
      return undefined;
    case "import_project":
      return {
        id: "imported-1",
        name: "Imported project",
        projection: "orthogonal",
        genre: "topdown",
        gridSize: 64,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        layerCount: 1,
      };
    case "list_game_files":
      return [...TREE].sort((a, b) => a.path.localeCompare(b.path));
    // A file with one managed block in it, so the code modal's read-only
    // lines, its Reset and its refusals are all reachable in the harness.
    // The template has a second block the file does not, which is what puts
    // the "add the blocks this file is missing" offer on screen.
    case "read_game_file":
      return gameFile(String((args as any).path));
    case "read_game_template":
      return gameFile(String((args as any).path), true);
    case "write_game_file": return undefined;
    case "create_game_file":
    case "create_game_dir": {
      const path = String((args as any).path);
      if (TREE.some((f) => f.path === path)) throw new Error(`${path} already exists`);
      TREE.push({ path, isDir: cmd === "create_game_dir" });
      return undefined;
    }
    case "move_game_path": {
      const { from, to } = args as Record<string, string>;
      if (TREE.some((f) => f.path === to)) throw new Error(`${to} already exists`);
      if (`${to}/`.startsWith(`${from}/`)) throw new Error("inside itself");
      for (const f of TREE) {
        if (f.path === from) f.path = to;
        else if (f.path.startsWith(`${from}/`)) f.path = to + f.path.slice(from.length);
      }
      return undefined;
    }
    case "copy_game_path": {
      const path = String((args as any).path);
      const dot = path.lastIndexOf(".");
      const copy = dot > 0
        ? `${path.slice(0, dot)} copy${path.slice(dot)}`
        : `${path} copy`;
      TREE.push({ path: copy, isDir: TREE.find((f) => f.path === path)?.isDir ?? false });
      return copy;
    }
    case "delete_game_path": {
      const path = String((args as any).path);
      for (let i = TREE.length - 1; i >= 0; i--) {
        if (TREE[i].path === path || TREE[i].path.startsWith(`${path}/`)) TREE.splice(i, 1);
      }
      return undefined;
    }
    case "open_psd": return undefined;
    case "rename_psd": {
      const a = args as Record<string, string>;
      const key = String(a.name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      return {
        key, width: 200, height: 160,
        manifest: JSON.stringify({
          name: key, width: 200, height: 160,
          layers: [
            // The layer inside keeps its own name; only the file moved.
            { name: a.key, category: "sprite", x: 0, y: 0, width: 200, height: 160 },
            { name: "anchor", category: "point", x: 100, y: 80, width: 12, height: 12 },
          ],
        }),
      };
    }
    case "duplicate_psd": {
      const a = args as Record<string, string>;
      const key = `${a.key}-copy`;
      return {
        key, width: 200, height: 160,
        manifest: JSON.stringify({
          name: key, width: 200, height: 160,
          layers: [
            { name: "hut", category: "sprite", x: 0, y: 0, width: 200, height: 160 },
            { name: "anchor", category: "point", x: 100, y: 80, width: 12, height: 12 },
          ],
        }),
      };
    }
    case "create_psd_from_rgba": {
      const a = args as any;
      (window as any).__lastRgba = {
        width: a.width, height: a.height, name: a.name, marks: a.marks ?? null,
      };
      return {
        key: String(a.name),
        width: a.width,
        height: a.height,
        manifest: markedManifest(String(a.name), a.width, a.height, a.marks),
      };
    }
    // An extrusion's artwork is a group of parts. Both routes record what
    // they were sent, so a script can read the shape of the file back.
    case "create_psd_group_from_rgba":
    case "rewrite_psd_group_from_rgba": {
      const a = args as any;
      const key = String(a.key ?? a.name);
      (window as any).__lastRgba = {
        width: a.width, height: a.height, name: key, marks: a.marks ?? null,
        parts: (a.parts ?? []).map((p: any) => p.name),
      };
      if (cmd === "rewrite_psd_group_from_rgba") {
        (window as any).__rewrites = ((window as any).__rewrites ?? 0) + 1;
      }
      return {
        key,
        width: a.width,
        height: a.height,
        manifest: markedManifest(key, a.width, a.height, a.marks),
      };
    }
    case "read_psd_bytes": return "AAAA";
    case "read_psd_layers": {
      // Only `tower` is the hand-built fixture whose stack the reorder and
      // rename paths edit. Every other key is a file this editor generated,
      // so it has the stack those always have: the artwork group under both
      // marks, with its three parts inside it.
      const asked = String((args as any).key);
      const stack = asked === "tower" ? PSD_LAYERS : generatedStack(asked);
      return {
        key: asked, width: 128, height: 192,
        writable: (window as any).__psdWritable ?? true,
        blockedBy: (window as any).__psdWritable === false
          ? "This PSD uses a layer mask, so its names and order cannot be edited here."
          : null,
        layers: stack.map(layerInfo),
      };
    }
    case "write_psd_layers": {
      const key = String((args as any).key);
      const edits = (args as any).layers as Array<
        { index: number; name: string; depth: number }
      >;
      const stack = key === "tower" ? PSD_LAYERS : generatedStack(key);
      const next = edits.map((e) => ({
        ...stack[e.index], name: e.name, depth: e.depth,
      }));
      stack.splice(0, stack.length, ...next);
      return psdManifest(key, stack);
    }
    // What pen mode reads to work out where the file's canvas falls on the
    // grid — the document's own size and its anchor mark, which is a
    // different question from where any one layer's artwork is.
    case "read_psd_manifest": {
      const key = String((args as any).key);
      return psdManifest(key, key === "tower" ? PSD_LAYERS : generatedStack(key));
    }
    // The two writes pen mode is built on. Both edit the stack this stub
    // keeps for the key, so a script can add a layer, draw into it, and read
    // the file's shape back the way the reorder paths already can.
    case "add_psd_layer": {
      const key = String((args as any).key);
      const stack = key === "tower" ? PSD_LAYERS : generatedStack(key);
      // One transparent pixel at the origin, as `psd_layers::add` writes it.
      const taken = new Set(
        stack.map((l) => l.name.split("|")[1]?.trim().toLowerCase()),
      );
      let n = 1;
      while (taken.has(`layer-${n}`)) n++;
      stack.unshift({ name: `S | layer-${n}`, x: 0, y: 0, width: 1, height: 1 });
      return psdManifest(key, stack);
    }
    case "paint_psd_layer": {
      const a = args as any;
      const key = String(a.key);
      const stack = key === "tower" ? PSD_LAYERS : generatedStack(key);
      const row = stack[Number(a.index)];
      if (!row || row.name !== a.name) {
        throw new Error(`No layer ${a.index} named ${a.name} in ${key}.psd`);
      }
      (window as any).__lastPaint = {
        key, index: Number(a.index), name: String(a.name),
        x: a.paint.x, y: a.paint.y,
        width: a.paint.width, height: a.paint.height,
      };
      // A blank layer has no rectangle worth keeping, so the first stroke
      // replaces it outright — see src-tauri/src/psd_paint.rs.
      const blank = row.width <= 1 && row.height <= 1;
      const left = blank ? a.paint.x : Math.min(row.x, a.paint.x);
      const top = blank ? a.paint.y : Math.min(row.y, a.paint.y);
      row.width = blank
        ? a.paint.width
        : Math.max(row.x + row.width, a.paint.x + a.paint.width) - left;
      row.height = blank
        ? a.paint.height
        : Math.max(row.y + row.height, a.paint.y + a.paint.height) - top;
      row.x = left;
      row.y = top;
      return psdManifest(key, stack);
    }
    case "reprocess_psd":
      // A layer the artist added in Photoshop before saving. Pushed onto the
      // real stack, because the point of a re-parse is that the file on disk
      // is not what it was — and `read_psd_layers` reads the file.
      if ((window as any).__addedPsdLayer) {
        PSD_LAYERS.push({
          name: String((window as any).__addedPsdLayer),
          x: 0, y: 0, width: 60, height: 40,
        });
        (window as any).__addedPsdLayer = null;
      }
      // Stands in for the artist having edited hut.psd in place: the canvas
      // grew by 80px on the left and 40 on top, the artwork moved with it,
      // and the anchor dot went along — so the mark is at (180, 120) now.
      return (window as any).__reparsedManifest ?? JSON.stringify({
        name: "hut", width: 280, height: 200,
        layers: [
          { name: "hut", category: "sprite", x: 80, y: 40, width: 200, height: 160 },
          { name: "grid", category: "zone", x: 148, y: 104, width: 64, height: 32 },
          { name: "anchor", category: "point", x: 180, y: 120, width: 12, height: 12 },
        ],
      });
    // The system pasteboard, which the harness has no access to: scripts set
    // __clipboard to whatever a read should find. Left unset it is empty,
    // which is what makes the fallback to the webview's clipboard reachable
    // here — the same route a Linux or Windows build takes.
    case "read_clipboard":
      return (window as any).__clipboard ?? { types: [], file: null };
    // A file dropped through the shell rather than the webview. Only macOS
    // takes this route, but a script can drive it by setting __droppedFile.
    case "read_dropped_file":
      return (
        (window as any).__droppedFile ?? {
          name: String((args as any)?.sourcePath ?? "dropped.psd").split("/").pop(),
          dataBase64: "AAAA",
        }
      );
    case "reimport_psd":
      return {
        key: "tower",
        width: 128,
        height: 192,
        manifest:
          (window as any).__manifest ??
          '{"name":"tower","width":128,"height":192,"layers":[{"name":"tower","category":"sprite","x":0,"y":0,"width":128,"height":192}]}',
      };
    default: return undefined;
  }
}
