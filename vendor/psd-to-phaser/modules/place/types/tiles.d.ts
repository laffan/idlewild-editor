import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
import { TilesetLayer, TilePlacementData } from '../../../types';
export declare function placeTiles(scene: Phaser.Scene, layer: TilesetLayer, plugin: PsdToPhaserPlugin, tileSliceSize: number, group: Phaser.GameObjects.Group, resolve: () => void, psdKey: string): void;
export declare function placeTilesInContainer(scene: Phaser.Scene, container: Phaser.GameObjects.Container, layer: TilesetLayer, tileSliceSize: number, useNamespacedKeys?: boolean, psdKey?: string): void;
export declare function placeSingleTile(scene: Phaser.Scene, tileData: TilePlacementData, parent: Phaser.GameObjects.Container | Phaser.GameObjects.Group): Phaser.GameObjects.Image | null;
export declare function applyPendingMethodCalls(container: Phaser.GameObjects.Container): void;
