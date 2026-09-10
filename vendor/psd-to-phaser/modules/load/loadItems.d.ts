import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
import { CategorizedLayers, TileLoadData } from '../../types';
interface ExtendedCategorizedLayers extends CategorizedLayers {
    singleTiles?: TileLoadData[];
}
export declare function loadItems(scene: Phaser.Scene, key: string, data: ExtendedCategorizedLayers, plugin: PsdToPhaserPlugin): void;
export {};
