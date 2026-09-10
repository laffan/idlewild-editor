import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
export interface DraggableOptions {
    useBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    easeDragging?: boolean;
    friction?: number;
    minSpeed?: number;
    ignore?: string[];
}
export declare function DraggableCamera(_plugin: PsdToPhaserPlugin, camera: Phaser.Cameras.Scene2D.Camera, options?: DraggableOptions): {
    isDragging: () => boolean;
    isPaused: () => boolean;
    getVelocity: () => Phaser.Math.Vector2;
    setOptions: (newOptions: Partial<DraggableOptions>) => void;
    pause: () => void;
    resume: () => void;
};
