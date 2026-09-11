# Textures

The primary role of the Texture Manager is to create and store instances of the Phaser Texture class. The Texture class contains all of the data that Phaser requires in order to use that texture internally. For example, a Sprite contains a reference to both the Texture and Frame it is using. The underlying texture resides in the global Texture Manager. This means that it's very common for multiple Game Objects to all use the same Texture instance.

A Texture is made up from one or more Frames. You can think of a Frame as being a rectangular area within the Texture. By using Frames you can split a single Texture into lots of different sections. When you tell a Sprite which texture to use, you can also tell it which frame from that texture to use. If you had a texture that contained frames, you could tell a Sprite to use just frame 5 from it.

You may have heard of the term Sprite Sheet or Texture Atlas before. In Phaser, the underlying sprite sheet or atlas would be a single Texture instance that contains as many Frame instances as required to represent the frames in the sheet. The task of the majority of the Texture Manager Parsers is to take image and data files and then create all of the Frames it needs based on that information.

The concept of Frames is also how Phaser handles animations, by 'playing' the Frames in a sequence that you define, at a given frame rate.

There are more advanced types of Texture, such as the Dynamic Texture and the Canvas Texture, which we will cover later. Fundamentally, though, the majority of Phaser Game Objects use a Texture and Frame to render themselves to the screen.

## Textures[​](#textures "Direct link to Textures")

**Textures** have a key, a first frame name, a map of frames, one or more source images (canvas, image, or video), and zero or more data source images (normal maps). There are three texture classes, [CanvasTexture](https://newdocs.phaser.io/docs/latest/Phaser.Textures.CanvasTexture), [DynamicTexture](https://newdocs.phaser.io/docs/latest/Phaser.Textures.DynamicTexture), and [Texture](https://newdocs.phaser.io/docs/latest/Phaser.Textures.Texture).

The maximum texture dimensions depend on the device; you can check `renderer.getMaxTextureSize()`. 2048px for mobile and 4096px for desktop should be safe.

### Default textures[​](#default-textures "Direct link to Default textures")

*   Default : `'__DEFAULT'`
*   Missing : `'__MISSING'`
*   4x4 white : `'__WHITE'`

### Get texture keys in the manager[​](#get-texture-keys-in-the-manager "Direct link to Get texture keys in the manager")

```
const keys = this.textures.getTextureKeys(); // → ['mummy', 'bat', 'torch', …]
```

### Get a texture from the manager[​](#get-a-texture-from-the-manager "Direct link to Get a texture from the manager")

`textures.get()` **always** returns a texture; it will be the `__MISSING` texture if no such key exists. So you should use `textures.exists()` first.

```
const texture = this.textures.exists("mummy")
  ? this.textures.get("mummy")
  : null;
```

### Generate texture from array[​](#generate-texture-from-array "Direct link to Generate texture from array")

```
var config = {
  data: data,
  // 3x3:
  // [ '...',
  //   '...',
  //   '...' ]
  pixelWidth: 1, // pixel width of each data
  pixelHeight: 1, // pixel height of each data
  preRender: null, // callback, function(canvas, ctx) {}
  postRender: null, // callback, function(canvas, ctx) {}

  canvas: null, // create a canvas if null
  resizeCanvas: true,
  clearCanvas: true,
};
var texture = this.textures.generate(key, config);
```

#### Verify existing texture[​](#verify-existing-texture "Direct link to Verify existing texture")

```
var hasKey = this.textures.exists(key);
```

### Get base64[​](#get-base64 "Direct link to Get base64")

```
var s = this.textures.getBase64(key); // type= 'image/png', encoderOptions= 0.92
// var s = this.textures.getBase64(key, frame, type, encoderOptions);
```

### Get pixel color[​](#get-pixel-color "Direct link to Get pixel color")

```
var color = this.textures.getPixel(x, y, key);
// var color = this.textures.getPixel(x, y, key, frame);
```

Properties of `color`

*   `r` : 0 ~ 255
*   `g` : 0 ~ 255
*   `b` : 0 ~ 255
*   `a` : 0 ~ 255

```
var alpha = this.textures.getPixelAlpha(x, y, key);
// var alpha = this.textures.getPixelAlpha(x, y, key, frame);
```

alpha : 0 ~ 255

Return `null` if the coordinates were out of bounds.

### Remove texture[​](#remove-texture "Direct link to Remove texture")

Remove texture stored in texture cache.

```
this.textures.remove(key);
```

### Loading images for textures[​](#loading-images-for-textures "Direct link to Loading images for textures")

Usually you won't be creating textures directly. Phaser creates textures for you when you load images.

*   `load.image()` creates a texture with the single frame `__BASE`.
*   `load.spritesheet()` creates a texture with frames named as integers starting from `0`, plus `__BASE`.
*   `load.atlas()` or `load.unityAtlas()` creates a texture with frames named in the atlas data, plus `__BASE`.
*   `load.multiatlas()` creates the same, with multiple source images

In Phaser terms a "spritesheet" has uniform cells in rows or columns and an "atlas" has frames in any size and position. Phaser can load atlases created by Texture Packer (any "Phaser 3" format) or Unity.

Phaser can use [any image format](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types) that the browser can display. SVGs are rasterized (by the browser) when a texture is created. Phaser v3.60 supports [WebGL compressed textures](https://developer.nvidia.com/astc-texture-compression-for-game-assets#_Toc398571907).

*   [How to create sprite sheets for Phaser 3 with TexturePacker](https://www.codeandweb.com/texturepacker/tutorials/how-to-create-sprite-sheets-for-phaser3)

#### Usage[​](#usage "Direct link to Usage")

*   Load image texture
    
    ```
    this.load.image(key, url);
    ```
    
*   Load image texture via base64 string
    
    ```
    this.textures.addBase64(key, data);
    ```
    
*   Get image texture
    
    ```
    var texture = this.textures.get(key);
    var image = texture.getSourceImage();
    // var width = image.width;
    // var height = image.height;
    ```
    
*   Get image texture from frame object
    
    ```
    var texture = this.textures.get(frameObject);
    ```
    

### Textures from complete images[​](#textures-from-complete-images "Direct link to Textures from complete images")

If you already have a complete [image](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement "HTMLImageElement") or [canvas](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement) somehow, you can add it to the Texture Manager directly using methods such as `addImage()`, `addSpriteSheet()`, `addAtlas()`. These methods are very similar to the corresponding load methods, but they take a `sourceImage` argument (the image or canvas) instead of an URL.

You can make a second texture from the same source this way, maybe if you wanted to create a different frame set:

```
this.textures.addImage(
  "mummyCopy",
  this.textures.get("mummy").getSourceImage()
);
```

### Canvas Texture[​](#canvas-texture "Direct link to Canvas Texture")

A Canvas Texture has a [canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas) with a [2d rendering context](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D) as its source. You can use any of the [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) on it. You can draw texture frames on it, but not game objects (cf. Dynamic Texture).

You can create a blank canvas texture with `createCanvas()`:

`const texture = this.textures.createCanvas('key', width, height);`

Or use an existing canvas:

`const texture = this.textures.addCanvas('key', canvas);`

Use `drawFrame()` to draw another texture frame onto the Canvas Texture:

`texture.drawFrame('mummy', 1, x, y);`

or `draw()` if you have a source image (unusual):

`texture.draw(sourceImage, x, y);`

If you work on the canvas context directly, refresh the texture when finished:

```
const ctx = texture.getContext();

// CanvasTexture has its own `width` and `height`.
// You could also read these from the base frame, as with the Texture class.
const { width, height } = texture;

ctx.fillStyle = "ghostwhite";
ctx.fillRect(0, 0, width, height);

texture.refresh();
```

`refresh()` is required to update the texture for display in WebGL rendering mode. Don't call `refresh()` after `draw()` or `drawFrame()`; it's already included.

If you need to use `getPixel()` or `getPixels()` after drawing, call `update()` instead of `refresh()`.

#### Usage[​](#usage-1 "Direct link to Usage")

*   Create canvas texture
    
    ```
    var texture = scene.textures.createCanvas(key, width, height);
    ```
    
*   Get canvas element
    
    ```
    var canvas = texture.getCanvas();
    var context = texture.getContext();
    ```
    
    [Canvas api](https://www.w3schools.com/html/html5_canvas.asp)
    
*   Draw frame
    
    ```
    texture.drawFrame(key, frame, x, y);
    // texture.drawFrame(key, frame, x, y, update);
    ```
    
    *   `update` : Update the internal ImageData buffer and arrays. Default value is `true`.
*   Draw image
    
    ```
    texture.draw(x, y, source);
    // texture.draw(x, y, source, update);
    ```
    
    *   `source` : The HTML Image element, or HTML Canvas element to draw to this canvas.
    *   `update` : Update the internal ImageData buffer and arrays. Default value is `true`.
*   Clear
    
    ```
    texture.clear();
    ```
    
    or
    
    ```
    texture.clear(x, y, width, height);
    // // texture.clear(x, y, width, height, update);
    ```
    
    *   `update` : Update the internal ImageData buffer and arrays. Default value is `true`.
*   Refresh texture
    
    ```
    texture.refresh();
    ```
    
*   Color texture
    
    *   Get pixel color
        
        ```
        var color = texture.getPixel(x, y);
        // var color = texture.getPixel(x, y, color);
        ```
        
        ```
        var colors = texture.getPixels(x, y, width, height);
        ```
        
        *   `colors` : `[{x, y, color, alpha}, ...]`
    *   Set pixel color
        
        ```
        texture.setPixel(x, y, red, green, blue);
        // texture.setPixel(x, y, red, green, blue, alpha);
        ```
        
*   Image data
    
    *   Get image data
        
        ```
        var imageData = texture.getData(x, y, width, height);
        ```
        
    *   Set image data
        
        ```
        texture.putData(imageData, x, y);
        ```
        
*   Add frame
    
    ```
    texture.add(name, sourceIndex, x, y, width, height);
    ```
    
    *   `name` : The name of this Frame. The name is unique within the Texture.
    *   `sourceIndex` : The index of the TextureSource that this Frame is a part of.
    *   `x` : The x coordinate of the top-left of this Frame.
    *   `y` : The y coordinate of the top-left of this Frame.
    *   `width` : The width of this Frame.
    *   `height` : The height of this Frame.

### Dynamic Texture[​](#dynamic-texture "Direct link to Dynamic Texture")

A Dynamic Texture is a special texture that allows you to draw textures, frames and most kind of Game Objects directly to it.

#### Usage[​](#usage-2 "Direct link to Usage")

*   Create dynamic texture
    
    ```
    var texture = scene.textures.addDynamicTexture(key, width, height);
    ```
    
    Disable `texture.isSpriteTexture` if this texture is not a base texture for Sprite Game Objects.
    
    ```
    texture.setIsSpriteTexture(false);
    // texture.isSpriteTexture = false;
    ```
    
*   Set size
    
    ```
    texture.setSize(width, height);
    ```
    
*   Fill color
    
    ```
    texture.fill(rgb);
    // texture.fill(rgb, alpha, x, y, width, height);
    ```
    
    *   `rgb` : The number color to fill this Dynamic Texture with.
    *   `alpha` : The alpha value used by the fill. Default value is `1`.
    *   `x`, `y`, `width`, `height` : The area of the fill rectangle. Default behavior is filling whole size.
*   Clear
    
    ```
    texture.clear();
    ```
    
    ```
    texture.clear(x, y, width, height);
    ```
    
*   Draw game object
    
    ```
    texture.draw(entries);
    // texture.draw(entries,x, y);
    // texture.draw(entries, x, y, alpha, tint);
    ```
    
    *   `entries` :
        *   Any renderable Game Object, such as a Sprite, Text, Graphics or TileSprite.
        *   Tilemap Layers.
        *   A Group. The contents of which will be iterated and drawn in turn.
        *   A Container. The contents of which will be iterated fully, and drawn in turn.
        *   A Scene Display List. Pass in `Scene.children` to draw the whole list.
        *   Another Dynamic Texture, or a Render Texture.
        *   A Texture Frame instance.
        *   A string. This is used to look-up the texture from the Texture Manager.
    *   `x`, `y` : The x/y position to draw the Frame at, or the offset applied to the object.
        *   If the object is a Group, Container or Display List, the coordinates are _added_ to the positions of the children.
        *   For all other types of object, the coordinates are exact.
    *   `alpha`, `tint` : Only used by Texture Frames.
        *   Game Objects use their own alpha and tint values when being drawn.
*   Erase
    
    ```
    texture.erase(entries);
    // texture.erase(entries, x, y);
    ```
    
    *   `entries` :
        *   Any renderable Game Object, such as a Sprite, Text, Graphics or TileSprite.
        *   Tilemap Layers.
        *   A Group. The contents of which will be iterated and drawn in turn.
        *   A Container. The contents of which will be iterated fully, and drawn in turn.
        *   A Scene Display List. Pass in `Scene.children` to draw the whole list.
        *   Another Dynamic Texture, or a Render Texture.
        *   A Texture Frame instance.
        *   A string. This is used to look-up the texture from the Texture Manager.
    *   `x`, `y` : The x/y position to draw the Frame at, or the offset applied to the object.
        *   If the object is a Group, Container or Display List, the coordinates are _added_ to the positions of the children.
        *   For all other types of object, the coordinates are exact.
*   Draw frame
    
    ```
    texture.stamp(key, frame, x, y, {
      alpha: 1,
      tint: 0xffffff,
      angle: 0,
      rotation: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      originX: 0.5,
      originY: 0.5,
      blendMode: 0,
      erase: false,
      skipBatch: false,
    });
    ```
    
    or
    
    ```
    texture.drawFrame(key, frame, x, y);
    // texture.drawFrame(key, frame, x, y, alpha, tint);
    ```
    
    *   `x`, `y` : Top-left position
*   Draw repeat frames
    
    *   Repeat frames full of size
        
        ```
        texture.repeat(key, frame);
        ```
        
    *   Repeat in an area
        
        ```
        texture.repeat(key, frame, x, y, width, height);
        // texture.repeat(key, frame, x, y, width, height, alpha, tint, skipBatch);
        ```
        
*   Add frame
    
    ```
    texture.add(name, sourceIndex, x, y, width, height);
    ```
    
    *   `name` : The name of this Frame. The name is unique within the Texture.
    *   `sourceIndex` : The index of the TextureSource that this Frame is a part of.
    *   `x` : The x coordinate of the top-left of this Frame.
    *   `y` : The y coordinate of the top-left of this Frame.
    *   `width` : The width of this Frame.
    *   `height` : The height of this Frame.
*   Batch draw
    
    1.  Begin
        
        ```
        texture.beginDraw();
        ```
        
    2.  Draw
        
        *   Draw game object
            
            ```
            texture.batchDraw(entries, x, y, alpha, tint);
            ```
            
            *   `entries` :
                *   Any renderable Game Object, such as a Sprite, Text, Graphics or TileSprite.
                *   Tilemap Layers.
                *   A Group. The contents of which will be iterated and drawn in turn.
                *   A Container. The contents of which will be iterated fully, and drawn in turn.
                *   A Scene Display List. Pass in `Scene.children` to draw the whole list.
                *   Another Dynamic Texture, or a Render Texture.
                *   A Texture Frame instance.
                *   A string. This is used to look-up the texture from the Texture Manager.
        *   Draw frame
            
            ```
            texture.batchDrawFrame(key, frame, x, y, alpha, tint);
            ```
            
        *   Draw image
            
            ```
            texture.stamp(key, frame, x, y, {
              // ...
              skipBatch: true,
            });
            ```
            
        *   Draw repeat images
            
            ```
            texture.repeat(key, frame, x, y, width, height, alpha, tint, true);
            ```
            
    3.  End
        
        ```
        texture.endDraw();
        ```
        
*   Internal camera
    
    Internal camera `texture.camera`
    
    *   Scroll (offset)
        
        ```
        texture.camera.setScroll(x, y);
        ```
        
    *   Zoom (scale)
        
        ```
        texture.camera.setZoom(zoom);
        ```
        
    *   Rotate
        
        ```
        texture.camera.setAngle(angle); // angle in degrees
        ```
        
*   Snapshot
    
    *   Snapshot area
        
        ```
        texture.snapshot(callback);
        // texture.snapshot(callback, type, encoderOptions);
        ```
        
        or
        
        ```
        texture.snapshotArea(x, y, width, height, callback, type, encoderOptions);
        ```
        
        *   `callback` : The Function to invoke after the snapshot image is created.
            
            ```
            function(imageElement) {
            }
            ```
            
            *   `imageElement` : HTMLImageElement.
        *   `type` : The format of the image to create, usually `'image/png'` or `'image/jpeg'`. Default value is `'image/png'`.
            
        *   `encoderOptions` : The image quality, between `0` and `1`. Used for image formats with lossy compression, such as `'image/jpeg'`. Default value is `0.92`.
            
        *   `x`, `y`, `width`, `height` : Snapshot area.
            
*   Get color of a pixel
    
    ```
    texture.snapshotPixel(x, y, callback);
    ```
    
    *   `x`, `y` : The x/y coordinate of the pixel to get.
        
    *   `callback` : The Function to invoke after the snapshot image is created.
        
        ```
        function(colorObject) {
        }
        ```
        
        *   `colorObject` : Either a Color object if a single pixel is being grabbed, or a new Image which contains a snapshot of the canvas contents.

#### Render Texture[​](#render-texture "Direct link to Render Texture")

A Render Texture is essentially an [Image](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.Image) holding a Dynamic Texture.

### Events[​](#events "Direct link to Events")

*   Texture manager is ready
    
    ```
    this.textures.on("ready", function () {});
    ```
    
*   Add texture
    
    ```
    this.textures.on("addtexture", function (key) {});
    ```
    
    or
    
    ```
    this.textures.on("addtexture-" + key, function () {});
    ```
    
*   Error when adding texture
    
    ```
    this.textures.on("onerror", function (key) {});
    ```
    
*   Remove texture
    
    ```
    this.textures.on("removetexture", function (key) {});
    ```
    
    or
    
    ```
    this.textures.on("removetexture-" + key, function () {});
    ```
    

## Frames[​](#frames "Direct link to Frames")

**Frames** are rectangular areas on a texture. Frames have a name, position, several dimensions (`realWidth` and `realHeight` are most important), and an optional custom pivot point. The docs call frame names "names" (for atlas textures) and "indexes" (for spritesheet textures) but they are all the same thing. All textures have a special frame, named `__BASE`, that represents the entire texture.

Textures are stored in the Texture Manager, `this.textures` in a scene or `game.textures`. Textured game objects hold their current texture and frame in their `texture` and `frame` properties.

There are three built-in textures: `__DEFAULT` (32 × 32 transparent), `__MISSING` (32 × 32 green slashed box), and `__WHITE` (4 × 4 white).

### Get frame names for a texture[​](#get-frame-names-for-a-texture "Direct link to Get frame names for a texture")

```
const frameNames = this.textures.get("mummy").getFrameNames(); // → [0, 1, 2, …]
```

*   [Example: Get frame names from atlas texture](https://labs.phaser.io/edit.html?src=src/loader%5Ctexture%20atlas%20json%5Cload%20texture%20atlas.js)

### Get all texture keys and frame names[​](#get-all-texture-keys-and-frame-names "Direct link to Get all texture keys and frame names")

```
for (const textureKey of this.textures.getTextureKeys()) {
  console.info(textureKey, this.textures.get(textureKey).getFrameNames(true));
}
```

### Get a frame from a texture[​](#get-a-frame-from-a-texture "Direct link to Get a frame from a texture")

#### Usage[​](#usage-3 "Direct link to Usage")

*   Get frame from a texture

```
var frame = this.textures.getFrame(key, frame);
```

*   Frame properties
    
    *   `frame.source.image` : Image of texture source.
    *   `frame.cutX` : X position within the source image to cut from.
    *   `frame.cutY` : Y position within the source image to cut from.
    *   `frame.cutWidth` : The width of the area in the source image to cut.
    *   `frame.cutHeight` : The height of the area in the source image to cut.
*   Examples:
    
    ```
    const mummyFrame1 = this.textures.getFrame("mummy", 1);
    // OR
    const mummyFrame1 = this.textures.get("mummy").get(1);
    ```
    
    A texture itself has no dimensions, technically; for those you want to read from the base frame:
    
    ```
    const { realWidth, realHeight } = this.textures.getFrame("mummy", "__BASE");
    ```
    

##### Set a texture's filter mode[​](#set-a-textures-filter-mode "Direct link to Set a texture's filter mode")

```
// Nearest-neighbor filter (pixelated)
this.textures.get("mummy").setFilterMode(Phaser.Textures.FilterMode.NEAREST);

// Linear filter (antialiased)
this.textures.get("mummy").setFilterMode(Phaser.Textures.FilterMode.LINEAR);
```

##### Working from a game object[​](#working-from-a-game-object "Direct link to Working from a game object")

A game object's `texture` and `frame` hold its current texture and frame, so you can access them there instead of from the texture manager. Just remember that you're working with shared objects.

```
const mummy = this.add.sprite(0, 0, "mummy", 1);

console.log(mummy.texture.key); // → 'mummy'
console.log(mummy.frame.name); // → 1

const mummyFrame1 = mummy.texture.get(1);
```

### Setting custom pivot points (origin)[​](#setting-custom-pivot-points-origin "Direct link to Setting custom pivot points (origin)")

```
for (const frame of Object.values(this.textures.get("sprites").frames)) {
  if (frame.name === "__BASE") {
    continue;
  }

  frame.customPivot = true;
  frame.pivotX = 0.5;
  frame.pivotY = 1;

  console.log(frame.texture.key, frame.name, frame.pivotX, frame.pivotY);
}
```

### Add frames[​](#add-frames "Direct link to Add frames")

`texture.add(frameName, sourceIndex, x, y, width, height);`

You can use numeric or string frame names. `sourceIndex` is `0` for single-source textures.

Frames can be cloned but you then have to add the new frame object manually:

```
// Clone frame 0 of texture "asp".
const aspFrame = this.textures.cloneFrame("asp", 0);

// Add it as frame 0 of the "bat" texture.
const batTexture = this.textures.get("bat");

batTexture.frames[aspFrame.name] = aspFrame;

batTexture.frameTotal += 1;
```

You can add frames to any texture. Here you can "convert" a single-frame texture into a multi-frame spritesheet texture:

```
this.load.image("example", "example.png");

this.load.once("filecomplete-image-example", () => {
  const texture = this.textures.get("image");

  texture.firstFrame = 0;

  texture.add(0 /* … */);
  texture.add(1 /* … */);
  texture.add(2 /* … */);

  texture.getFrameNames(); // -> [0, 1, 2]
});
```

In practice you usually add frames to create a multi-frame Canvas Texture or Dynamic Texture (see below).

### Add atlas[​](#add-atlas "Direct link to Add atlas")

```
this.textures.addAtlas(key, HTMLImageElement, data);
// this.textures.addAtlas(key, HTMLImageElement, data, dataSource);
```

*   `key` : The unique string-based key of the Texture.
    
*   `HTMLImageElement` : HTML Image element/s.
    
*   `data` : The Texture Atlas data/s.
    
    ```
    {
        frames: [
            {
                // Location of frame image
                frame: {
                    x, y, w, h
                },
    
                // trimmed
                trimmed:
                sourceSize: {
                    w, h
                },
                spriteSourceSize: {
                    x, y, w, h
                },
    
                rotated:
    
                // Custom origin
                anchor:
                pivot: {
                    x, y
                },
    
                // Other custom properties of this frame ...
            }
        ],
    
        // Other custom properties of this texture ...
    }
    ```
    
*   `dataSource` : An optional data Image element (normal map).
    

or

```
this.textures.addAtlas(undefined, texture, data);
// this.textures.addAtlas(undefined, texture, data, dataSource);
```

*   `texture` : Phaser Texture.

### Add sprite sheet[​](#add-sprite-sheet "Direct link to Add sprite sheet")

```
this.textures.addSpriteSheet(key, HTMLImageElement, config);
// this.textures.addAtlas(key, HTMLImageElement, config, dataSource);
```

*   `key` : The unique string-based key of the Texture.
    
*   `HTMLImageElement` : HTML Image element/s.
    
*   `config` : The configuration object for this Sprite Sheet.
    
    ```
    {
        frameWidth: ,
        frameHeight: ,
        startFrame: 0,
        endFrame: -1,
        margin: 0,
        spacing: 0
    }
    ```
    
*   `dataSource` : An optional data Image element (normal map).
    

or

```
this.textures.addSpriteSheet(undefined, texture, config);
// this.textures.addSpriteSheet(undefined, texture, config, dataSource);
```

*   `texture` : Phaser Texture.

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
