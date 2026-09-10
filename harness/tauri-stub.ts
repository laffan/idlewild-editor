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
      placements: [{ id: "place-1", psdKey: "tower", layerPath: "S | tower", x: 0, y: 0, width: 64, height: 96, naturalWidth: 64, naturalHeight: 96, anchor: { cx: 0, cy: 0 } }],
      zones: [], strokes: [],
    },
    { id: "layer-2", name: "Ground", locked: false, visible: true, fills: [], placements: [], zones: [], strokes: [] },
    { id: "layer-3", name: "Backdrop", locked: true, visible: false, fills: [], placements: [], zones: [], strokes: [] },
  ],
};

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  (window as any).__calls = [...((window as any).__calls ?? []), { cmd, args }];
  switch (cmd) {
    case "get_server_port": return 8123;
    case "platform": return (window as any).__platform ?? "macos";
    case "read_document": return JSON.stringify(DOC);
    case "write_document": return undefined;
    case "read_thumbnail": return null;
    case "list_projects": return [];
    case "list_game_files":
      return [
        { path: "index.html", isDir: false },
        { path: "js", isDir: true },
        { path: "js/WorldScene.js", isDir: false },
        { path: "js/main.js", isDir: false },
      ];
    case "read_game_file":
      return "// harness stub\nexport default class WorldScene {}\n";
    case "write_game_file": return undefined;
    case "open_psd": return undefined;
    case "read_psd_bytes": return "AAAA";
    case "reimport_psd":
      return {
        key: "tower",
        width: 128,
        height: 192,
        manifest:
          (window as any).__manifest ??
          '{"name":"tower","width":128,"height":192,"layers":[{"name":"S | tower","category":"sprite","x":0,"y":0,"width":128,"height":192}]}',
      };
    default: return undefined;
  }
}
