import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
interface JoystickOptions {
    bounceBack?: boolean;
    springStrength?: number;
    joystickRadius?: number;
}
interface ControlOptions {
    type: "speed" | "velocity" | "unit" | "tracked";
    force?: number;
    maxSpeed?: number;
    pixels?: number;
    directionLock?: 4 | 8 | false;
    repeatRate?: number;
    multiplier?: number;
}
interface TargetedObject extends Phaser.GameObjects.Sprite {
    width: number;
    height: number;
}
export declare function joystick(_plugin: PsdToPhaserPlugin): (joystickObject: TargetedObject, zoneObject: Phaser.GameObjects.Zone, key: string, options?: JoystickOptions) => {
    control: (spriteToControl: Phaser.GameObjects.Sprite, controlOptions: ControlOptions) => {
        destroy: () => void;
    };
    destroy: () => void;
};
export {};
