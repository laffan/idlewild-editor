import { default as Phaser } from 'phaser';
import { default as loadModule } from './modules/load';
import { default as placeModule } from './modules/place';
import { default as getTextureModule } from './modules/getTexture';
import { default as getMaskModule } from './modules/getMask';
import { createCamera } from './modules/cameras/create';
import { default as useModule } from './modules/use';
import { DebugOptions, PluginOptions, ProcessedPsdData, CameraOptions } from './types';
export type { DebugOptions, PluginOptions } from './types';
export default class PsdToPhaser extends Phaser.Plugins.BasePlugin {
    private psdData;
    options: PluginOptions;
    load: ReturnType<typeof loadModule>;
    place: ReturnType<typeof placeModule>;
    getTexture: ReturnType<typeof getTextureModule>;
    getMask: ReturnType<typeof getMaskModule>;
    use: ReturnType<typeof useModule>;
    createCamera: (camera: Phaser.Cameras.Scene2D.Camera, features: string[], options?: CameraOptions) => ReturnType<typeof createCamera>;
    constructor(pluginManager: Phaser.Plugins.PluginManager);
    init(options?: PluginOptions): void;
    setData(key: string, data: ProcessedPsdData): void;
    getData(key: string): ProcessedPsdData | undefined;
    /**
     * Get all registered PSD keys
     */
    getAllKeys(): string[];
    isDebugEnabled(option: keyof DebugOptions): boolean;
}
