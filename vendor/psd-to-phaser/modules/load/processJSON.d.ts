import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
import { PsdDocument, LoadOptions } from '../../types';
export declare function processJSON(scene: Phaser.Scene, key: string, data: PsdDocument, psdFolderPath: string, plugin: PsdToPhaserPlugin, options?: LoadOptions): void;
