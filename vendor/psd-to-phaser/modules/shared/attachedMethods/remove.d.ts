import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
export declare function createRemoveMethod(_plugin: PsdToPhaserPlugin): (this: Phaser.GameObjects.GameObject | Phaser.GameObjects.Group, pathOrOptions?: string | {
    depth?: number;
}, options?: {
    depth?: number;
}) => boolean;
export declare function attachRemoveMethod(plugin: PsdToPhaserPlugin, gameObject: Phaser.GameObjects.GameObject | Phaser.GameObjects.Group): void;
