import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
type MethodName = string;
export default function attachSpriteMethods(plugin: PsdToPhaserPlugin, gameObject: Phaser.GameObjects.GameObject | Phaser.GameObjects.Group): void;
export declare function attachGroupMethods(plugin: PsdToPhaserPlugin, group: Phaser.GameObjects.Group): void;
export declare function attachIndividualMethods(_plugin: PsdToPhaserPlugin, gameObject: Phaser.GameObjects.GameObject): void;
export declare function createGroupMethod(_plugin: PsdToPhaserPlugin, methodName: MethodName): (this: Phaser.GameObjects.Group, ...args: any[]) => void;
export declare function applyMethodRecursively(gameObject: Phaser.GameObjects.GameObject | Phaser.GameObjects.Group, methodName: MethodName, args: any[], maxDepth: number, currentDepth: number): void;
export {};
