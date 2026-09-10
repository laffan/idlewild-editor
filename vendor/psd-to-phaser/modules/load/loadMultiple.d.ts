import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
export interface MultiplePsdConfig {
    key: string;
    path: string;
    position: {
        x: number;
        y: number;
    };
    lazyLoad?: boolean | string[];
}
export declare function loadMultiple(plugin: PsdToPhaserPlugin): (scene: Phaser.Scene, configs: MultiplePsdConfig[]) => void;
