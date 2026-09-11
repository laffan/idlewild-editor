/**
 * The two written guides' tables of contents.
 *
 * Kept as data rather than read off the directory: the order is editorial —
 * Loading before Layers before Cameras, because that is the order someone
 * building a game meets them — and a directory listing would be alphabetical
 * and say nothing. Both lists are phaser-bench's, unchanged; the files they
 * name are vendored under `public/data/`.
 */

import type { Topic } from "./types";

/** Phaser's concept guides, from the Phaser documentation. */
export const PHASER_CONCEPTS: Topic[] = [
  { title: "Actions", path: "actions.md" },
  { title: "Animations", path: "animations.md" },
  { title: "Audio", path: "audio.md" },
  { title: "Cameras", path: "cameras.md" },
  { title: "Data Manager", path: "data-manager.md" },
  { title: "Device", path: "device.md" },
  { title: "Display", path: "display.md" },
  { title: "Events", path: "events.md" },
  { title: "FX", path: "fx.md" },
  { title: "Game", path: "game.md" },
  {
    title: "Game Objects", path: "gameobjects.md",
    children: [
      { title: "Bitmap Text", path: "gameobjects/bitmap-text.md" },
      { title: "Blitter", path: "gameobjects/blitter.md" },
      { title: "Components", path: "gameobjects/components.md" },
      { title: "Container", path: "gameobjects/container.md" },
      { title: "Display List", path: "gameobjects/display-list.md" },
      { title: "DOM Element", path: "gameobjects/dom-element.md" },
      { title: "Factories", path: "gameobjects/factories.md" },
      { title: "Graphics", path: "gameobjects/graphics.md" },
      { title: "Group", path: "gameobjects/group.md" },
      { title: "Image", path: "gameobjects/image.md" },
      { title: "Layer", path: "gameobjects/layer.md" },
      { title: "Light", path: "gameobjects/light.md" },
      { title: "Mesh", path: "gameobjects/mesh.md" },
      { title: "Nine Slice", path: "gameobjects/nine-slice.md" },
      { title: "Particles", path: "gameobjects/particles.md" },
      { title: "Plane", path: "gameobjects/plane.md" },
      { title: "Render Texture", path: "gameobjects/render-texture.md" },
      { title: "Rope", path: "gameobjects/rope.md" },
      { title: "Shader", path: "gameobjects/shader.md" },
      { title: "Sprite", path: "gameobjects/sprite.md" },
      { title: "Text", path: "gameobjects/text.md" },
      { title: "Tile Sprite", path: "gameobjects/tile-sprite.md" },
      { title: "Video", path: "gameobjects/video.md" },
    ],
  },
  { title: "Geometry", path: "geometry.md" },
  { title: "Input", path: "input.md" },
  { title: "Loader", path: "loader.md" },
  { title: "Math", path: "math.md" },
  {
    title: "Physics", path: "physics.md",
    children: [
      { title: "Arcade Physics", path: "physics/arcade.md" },
      { title: "Matter Physics", path: "physics/matter.md" },
    ],
  },
  { title: "Scale Manager", path: "scale-manager.md" },
  {
    title: "Scenes", path: "scenes.md",
    children: [
      { title: "Cross-Scene Communication", path: "scenes/cross-scene-communication.md" },
    ],
  },
  { title: "Textures", path: "textures.md" },
  { title: "Time", path: "time.md" },
  { title: "Tweens", path: "tweens.md" },
  { title: "Utils", path: "utils.md" },
];

/** psd-to-phaser's own docs — the runtime this editor is built around. */
export const P2P_TOPICS: Topic[] = [
  {
    title: "Loading", path: "loading/load.mdx",
    children: [
      { title: "Load Multiple", path: "loading/load-multiple.mdx" },
    ],
  },
  {
    title: "Layers", path: "layers/place.mdx",
    children: [
      { title: "Remove", path: "layers/remove.mdx" },
      { title: "Target", path: "layers/target.mdx" },
    ],
  },
  {
    title: "Cameras", path: "cameras/overview.mdx",
    children: [
      { title: "Lazy Load", path: "cameras/lazy-load.mdx" },
      { title: "Draggable", path: "cameras/draggable.mdx" },
      { title: "Combined", path: "cameras/combined.mdx" },
    ],
  },
  {
    title: "Get", path: "get/get-data.mdx",
    children: [
      { title: "Get Texture", path: "get/get-texture.mdx" },
    ],
  },
  {
    title: "Presets", path: "presets/button.mdx",
    children: [
      { title: "Fill Zone", path: "presets/fill-zone.mdx" },
      { title: "Joystick", path: "presets/joystick.mdx" },
      { title: "Pan To", path: "presets/pan-to.mdx" },
      { title: "Parallax", path: "presets/parallax.mdx" },
    ],
  },
  {
    title: "Other", path: "other/debugging.mdx",
    children: [
      { title: "Gotchas", path: "other/gotchas.mdx" },
    ],
  },
];
