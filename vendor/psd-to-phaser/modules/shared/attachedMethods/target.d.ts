import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
export declare function createTargetMethod(plugin: PsdToPhaserPlugin): (this: Phaser.GameObjects.GameObject | Phaser.GameObjects.Group, path?: string, options?: {
    depth?: number;
}) => Phaser.GameObjects.GameObject | Phaser.GameObjects.Group | null;
export declare function attachTargetMethod(plugin: PsdToPhaserPlugin, gameObject: Phaser.GameObjects.GameObject | Phaser.GameObjects.Group): void;
