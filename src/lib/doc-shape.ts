/**
 * The shapes a document is made of, and the one migration it goes through.
 *
 * Split from `doc-store.ts` for the line limit, and it splits cleanly: none
 * of this holds any state or touches the store. It is what an empty layer
 * is, what a copy of one is, and what a document read off disk has to be
 * turned into before anything else reads it.
 */

import type { GameDoc, Layer, Placement, Scene, StoredDoc } from "./types";

let nextId = 0;
export function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
}

/**
 * A document with scenes in it, whatever it arrived as.
 *
 * Projects written before scenes existed keep their layers and their camera
 * at the top level. Those become one scene called Main — which is what they
 * always were, named for the first time. A document that already has scenes
 * is checked rather than trusted: an `activeSceneId` naming a scene that is
 * not there would be an editor with nowhere to draw, and hand-edited
 * documents are a thing this app invites.
 */
export function withScenes(doc: StoredDoc): GameDoc {
  const { layers: legacyLayers, camera: legacyCamera, ...rest } = doc;

  const scenes =
    Array.isArray(doc.scenes) && doc.scenes.length > 0
      ? doc.scenes
      : [
          {
            id: makeId("scene"),
            name: "Main",
            layers: legacyLayers ?? [emptyLayer("Terrain")],
            ...(legacyCamera ? { camera: legacyCamera } : {}),
          },
        ];

  const named = doc.activeSceneId;
  const active =
    named && scenes.some((s) => s.id === named) ? named : scenes[0].id;

  return {
    ...rest,
    version: 2,
    scenes: withPoints(scenes),
    activeSceneId: active,
  };
}

/**
 * Scenes whose layers all have a `points` list.
 *
 * `Layer.points` is younger than the documents in the wild, and a layer read
 * off disk without one would be a `points` of `undefined` behind a type that
 * says otherwise — a crash the first time anything maps over it. The
 * alternative is `?? []` at every reader, in the renderer, the picker, the
 * panels and the config; doing it once here is what keeps the type honest.
 *
 * A document that needs nothing is handed straight back, array identity and
 * all: a migration that rebuilt every scene on every open would be a
 * migration nobody could tell had not run.
 */
function withPoints(scenes: Scene[]): Scene[] {
  const has = (layer: Layer) => Array.isArray(layer.points);
  if (scenes.every((scene) => scene.layers.every(has))) return scenes;
  return scenes.map((scene) => ({
    ...scene,
    layers: scene.layers.map((layer) => (has(layer) ? layer : { ...layer, points: [] })),
  }));
}

/** The one layer a scene is never without. */
export function emptyLayer(fallback: string, name?: string): Layer {
  return {
    id: makeId("layer"),
    name: name ?? fallback,
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    points: [],
    zones: [],
    strokes: [],
  };
}

/**
 * A layer and everything on it, under new ids.
 *
 * Strokes are copied too. They are the one thing that does not reach a
 * publish, but a duplicated scene you then drew over would otherwise share
 * its ink with the original — the strokes are stored by id and the drawing
 * layer diffs by identity.
 */
export function copyLayer(layer: Layer, points = new Map<string, string>()): Layer {
  return {
    ...layer,
    id: makeId("layer"),
    fills: layer.fills.map((fill) => ({ ...fill, id: makeId("fill") })),
    placements: copyPlacements(layer.placements),
    // The map is what lets the duplicate scene keep its own start point: the
    // ids all change, so the scene's `startPointId` has to be translated
    // rather than carried over.
    points: layer.points.map((point) => {
      const id = makeId("point");
      points.set(point.id, id);
      return { ...point, id };
    }),
    zones: layer.zones.map((zone) => ({ ...zone, id: makeId("zone") })),
    strokes: layer.strokes.map((stroke) => ({ ...stroke, id: makeId("stroke") })),
  };
}

/**
 * Placements, with their units kept together.
 *
 * The placements one PSD arrived as share an `instance`, and that is what
 * makes them drag as one thing. Minting a fresh id per placement without
 * remapping the instance would leave a copy whose parts each think they
 * belong to the original's unit.
 */
function copyPlacements(placements: readonly Placement[]): Placement[] {
  const units = new Map<string, string>();
  return placements.map((placement) => {
    const copy: Placement = { ...placement, id: makeId("place") };
    if (placement.instance) {
      const mapped = units.get(placement.instance) ?? makeId("unit");
      units.set(placement.instance, mapped);
      copy.instance = mapped;
    }
    return copy;
  });
}
