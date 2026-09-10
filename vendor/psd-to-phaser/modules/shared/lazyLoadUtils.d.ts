import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
import { PsdLayer, BaseLayer } from '../../types';
export declare function checkIfLazyLoaded(plugin: PsdToPhaserPlugin, psdKey: string, layer: PsdLayer): boolean;
export declare function createLazyLoadPlaceholder(scene: Phaser.Scene, layerData: BaseLayer, plugin: PsdToPhaserPlugin): Phaser.GameObjects.Container;
