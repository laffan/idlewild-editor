import { default as PsdToPhaserPlugin } from '../PsdToPhaser';
export default function getTextureModule(plugin: PsdToPhaserPlugin): (scene: Phaser.Scene, psdKey: string, spritePath: string) => Phaser.Textures.Texture | null;
