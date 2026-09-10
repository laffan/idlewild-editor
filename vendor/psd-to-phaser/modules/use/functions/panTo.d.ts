import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
export interface PanToOptions {
    targetPositionY?: 'center' | 'top' | 'bottom';
    targetPositionX?: 'center' | 'left' | 'right';
    targetOffset?: [number, number];
    speed?: number;
    easing?: boolean;
}
export declare function panTo(_plugin: PsdToPhaserPlugin): (camera: Phaser.Cameras.Scene2D.Camera, target: Phaser.GameObjects.GameObject | [number, number], options?: PanToOptions) => void;
