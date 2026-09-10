import "../src/styles/base.css";
import { mountEditor } from "../src/editor/editor";

void mountEditor(
  document.getElementById("app")!,
  {
    id: "demo", name: "Marsh Kingdom", projection: "isometric", gridSize: 64,
    createdAt: Date.now(), updatedAt: Date.now(), layerCount: 3,
  },
  { onBack: () => {} },
);
