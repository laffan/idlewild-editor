import { default as PsdToPhaserPlugin } from '../../PsdToPhaser';
/**
 * Debug colors for different layer types
 */
export declare const DEBUG_COLORS: {
    readonly sprite: 65280;
    readonly tileset: 16711680;
    readonly zone: 255;
    readonly point: 16711680;
    readonly group: 16776960;
};
export type DebugLayerType = keyof typeof DEBUG_COLORS;
/**
 * Options for debug visualization
 */
export interface DebugVisualizationOptions {
    /** Layer type determines color and shape style */
    type: DebugLayerType;
    /** Layer name for the label */
    name: string;
    /** X position */
    x: number;
    /** Y position */
    y: number;
    /** Width (for rectangles) */
    width?: number;
    /** Height (for rectangles) */
    height?: number;
    /** For zones: polygon points or rectangle from subpaths */
    zoneShape?: Phaser.Geom.Polygon | Phaser.Geom.Rectangle;
}
/**
 * Result containing created debug objects
 */
export interface DebugVisualizationResult {
    shape: Phaser.GameObjects.Graphics | Phaser.GameObjects.Arc | null;
    label: Phaser.GameObjects.Text | null;
}
/**
 * Add debug visualization for a layer.
 *
 * This is the consolidated debug visualization function that replaces
 * duplicated addDebugVisualization functions across placement modules.
 *
 * @param scene - The Phaser scene
 * @param plugin - The PsdToPhaser plugin (for debug settings)
 * @param group - The group to add debug objects to
 * @param options - Visualization options
 * @returns The created debug objects
 */
export declare function addDebugVisualization(scene: Phaser.Scene, plugin: PsdToPhaserPlugin, group: Phaser.GameObjects.Group, options: DebugVisualizationOptions): DebugVisualizationResult;
/**
 * Helper to get center of a zone shape
 */
export declare function getZoneShapeCenter(shape: Phaser.Geom.Polygon | Phaser.Geom.Rectangle): {
    x: number;
    y: number;
};
