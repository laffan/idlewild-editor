import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
interface FillZoneOptions {
    useFrames?: number[] | string[];
    scaleRange?: [number, number];
    tint?: number[];
    minInstances?: number;
    maxInstances?: number;
}
export declare function fillZone(_plugin: PsdToPhaserPlugin): (zone: Phaser.GameObjects.Zone, sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Group, options?: FillZoneOptions) => Phaser.GameObjects.Group | undefined;
export {};
