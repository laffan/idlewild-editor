import { TilesetLayer, TileLoadData } from '../../types';
export declare function loadSingleTile(scene: Phaser.Scene, tileData: TileLoadData, basePath: string, tileSliceSize: number, onComplete: () => void, debug: boolean): void;
export declare function loadTiles(scene: Phaser.Scene, tiles: TilesetLayer[], basePath: string, tileSliceSize: number, onProgress: () => void, debug: boolean, remainingAssets: string[]): void;
