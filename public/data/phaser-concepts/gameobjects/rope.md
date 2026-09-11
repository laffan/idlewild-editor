# Rope

The Rope object is _WebGL only_ and does not have a Canvas counterpart.

A Rope is a special kind of Game Object that has a texture is stretched along its entire length.

Unlike a Sprite, it isn't restricted to using just a quad and can have as many vertices as you define when creating it. The vertices can be arranged in a horizontal or vertical strip and have their own color and alpha values as well.

A Ropes origin is always 0.5 x 0.5 and cannot be changed.

## Load texture[​](#load-texture "Direct link to Load texture")

```
this.load.image(key, url);
```

Reference: [load image](/phaser/concepts/loader#image)

## Add object[​](#add-object "Direct link to Add object")

```
var rope = this.add.rope(x, y, texture, frame, points, horizontal);
// var rope = this.add.rope(x, y, texture, frame, points, horizontal, colors, alphas);
```

*   `points` :
    *   A number : Segments to split the texture frame into.
    *   An number array : An array containing the vertices data.
*   `horizontal` :
    *   `true` : Vertices of this Rope be aligned horizontally.
    *   `false` : Vertices of this Rope be aligned vertically.
*   `colors` : An optional array containing the color data for this Rope. One color value per pair of vertices.
*   `alphas` : An optional array containing the alpha data for this Rope. One alpha value per pair of vertices.

Add rope from JSON

```
var rope = this.make.rope({
    x: 0,
    y: 0,
    key: '',
    frame: null,
    horizontal: true,
    points: undefined,
    colors: undefined,
    alphas: undefined,

    // angle: 0,
    // alpha: 1
    // flipX: true,
    // flipY: true,
    // origin: {x: 0.5, y: 0.5},
    
    add: true
});
```

## Custom rope class[​](#custom-rope-class "Direct link to Custom rope class")

*   Define class
    
    ```
    class MyRope extends Phaser.GameObjects.Rope {
        constructor(scene, x, y, texture, frame, points, horizontal, colors, alphas) {
            super(scene, x, y, texture, frame, points, horizontal, colors, alphas);
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
    var rope = new MyRope(scene, x, y, texture, frame, points, horizontal);
    ```
    

## Origin[​](#origin "Direct link to Origin")

A Ropes origin is always 0.5 x 0.5 and cannot be changed.

## Set vertices[​](#set-vertices "Direct link to Set vertices")

Set vertices via

```
rope.setPoints(points);
// rope.setPoints(points, colors, alphas);
```

*   `points` :
    *   A number : Segments to split the texture frame into.
    *   An number array : An array containing the vertices data.
*   `colors` : An optional array containing the color data for this Rope. One color value per pair of vertices.
*   `alphas` : An optional array containing the alpha data for this Rope. One alpha value per pair of vertices.

Also change horizontal mode :

*   Change vertical rope to horizontal rope, do nothing if rope is horizontal mode already
    
    ```
    rope.setHorizontal(points);
    // rope.setHorizontal(points, colors, alphas);
    ```
    
*   Change horizontal rope to vertical rope, do nothing if rope is vertical mode already
    
    ```
    rope.setVertical(points);
    // rope.setVertical(points, colors, alphas);
    ```
    

Or set `rope.points` directly :

1.  Change `rope.points`
    *   Horizontal rope : `rope.points[i].y = newY`
    *   Vertical rope : `rope.points[i].x = newX`
2.  Call `rope.setDirty()`, or `rope.updateVertices()`

Each point is relative to position of rope object, get points of world via

```
var worldX = rope.points[i].x + rope.x;
var worldY = rope.points[i].y + rope.y;
```

## Play animation[​](#play-animation "Direct link to Play animation")

```
rope.play(key);
// rope.play(key, ignoreIfPlaying, startFrame);
```

*   `ignoreIfPlaying` : If an animation is already playing then ignore this call. Default value is `false`.
*   `startFrame` : Optionally start the animation playing from this frame index. Default value is `0`.

## Alpha[​](#alpha "Direct link to Alpha")

*   Single alpha
    
    ```
    rope.setAlphas(alpha);
    ```
    
*   Top - bottom alpha
    
    ```
    rope.setAlphas(topAlpha, bottomAlpha);
    ```
    
*   Alpha array for each point
    
    ```
    rope.setAlphas(alphaArray);
    ```
    
    *   `alphaArray` : Array of alpha value.

## Color tint[​](#color-tint "Direct link to Color tint")

*   Single color tint
    
    ```
    rope.setColors(color);
    ```
    
*   Color tint array for each point
    
    ```
    rope.setAlphas(colorArray);
    ```
    
    *   `colorArray` : Array of color tint value.

### Tint fill mode[​](#tint-fill-mode "Direct link to Tint fill mode")

Sets the tint fill mode.

```
rope.setTintFill(mode);
```

*   `mode` :
    *   `0` : Additive tint, blends the vertices colors with the texture. Default behavior.
    *   `1` : Fill tint with alpha.
    *   `2` : Fill tint without alpha.

## Flip[​](#flip "Direct link to Flip")

```
rope.flipX = flip;
rope.flipY = flip;
```

If this Game Object has a physics body, it will not change the body. This is a rendering toggle only.

## Debug[​](#debug "Direct link to Debug")

Draw debug mesh each render tick.

```
rope.setDebug(graphic);
// rope.setDebug(graphic, callback);
```

*   `graphic` : [Graphics game object](/phaser/concepts/gameobjects/graphics)
    
*   `callback` : Callback of rendering debug graphics ([default callback](https://github.com/photonstorm/phaser/blob/master/src/gameobjects/rope/Rope.js#L996-L1024))
    
    ```
    function(rope, meshLength, verts) {
        // var graphic = rope.debugGraphic;
    }
    ```
    
    *   `rope` : Rope instance.
        *   `rope.debugGraphic` : [Graphics game object](/phaser/concepts/gameobjects/graphics)
    *   `meshLength` : The number of mesh vertices in total.
    *   `verts` : An array of the translated vertex coordinates.

!!! note Clear Debug graphics (`rope.debugGraphic.clear()`) during scene's update stage (`this.update() { }`)

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
