import { SpriteLayer } from '../../types';
export declare function loadSprites(scene: Phaser.Scene, sprites: SpriteLayer[], basePath: string, onProgress: () => void, debug: boolean): Promise<void>;
/**
 * Load a mask image for a layer
 */
export declare function loadMaskImage(scene: Phaser.Scene, layerName: string, basePath: string, maskPath: string, onProgress: () => void, debug: boolean): void;
