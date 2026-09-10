import { default as PsdToPhaserPlugin } from '../../../PsdToPhaser';
type VisibleGameObject = Phaser.GameObjects.GameObject & {
    setVisible(value: boolean): void;
};
interface ButtonImages {
    normal: VisibleGameObject;
    hover?: VisibleGameObject;
    active?: VisibleGameObject;
}
interface ButtonCallbacks {
    click?: (button: Phaser.GameObjects.GameObject, eventData: any, pointer: Phaser.Input.Pointer) => void;
    mouseOver?: (button: Phaser.GameObjects.GameObject, eventData: any, pointer: Phaser.Input.Pointer) => void;
    mouseOut?: (button: Phaser.GameObjects.GameObject, eventData: any, pointer: Phaser.Input.Pointer) => void;
    mousePress?: (button: Phaser.GameObjects.GameObject, eventData: any, pointer: Phaser.Input.Pointer) => void;
}
type ButtonInput = [VisibleGameObject, (button: Phaser.GameObjects.GameObject, eventData: any, pointer: Phaser.Input.Pointer) => void] | [VisibleGameObject, VisibleGameObject, (button: Phaser.GameObjects.GameObject, eventData: any, pointer: Phaser.Input.Pointer) => void] | [ButtonImages, ButtonCallbacks];
export declare function button(_plugin: PsdToPhaserPlugin): (input: ButtonInput) => {
    destroy: () => void;
    getCurrentState: () => "normal" | "hover" | "active";
    showState: (stateName: "normal" | "hover" | "active") => void;
} | undefined;
export {};
