import { default as PsdToPhaserPlugin } from '../PsdToPhaser';
/**
 * Result object from getMask containing the mask image and a way to apply it
 */
export interface MaskResult {
    /** The hidden image used as the mask source */
    maskImage: Phaser.GameObjects.Image;
    /**
     * Apply this mask to a game object.
     *
     * Phaser 4 has no standalone mask object to pass around: a mask is a Filter that
     * lives on the object it masks, so masking happens through this method.
     *
     * @param gameObject - The game object to mask
     * @returns The Mask filter controller, or null if filters are unavailable (Canvas renderer)
     */
    applyTo: (gameObject: Phaser.GameObjects.GameObject) => Phaser.Filters.Mask | null;
}
export default function getMaskModule(plugin: PsdToPhaserPlugin): (scene: Phaser.Scene, psdKey: string, layerPath: string) => MaskResult | null;
