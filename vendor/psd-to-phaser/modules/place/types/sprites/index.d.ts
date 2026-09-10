import { default as PsdToPhaserPlugin } from '../../../../PsdToPhaser';
import { SpriteLayer } from '../../../../types';
export declare function placeSprites(scene: Phaser.Scene, spriteData: SpriteLayer, plugin: PsdToPhaserPlugin, group: Phaser.GameObjects.Group, resolve: () => void, psdKey: string, animationOptions?: Phaser.Types.Animations.Animation): void;
