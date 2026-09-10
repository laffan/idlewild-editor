import { LayerAttributes } from '../../types';
interface LayerWithAttributes {
    attributes?: LayerAttributes;
}
export declare function attachAttributes(layerData: LayerWithAttributes, gameObject: object): void;
export {};
