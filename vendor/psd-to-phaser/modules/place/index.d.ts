import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
import { PlaceOptions } from '../../types';
export default function placeModule(plugin: PsdToPhaserPlugin): (scene: Phaser.Scene, psdKey: string, layerPath: string, options?: PlaceOptions) => Phaser.GameObjects.GameObject | Phaser.GameObjects.Group;
