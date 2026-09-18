/**
 * ColorHunt's popular list — mostly fours rather than fives.
 *
 * Carried over from simple-tileset-generator's `swatches/colorhunt.json`. See
 * `index.ts` for why these are a module rather than five files fetched at
 * runtime.
 */

import type { PaletteSource } from "./types";

export const colorhunt: PaletteSource = {
  id: "colorhunt",
  name: "ColorHunt",
  url: "https://colorhunt.co/palettes/popular",
  palettes: [
    ["#eeeeee", "#00adb5", "#393e46", "#222831"],
    ["#6a2c70", "#b83b5e", "#f08a5d", "#f9ed69"],
    ["#95e1d3", "#eaffd0", "#fce38a", "#f38181"],
    ["#eaeaea", "#ff2e63", "#252a34", "#08d9d6"],
    ["#fc5185", "#f5f5f5", "#3fc1c9", "#364f6b"],
    ["#ffffd2", "#fcbad3", "#aa96da", "#a8d8ea"],
    ["#71c9ce", "#a6e3e9", "#cbf1f5", "#e3fdfd"],
    ["#40514e", "#11999e", "#30e3ca", "#e4f9f5"],
    ["#8785a2", "#f6f6f6", "#ffe2e2", "#ffc7c7"],
    ["#abedd8", "#46cdcf", "#3d84a8", "#48466d"],
    ["#112d4e", "#3f72af", "#dbe2ef", "#f9f7f7"],
    ["#ffde7d", "#f6416c", "#f8f3d4", "#00b8a9"],
    ["#53354a", "#903749", "#e84545", "#2b2e4a"],
    ["#311d3f", "#522546", "#88304e", "#e23e57"],
    ["#14ffec", "#0d7377", "#323232", "#212121"],
    ["#a5dee5", "#e0f9b5", "#fefdca", "#ffcfdf"],
    ["#61c0bf", "#bbded6", "#fae3d9", "#ffb6b9"],
    ["#ffaaa5", "#ffd3b6", "#dcedc1", "#a8e6cf"],
    ["#cca8e9", "#c3bef0", "#cadefc", "#defcf9"],
    ["#3e4149", "#444f5a", "#ff9999", "#ffc8c8"],
    ["#ff165d", "#ff9a00", "#f6f7d7", "#3ec1d3"],
    ["#521262", "#6639a6", "#3490de", "#6fe7dd"],
    ["#355c7d", "#6c5b7b", "#c06c84", "#f67280"],
    ["#ffd460", "#f07b3f", "#ea5455", "#2d4059"],
    ["#edb1f1", "#d59bf6", "#9896f1", "#8ef6e4"],
    ["#99ddcc", "#f6f6f6", "#ffe2e2", "#bad7df"],
    ["#c4edde", "#7ac7c4", "#f73859", "#384259"],
    ["#cabbe9", "#ffcef3", "#fdfdfd", "#a1eafb"],
    ["#ff8c94", "#ffaaa6", "#ffd3b5", "#dcedc2"],
    ["#ff5722", "#eeeeee", "#00adb5", "#303841"],
  ],
};
