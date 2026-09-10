import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
import { LoadOptions, MultiplePsdConfig } from '../../types';
export type { LoadOptions };
export default function loadModule(plugin: PsdToPhaserPlugin): {
    load(scene: Phaser.Scene, key: string, psdFolderPath: string, options?: LoadOptions): void;
    loadMultiple: (scene: Phaser.Scene, configs: MultiplePsdConfig[]) => void;
};
