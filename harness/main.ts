import "../src/styles/base.css";
import { mountEditor } from "../src/editor/editor";

// Test hook: the live document's first layer, for driving the editor from a
// script without going through the panels.
(window as any).__docLayers = () => {
  const w = ((window as any).__calls ?? []).filter(
    (c: { cmd: string }) => c.cmd === "write_document",
  ).pop();
  return JSON.parse(w.args.doc).layers[0];
};

void mountEditor(
  document.getElementById("app")!,
  {
    id: "demo", name: "Marsh Kingdom", projection: "isometric", gridSize: 64,
    createdAt: Date.now(), updatedAt: Date.now(), layerCount: 3,
  },
  { onBack: () => {} },
);
