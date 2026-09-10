import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
import { LazyLoadCameraOptions } from '../../../types';
export type LazyLoadOptions = LazyLoadCameraOptions;
export declare function LazyLoadCamera(plugin: PsdToPhaserPlugin, camera: Phaser.Cameras.Scene2D.Camera, options?: LazyLoadOptions): {
    update?: undefined;
    destroy?: undefined;
} | {
    update: () => void;
    destroy: () => void;
};
