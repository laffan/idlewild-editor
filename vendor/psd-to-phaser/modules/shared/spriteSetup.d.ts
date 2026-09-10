import { SpriteLayer } from '../../types';
/**
 * Common setup for a single sprite game object.
 * Applies standard configuration: name, origin, depth, attributes, and mask.
 *
 * @param scene - The Phaser scene
 * @param layer - The sprite layer data
 * @param gameObject - The sprite to configure
 */
export declare function setupSprite(scene: Phaser.Scene, layer: SpriteLayer, gameObject: Phaser.GameObjects.Sprite): void;
/**
 * Common setup for a sprite group.
 * Applies standard configuration: name, depth, attributes.
 *
 * @param layer - The sprite layer data
 * @param group - The group to configure
 */
export declare function setupSpriteGroup(layer: SpriteLayer, group: Phaser.GameObjects.Group): void;
/**
 * Apply a shared mask to all children in a group if the layer has a mask.
 * Creates ONE mask and applies it to ALL children (masks are global in Phaser).
 *
 * @param scene - The Phaser scene
 * @param layer - The sprite layer data
 * @param group - The group whose children should receive the mask
 */
export declare function applyMaskToGroupChildren(scene: Phaser.Scene, layer: SpriteLayer, group: Phaser.GameObjects.Group): void;
/**
 * Get the actual texture key to use, preferring the provided key over the layer name.
 *
 * @param layer - The sprite layer data
 * @param textureKey - Optional override texture key
 * @returns The texture key to use
 */
export declare function getTextureKey(layer: SpriteLayer, textureKey?: string): string;
/**
 * Setup for individual sprite instances within a group (atlas/spritesheet).
 * Applies: name, origin, depth.
 *
 * @param sprite - The sprite to configure
 * @param name - The instance name
 * @param depth - The depth value
 */
export declare function setupSpriteInstance(sprite: Phaser.GameObjects.Sprite, name: string, depth: number): void;
