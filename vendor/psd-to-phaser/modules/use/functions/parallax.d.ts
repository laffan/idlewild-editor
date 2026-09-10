import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
export interface ParallaxOptions {
    camera?: Phaser.Cameras.Scene2D.Camera | string;
    target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
    scrollFactor?: number;
}
export declare function parallax(_plugin: PsdToPhaserPlugin): (options: ParallaxOptions) => void;
