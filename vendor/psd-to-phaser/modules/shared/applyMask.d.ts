import { PsdLayer } from '../../types';
/**
 * Attach a Mask filter to a game object, using `maskImage` as the mask source.
 *
 * Phaser 4 removed BitmapMask: masks are now Filters, added to a game object's
 * internal filter list.
 *
 * An internal filter renders the object into its own framebuffer, so the mask has to
 * be viewed through the same camera to line up. That camera is the object's own
 * `filterCamera`, which Phaser keeps focused on the object; passing it as the mask's
 * `viewCamera` gives the world-space positioning BitmapMask had in Phaser 3. Leaving
 * it unset (or passing the scene camera) pins the mask to each object's own bounds
 * instead, which shifts the mask per object.
 *
 * Filters are WebGL only. Under the Canvas renderer `enableFilters()` returns early
 * and `filters` stays null, so this returns null and the object renders unmasked.
 *
 * @param gameObject - The game object to mask
 * @param maskImage - The (hidden) image used as the mask source
 * @returns The Mask filter controller, or null if filters are unavailable
 */
export declare function addMaskFilter(gameObject: Phaser.GameObjects.GameObject, maskImage: Phaser.GameObjects.Image): Phaser.Filters.Mask | null;
/**
 * Apply a mask to a game object if the layer has a mask defined.
 * The mask texture should already be loaded with key `${layerName}_mask`.
 *
 * @param scene - The Phaser scene
 * @param layer - The layer data that may contain mask information
 * @param gameObject - The game object to apply the mask to
 * @returns The created mask image (hidden), or null if no mask was applied
 */
export declare function applyMaskToGameObject(scene: Phaser.Scene, layer: PsdLayer, gameObject: Phaser.GameObjects.GameObject): Phaser.GameObjects.Image | null;
/**
 * Apply a mask to a container and all its children.
 * Useful for group layers with masks.
 *
 * @param scene - The Phaser scene
 * @param layer - The layer data that may contain mask information
 * @param container - The container to apply the mask to
 * @returns The created mask image (hidden), or null if no mask was applied
 */
export declare function applyMaskToContainer(scene: Phaser.Scene, layer: PsdLayer, container: Phaser.GameObjects.Container): Phaser.GameObjects.Image | null;
/**
 * Apply a SHARED mask to all children in a Phaser Group.
 * Creates ONE mask image, then adds a Mask filter for it to every child.
 *
 * Note: Mask images are converted from luminance to alpha, so grayscale masks
 * (white=visible, black=hidden) work correctly with Phaser's Mask filter, which
 * multiplies the input by the alpha of the mask.
 *
 * Each filtered child renders through its own framebuffer, so masking a large
 * group is not free - mask the smallest set of objects you can get away with.
 *
 * @param scene - The Phaser scene
 * @param layer - The layer data that contains mask information
 * @param group - The Phaser group whose children should receive the mask
 * @returns The created mask image (hidden), or null if no mask was applied
 */
export declare function applySharedMaskToGroup(scene: Phaser.Scene, layer: PsdLayer, group: Phaser.GameObjects.Group): Phaser.GameObjects.Image | null;
