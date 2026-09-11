import { describe, expect, it } from "vitest";
import { colliderPanel } from "../inspect-collider";
import { Grid } from "../../lib/grid";
import type { Collider, Extrusion, Layer, Placement } from "../../lib/types";

const ortho = new Grid("orthogonal", 64);
const iso = new Grid("isometric", 64);
const blank = new Grid("blank", 64);

function placement(over: Partial<Placement> = {}): Placement {
  return {
    id: "p1",
    psdKey: "tower",
    layerPath: "tower",
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    anchor: { cx: 0, cy: 0 },
    instance: "u1",
    ...over,
  };
}

function layers(...placements: Placement[]): Layer[] {
  return [
    {
      id: "l1",
      name: "Layer 1",
      locked: false,
      visible: true,
      fills: [],
      placements,
      zones: [],
      strokes: [],
    },
  ];
}

/**
 * The section has to say something and offer the way in **before** the
 * document has been told what a file blocks. Every placed key gets a record
 * written for it — on import, and on open for older documents — but a panel
 * written against that being true shows an empty section in exactly the
 * moment somebody first goes looking for the collider, which is how this came
 * back reported as "there is no button".
 */
describe("a key the document has not been told about", () => {
  it("still offers the way in, and says what it would block", () => {
    const panel = colliderPanel(ortho, layers(placement()), undefined, "tower");
    expect(panel.canEdit).toBe(true);
    expect(panel.blocks).toBe(true);
    expect(panel.shape).toBe("1 space · default");
    expect(panel.toggle).toBe("Make walkable");
  });

  it("derives the same shape the document is about to be given", () => {
    const solid: Extrusion = {
      anchor: { cx: 0, cy: 0 },
      voxels: ["0,0,0", "0,0,1", "1,0,2"],
    };
    const panel = colliderPanel(
      iso,
      layers(placement()),
      undefined,
      "tower",
      solid,
    );
    // Only the block resting on the ground, which is what an isometric
    // extrusion's collider is.
    expect(panel.shape).toBe("1 space · default");
  });

  it("has an answer even for a key with nothing placed", () => {
    const panel = colliderPanel(ortho, layers(), undefined, "ghost");
    expect(panel.canEdit).toBe(true);
    expect(panel.shape).toBe("no spaces · default");
  });
});

describe("a key the document holds", () => {
  const held: Record<string, Collider> = {
    tower: {
      cells: [
        { cx: 0, cy: 0 },
        { cx: 1, cy: 0 },
      ],
      blocking: false,
      edited: true,
    },
  };

  it("shows what it holds rather than what it would have guessed", () => {
    const panel = colliderPanel(ortho, layers(placement()), held, "tower");
    expect(panel.blocks).toBe(false);
    expect(panel.shape).toBe("2 spaces · edited");
    expect(panel.toggle).toBe("Make blocking");
  });
});

describe("a project with no grid to draw on", () => {
  it("replaces the way in rather than offering one that would be refused", () => {
    const panel = colliderPanel(
      blank,
      layers(placement({ width: 200, height: 120 })),
      undefined,
      "tower",
    );
    expect(panel.canEdit).toBe(false);
    expect(panel.shape).toBe("200 × 120 px · default");
  });
});
