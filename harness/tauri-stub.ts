/**
 * A stand-in for @tauri-apps/api/core, so the editor shell can be opened in a
 * plain browser to look at. Dev harness only — never bundled by the app.
 */

const DOC = {
  version: 1,
  projection: "isometric",
  gridSize: 64,
  layers: [
    {
      id: "layer-1", name: "Foreground", locked: false, visible: true,
      fills: [{ id: "fill-1", cells: [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }], kind: "color", color: "#ec3013", walkable: true }],
      placements: [{ id: "place-1", psdKey: "tower", layerPath: "tower", x: 0, y: 0, width: 64, height: 96, naturalWidth: 64, naturalHeight: 96, anchor: { cx: 0, cy: 0 } }],
      zones: [], strokes: [],
    },
    { id: "layer-2", name: "Ground", locked: false, visible: true, fills: [], placements: [], zones: [], strokes: [] },
    { id: "layer-3", name: "Backdrop", locked: true, visible: false, fills: [], placements: [], zones: [], strokes: [] },
  ],
};

/** A live game tree, so the code column's operations can be driven. */
const TREE: Array<{ path: string; isDir: boolean }> = [
  { path: "index.html", isDir: false },
  { path: "css", isDir: true },
  { path: "css/styles.css", isDir: false },
  { path: "js", isDir: true },
  { path: "js/WorldScene.js", isDir: false },
  { path: "js/main.js", isDir: false },
];

/**
 * A mock PSD stack for the inspector's layer editor, mutable so a reorder or
 * a rename can be driven end to end and read back.
 */
const PSD_LAYERS: Array<{ name: string; x: number; y: number; width: number; height: number }> = [
  { name: "P | anchor", x: 58, y: 90, width: 12, height: 12 },
  { name: "Z | grid", x: 32, y: 80, width: 64, height: 32 },
  { name: "S | tower", x: 0, y: 0, width: 128, height: 192 },
];

const CATEGORIES: Record<string, string> = {
  S: "sprite", T: "tileset", G: "group", P: "point", Z: "zone",
};

function categoryOf(name: string): string {
  const parts = name.split("|").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 4) return "ignored";
  return CATEGORIES[parts[0].toUpperCase()] ?? "ignored";
}

function psdManifest(): string {
  return JSON.stringify({
    name: "tower", width: 128, height: 192,
    layers: PSD_LAYERS.filter((l) => categoryOf(l.name) !== "ignored").map((l) => ({
      name: l.name.split("|")[1].trim(),
      category: categoryOf(l.name),
      x: l.x, y: l.y, width: l.width, height: l.height,
    })),
  });
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
    case "list_projects": return [];
    case "list_game_files":
      return [...TREE].sort((a, b) => a.path.localeCompare(b.path));
    case "read_game_file":
      return `// ${(args as any).path}\nexport default class WorldScene {}\n`;
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
      const a = args as Record<string, number | string>;
      (window as any).__lastRgba = { width: a.width, height: a.height, name: a.name };
      return {
        key: String(a.name),
        width: a.width,
        height: a.height,
        manifest: JSON.stringify({
          name: a.name, width: a.width, height: a.height,
          layers: [{ name: String(a.name), category: "sprite", x: 0, y: 0,
            width: a.width, height: a.height }],
        }),
      };
    }
    case "read_psd_bytes": return "AAAA";
    case "read_psd_layers":
      return {
        key: String((args as any).key), width: 128, height: 192,
        writable: (window as any).__psdWritable ?? true,
        blockedBy: (window as any).__psdWritable === false
          ? "This PSD uses layer groups, which a rewrite would flatten."
          : null,
        layers: PSD_LAYERS.map((l, index) => ({
          index, name: l.name, visible: true, opacity: 255,
          width: l.width, height: l.height, x: l.x, y: l.y,
          category: categoryOf(l.name),
        })),
      };
    case "write_psd_layers": {
      const edits = (args as any).layers as Array<{ index: number; name: string }>;
      const next = edits.map((e) => ({ ...PSD_LAYERS[e.index], name: e.name }));
      PSD_LAYERS.splice(0, PSD_LAYERS.length, ...next);
      return psdManifest();
    }
    case "reprocess_psd":
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
