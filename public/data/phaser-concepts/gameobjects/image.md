# Image

An Image is a light-weight Game Object useful for the display of static images in your game, such as logos, backgrounds, scenery or other non-animated elements. Images can have input events and physics bodies, or be tweened, tinted or scrolled. The main difference between an Image and a Sprite is that you cannot animate an Image as they do not have the Animation component.

## Load texture[​](#load-texture "Direct link to Load texture")

```
this.load.image(key, url);
```

Reference: [load image](/phaser/concepts/loader#image)

## Add image object[​](#add-image-object "Direct link to Add image object")

```
var image = this.add.image(x, y, key);
// var image = this.add.image(x, y, key, frame);
```

Add image from JSON

```
var image = this.make.image({
    x: 0,
    y: 0,
    key: '',
    // frame: '',

    // angle: 0,
    // alpha: 1,
    // flipX: true,
    // flipY: true,
    // scale : {
    //    x: 1,
    //    y: 1
    //},
    // origin: {x: 0.5, y: 0.5},

    add: true
});
```

*   `key`, `frame` :
    *   A string
    *   An array of string to pick one element at random
*   `x`, `y`, `scale.x`, `scale.y` :
    *   A number
        
    *   A callback to get return value
        
        ```
        function() { return 0; }
        ```
        
    *   Random integer between min and max
        
        ```
        { randInt: [min, max] }
        ```
        
    *   Random float between min and max
        
        ```
        { randFloat: [min, max] }
        ```
        

## Custom class[​](#custom-class "Direct link to Custom class")

```
class MyImage extends Phaser.GameObjects.Image {
    constructor(scene, x, y, texture, frame) {
        super(scene, x, y, texture, frame);
        // ...
        this.add.existing(this);
    }
    // ...

    // preUpdate(time, delta) {}
}
```

*   `this.add.existing(gameObject)` : Adds an existing Game Object to this Scene.
    *   If the Game Object renders, it will be added to the Display List.
    *   If it has a `preUpdate` method, it will be added to the Update List.

Example

```
var image = new MyImage(scene, x, y, key);
```

## Texture[​](#texture "Direct link to Texture")

See [game object - texture](/phaser/concepts/gameobjects#textures)

## Other properties[​](#other-properties "Direct link to Other properties")

See [game object](/phaser/concepts/gameobjects)

## Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = image.createBitmapMask();
```

See [mask](/phaser/concepts/display#masks)

## Shader effects[​](#shader-effects "Direct link to Shader effects")

Support [preFX and postFX effects](/phaser/concepts/gameobjects/shader)

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
