# Plane

The Plane Game Object is a helper class that takes the Mesh Game Object and extends it, allowing for fast and easy creation of Planes. A Plane is a one-sided grid of cells, where you specify the number of cells in each dimension. The Plane can have a texture that is either repeated (tiled) across each cell, or applied to the full Plane.

The Plane can then be manipulated in 3D space, with rotation across all 3 axis.

This allows you to create effects not possible with regular Sprites, such as perspective distortion. You can also adjust the vertices on a per-vertex basis. Plane data becomes part of the WebGL batch, just like standard Sprites, so doesn't introduce any additional shader overhead. Because the Plane just generates vertices into the WebGL batch, like any other Sprite, you can use all of the common Game Object components on a Plane too, such as a custom pipeline, mask, blend mode or texture.

You can use the `uvScroll` and `uvScale` methods to adjust the placement and scaling of the texture if this Plane is using a single texture, and not a frame from a texture atlas or sprite sheet.

The Plane Game Object also has the Animation component, allowing you to play animations across the Plane just as you would with a Sprite. The animation frame size must be fixed as the first frame will be the size of the entire animation, for example use a `SpriteSheet`.

Note that the Plane object is WebGL only and does not have a Canvas counterpart.

The Plane origin is always 0.5 x 0.5 and _cannot be changed_.

## Load texture[​](#load-texture "Direct link to Load texture")

```
this.load.image(key, url);
```

Reference: [load image](/phaser/concepts/loader#image)

## Add plane object[​](#add-plane-object "Direct link to Add plane object")

```
var plane = this.add.plane(x, y, key);
// var plane = this.add.plane(x, y, key, frame);
// var plane = this.add.plane(x, y, texture, frame, width, height, tile);
```

*   `x`, `y` : Position
*   `key`, `frame` : Texture key of
*   `width`, `height` : The width/height of this Plane, **in cells**, not pixels.
*   `tile` : Is the texture tiled? I.e. repeated across each cell.

Add plane from JSON

```
var plane = this.make.plane({
    x: 0,
    y: 0,
    key: '',
    // frame: '',
    // width: 8,
    // height: 8,
    // tile: false,
    // checkerboard: null,
    // checkerboard: { color1, color2, alpha1, alpha2, height }

    // angle: 0,
    // alpha: 1,
    // scale : {
    //    x: 1,
    //    y: 1
    //},
    // origin: {x: 0.5, y: 0.5},

    add: true
});
```

## Custom class[​](#custom-class "Direct link to Custom class")

*   Define class
    
    ```
    class MyPlane extends Phaser.GameObjects.Plane {
        constructor(scene, x, y, texture, frame, width, height, tile) {
            super(scene, x, y, texture, frame, width, height, tile);
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
*   Create instance
    
    ```
    var plane = new MyPlane(scene, x, y, texture, frame, width, height, tile);
    ```
    

## Texture[​](#texture "Direct link to Texture")

See [game object - texture](/phaser/concepts/gameobjects#textures)

## Animation[​](#animation "Direct link to Animation")

See [Sprite's animation section](/phaser/concepts/gameobjects/sprite#animation).

### Play animation[​](#play-animation "Direct link to Play animation")

*   Play
    
    ```
    plane.play(key);
    // plane.play(key, ignoreIfPlaying);
    ```
    
    *   `key` : Animation key string, or animation config
        *   String key of animation
            
        *   Animation config, to override default config
            
            ```
            {
                key,
                frameRate,
                duration,
                delay,
                repeat,
                repeatDelay,
                yoyo,
                showOnStart,
                hideOnComplete,
                startFrame,
                timeScale
            }
            ```
            
*   Play in reverse
    
    ```
    plane.playReverse(key);
    // plane.playReverse(key, ignoreIfPlaying);
    ```
    
    *   `key` : Animation key string, or animation config
*   Play after delay
    
    ```
    plane.playAfterDelay(key, delay);
    ```
    
    *   `key` : Animation key string, or animation config
*   Play after repeat
    
    ```
    plane.playAfterRepeat(key, repeatCount);
    ```
    
    *   `key` : Animation key string, or animation config

### Stop[​](#stop "Direct link to Stop")

*   Immediately stop
    
    ```
    plane.stop();
    ```
    
*   Stop after delay
    
    ```
    plane.stopAfterDelay(delay);
    ```
    
*   Stop at frame
    
    ```
    plane.stopOnFrame(frame);
    ```
    
    *   `frame` : Frame object in current animation.
        
        ```
        var currentAnim = plane.anims.currentAnim;
        var frame = currentAnim.getFrameAt(index);
        ```
        
*   Stop after repeat
    
    ```
    plane.stopAfterRepeat(repeatCount);
    ```
    

### Properties[​](#properties "Direct link to Properties")

*   Has started
    
    ```
    var hasStarted = plane.anims.hasStarted;
    ```
    
*   Is playing
    
    ```
    var isPlaying = plane.anims.isPlaying;
    ```
    
*   Is paused
    
    ```
    var isPaused = plane.anims.isPaused;
    ```
    
*   Total frames count
    
    ```
    var frameCount = plane.anims.getTotalFrames();
    ```
    
*   Delay
    
    ```
    var delay = plane.anims.delay;
    ```
    
*   Repeat
    
    *   Total repeat count
        
        ```
        var repeatCount = plane.anims.repeat;
        ```
        
    *   Repeat counter
        
        ```
        var repeatCount = plane.anims.repeatCounter;
        ```
        
    *   Repeat delay
        
        ```
        var repeatDelay = plane.anims.repeatDelay;
        ```
        
    *   Yoyo
        
        ```
        var repeatDelay = plane.anims.yoyo;
        ```
        
*   Current animation key
    
    ```
    var key = plane.anims.getName();
    ```
    
    *   `key` : Return `''` if not playing any animation.
*   Current frame name
    
    ```
    var frameName = plane.anims.getFrameName();
    ```
    
    *   `frameName` : Return `''` if not playing any animation.
*   Current animation
    
    ```
    var currentAnim = plane.anims.currentAnim;
    ```
    
*   Current frame
    
    ```
    var currentFrame = plane.anims.currentFrame;
    ```
    

## Interactive[​](#interactive "Direct link to Interactive")

To test if pointer is at any face of this mesh game object.

```
plane.setInteractive();
```

## Checkerboard[​](#checkerboard "Direct link to Checkerboard")

Creates a checkerboard style texture, based on the given colors and alpha values and applies it to this Plane, replacing any current texture it may have.

*   Create
    
    ```
    plane.createCheckerboard(color1, color2, alpha1, alpha2, height)
    ```
    
*   Remove
    
    ```
    plane.removeCheckerboard();
    ```
    

## Other properties[​](#other-properties "Direct link to Other properties")

See [Mesh game object](/phaser/concepts/gameobjects/mesh), [game object](/phaser/concepts/gameobjects)

## Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = plane.createBitmapMask();
```

See [mask](/phaser/concepts/display#masks)

## Shader effects[​](#shader-effects "Direct link to Shader effects")

Support [postFX effects](/phaser/concepts/gameobjects/shader)

!!! note No preFX effect support

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
