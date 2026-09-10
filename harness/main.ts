import "../src/styles/base.css";
import { mountEditor } from "../src/editor/editor";

// Test hook: the live document's first layer, for driving the editor from a
// script without going through the panels.
(window as any).__docLayers = () => {
  // The live store when the scene is up — the document as it is right now,
  // rather than as of the last save, and available before the first write.
  const scene = (window as any).__idlewildScene;
  if (scene?.store) return scene.store.layers[0];
  const w = ((window as any).__calls ?? []).filter(
    (c: { cmd: string }) => c.cmd === "write_document",
  ).pop();
  return JSON.parse(w.args.doc).layers[0];
};

// The fixture's template and style, so a blank canvas or a platformer can be
// opened here without a second harness. The stub document reads the same
// globals, and both have to be set before the editor mounts.
const projection = (window as any).__projection ?? "isometric";
const genre = (window as any).__genre ?? "topdown";

void mountEditor(
  document.getElementById("app")!,
  {
    id: "demo",
    name: "Marsh Kingdom",
    projection,
    genre,
    gridSize: (window as any).__gridSize ?? 64,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    layerCount: 3,
  },
  { onBack: () => {} },
);
