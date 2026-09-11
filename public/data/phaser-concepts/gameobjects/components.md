# Game Object Components

## Alpha Component[​](#alpha-component "Direct link to Alpha Component")

The Alpha Component is responsible for setting the alpha value of a Game Object. This is a value between 0 and 1. A value of 1 is fully opaque, where-as a value of 0 is fully transparent. By default, Game Objects have an alpha value of 1.

The current local alpha value of a Game Object is stored in its `alpha` property:

```
const alpha = player.alpha;
```

To set the alpha you can use the chainable `setAlpha` method:

```
player.setAlpha(alpha);
```

Or, you can set the `alpha` property directly:

```
player.alpha = alpha;
```

By default, Game Objects will have an alpha value of 1. This means they will be fully visible. You can reset the alpha of a Game Object either by setting its `alpha` property to 1, or by calling the chainable `clearAlpha` method:

```
player.clearAlpha();
```

You can use this property to create effects such as a Game Object 'fading out' over time, or to make a Game Object appear to be semi-transparent. As an internal optimization, Game Objects with an alpha value of 0 will be skipped by the renderer.

### Per Vertex Alpha[​](#per-vertex-alpha "Direct link to Per Vertex Alpha")

For some Game Objects it's possible to set a different alpha value per corner. This is known as vertex alpha. It allows you to create effects such as a Game Object fading out from one corner to another, or to make a Game Object appear to be semi-transparent at one corner, but not the other. Not all Game Objects support vertex alpha, but those that do will have a `setAlpha` method that accepts 4 values, one for each corner.

The corners are given in the order: Top Left, Top Right, Bottom Left and Bottom Right:

```
player.setAlpha(topLeft, topRight, bottomLeft, bottomRight);
```

You can also set the properties directly:

```
player.alphaTopLeft = topLeft;
player.alphaTopRight = topRight;
player.alphaBottomLeft = bottomLeft;
player.alphaBottomRight = bottomRight;
```

The ability to set per-vertex alpha is a WebGL only feature.

### Alpha and Parents[​](#alpha-and-parents "Direct link to Alpha and Parents")

When a Game Object has its alpha property set it will multiply its alpha value with that of its parent Container, if it has one. For example, if you have a parent Game Object with an alpha value of 0.5, and a child with an alpha value of 0.5, then the child will be rendered at 0.25 alpha as it's multiplied with the parent's alpha:

```
container.setAlpha(0.5);
child.setAlpha(0.5);
```

## Blend Mode Component[​](#blend-mode-component "Direct link to Blend Mode Component")

The Blend Mode Component allows Game Objects to set a blend mode which is used during rendering. Blend modes allow for different types of combining / blending of the pixels in Game Objects with those of the background.

The current blend mode of a Game Object is stored in its `blendMode` numeric property:

```
const blendMode = sprite.blendMode;
```

You can set the blend mode of a Game Object using the chainable `setBlendMode` method:

```
sprite.setBlendMode(mode);
```

Or, you can set the `blendMode` property directly:

```
sprite.blendMode = mode;
```

The mode value can be one of the `BlendModes` constants, such as `Phaser.BlendModes.SCREEN`. It can also be a string, such as `SCREEN`, or an integer, such as `3`. If you give a string, it must be all upper-case and match exactly those available in the `BlendModes` constants list. If you give an integer, it must be a valid Blend Mode constant ID from the list below.

The default value is zero, which is the `NORMAL` blend mode.

### Blend Mode Constants[​](#blend-mode-constants "Direct link to Blend Mode Constants")

The available blend modes are:

ID

Constant

Description

0

`NORMAL`

Normal blend mode. For Canvas and WebGL.

1

`ADD`

Add blend mode. For Canvas and WebGL.

2

`MULTIPLY`

Multiply blend mode. For Canvas and WebGL.

3

`SCREEN`

Screen blend mode. For Canvas and WebGL.

4

`OVERLAY`

Overlay blend mode. For Canvas only.

5

`DARKEN`

Darken blend mode. For Canvas only.

6

`LIGHTEN`

Lighten blend mode. For Canvas only.

7

`COLOR_DODGE`

Color dodge blend mode. For Canvas only.

8

`COLOR_BURN`

Color burn blend mode. For Canvas only.

9

`HARD_LIGHT`

Hard light blend mode. For Canvas only.

10

`SOFT_LIGHT`

Soft light blend mode. For Canvas only.

11

`DIFFERENCE`

Difference blend mode. For Canvas only.

12

`EXCLUSION`

Exclusion blend mode. For Canvas only.

13

`HUE`

Hue blend mode. For Canvas only.

14

`SATURATION`

Saturation blend mode. For Canvas only.

15

`COLOR`

Color blend mode. For Canvas only.

16

`LUMINOSITY`

Luminosity blend mode. For Canvas only.

17

`ERASE`

Erase blend mode. For Canvas and WebGL.

18

`SOURCE_IN`

Source in blend mode. For Canvas only.

19

`SOURCE_OUT`

Source out blend mode. For Canvas only.

20

`SOURCE_ATOP`

Source atop blend mode. For Canvas only.

21

`DESTINATION_OVER`

Destination over blend mode. For Canvas only.

22

`DESTINATION_IN`

Destination in blend mode. For Canvas only.

23

`DESTINATION_OUT`

Destination out blend mode. For Canvas only.

24

`DESTINATION_ATOP`

Destination atop blend mode. For Canvas only.

25

`LIGHTER`

Xor blend mode. For Canvas only.

26

`COPY`

Copy blend mode. For Canvas only.

27

`XOR`

Xor blend mode. For Canvas only.

### Canvas vs. WebGL[​](#canvas-vs-webgl "Direct link to Canvas vs. WebGL")

The Canvas Renderer supports all blend modes. However, the WebGL Renderer only supports the following blend modes:

*   `NORMAL`
*   `ADD`
*   `MULTIPLY`
*   `SCREEN`
*   `ERASE`

If you set a blend mode that is not supported by the WebGL Renderer, it will instead use the `NORMAL` blend mode.

Under WebGL you can create your own custom blend modes.

The Canvas Renderer will use the Canvas `globalCompositeOperation` feature which is part of the browsers Canvas API. This is why it has so many additional blend modes available.

### WebGL Performance Considerations[​](#webgl-performance-considerations "Direct link to WebGL Performance Considerations")

The Phaser WebGL Renderer will use the built-in GL Blending functions, which are extremely fast. However, they are more limited in scope than the Canvas Renderer, which is why you only have 5 available by default. Because they use the GL blend functions it means they require a batch flush before they can be set. So, if you have a series of Game Objects that are together in a batch, but one of them has a blend mode set different from the rest, the renderer will stop the batch, draw them all, set the blend mode, draw that one Game Object, then start a new batch again for the rest.

While modern GPUs are designed to handle tasks like this with ease, you should always be mindful of the potential impact this constant batch flushing can have. If you need to change blend modes often, try to organize your Game Objects so that those with shared blend modes are added to the display list consecutively, without breaks, as this will allow them to be rendered in as few batches as possible.

## Bounds Component[​](#bounds-component "Direct link to Bounds Component")

The Bounds Component is responsible for providing methods you can call that will return various bounds related values from a Game Object.

The 'bounds' of a Game Object can be summed-up as a rectangle that fully encapsulates the visual bounds of the Game Object, taking into account its scale and rotation.

Not all Game Objects have a bounds. For example, the Graphics Game Object does not have an instrinsic bounds because of the way in which it works. However, most texture-based Game Objects, such as Sprites, Text and TileSprites can return their bounds.

If the Game Object has a parent container, then its bounds will be factored based on its influence from the Container.

The bounds of a Game Object can be obtained by calling its `getBounds` method:

```
const bounds = sprite.getBounds();
```

This will return a `Rectangle` Shape object, where the `x` and `y` values are the top-left of the bounds, and the `width` and `height` values are the width and height of the bounds.

You can also pass in a Rectangle object to the `getBounds` method, and it will set the values based on the bounds of the Game Object:

```
const rect = new Phaser.Geom.Rectangle();

sprite.getBounds(rect);
```

If you don't pass in a Rectangle then a new instance will be created and returned to you. So, if you need to call this method frequently, pass in a Rectangle instance to help ease object creation.

Every time you call this method the bounds are calculated fresh. They are not cached internally, or updated automatically. So be aware of this if you are using bounds in any kind of update loop, or at scale.

### Bounds Related Points[​](#bounds-related-points "Direct link to Bounds Related Points")

As well as the `getBounds` method, there are also a number of other methods available that return specific points from the bounds of the Game Object. If you don't require the full bounds then getting just the point you do need is more efficient.

These methods are:

*   `getTopLeft`
*   `getTopCenter`
*   `getTopRight`
*   `getLeftCenter`
*   `getCenter`
*   `getRightCenter`
*   `getBottomLeft`
*   `getBottomCenter`
*   `getBottomRight`

They all operate in the same way. You can optionally pass them a Vector2 instance in which to store the resulting point, or they can create one for you. They all also have the `includeParent` boolean, which allows them to involve a parent container, if the Game Object has one, in the calculations, or not.

For example, here is how to use the `getTopLeft` method without factoring in a parent:

```
const point = sprite.getTopLeft();
```

And here is how to use it, but factor in a parent:

```
const point = sprite.getTopLeft(null, true);
```

And here is how to use it, but factor in a parent, and store the result in a pre-created Vector2:

```
const point = new Phaser.Math.Vector2();

sprite.getTopLeft(point, true);
```

All of the listed methods can be used in this way.

None of the bounds methods allow you to set the bounds. They are all 'read only' methods.

## Crop Component[​](#crop-component "Direct link to Crop Component")

The Crop Component allows texture-based Game Objects to 'crop' themselves. A crop is a rectangle that limits the area of the texture frame that is visible during rendering.

Cropping a Game Object does not change its size, dimensions, physics body or hit area, it just visually changes what you can see of it during the render-pass.

The current crop state of a Game Object is stored in its `isCropped` boolean:

```
const isCropped = player.isCropped;
```

To crop a Game Object you can use the chainable `setCrop` method:

```
player.setCrop(x, y, width, height);
```

It takes four arguments that represent the x/y coordinate to start the crop from, and the width and height of the crop. A crop is always a rectangle and cannot be any other shape.

The coordinates are relative to the Game Object, so 0 x 0 is the top-left of the Game Object texture frame.

Instead of passing in numeric values directly, or you can provide a single Rectangle Geometry object instance as the first and only parameter:

```
const rect = new Phaser.Geom.Rectangle(x, y, width, height);

player.setCrop(rect);
```

Note that this is a Geometry object, not a Rectangle Shape object.

One set, to adjust the crop you can call the `setCrop` method again with new values, or pass in an updated Rectangle instance.

If you wish to remove the crop from a Game Object, resetting it to show the entire texture again, call the `setCrop` method with no arguments:

```
player.setCrop();
```

### Crop Limitations[​](#crop-limitations "Direct link to Crop Limitations")

Internally, the crop works by adjusting the textures UV coordinates prior to rendering. Therefore the crop can only ever be a rectangle that fits inside the existing texture area.

You cannot crop a Game Object to show more of the texture than originally allowed, or use any other shape than a rectangle.

Because it works by just adjusting the UV coordinates it does provide a way to do super-fast masking, if you need a rectangular mask.

## Depth Component[​](#depth-component "Direct link to Depth Component")

The Depth Component allows Game Objects to be sorted within the Scene based on their 'depth' value, allowing them to move in front or behind other Game Objects. In some game frameworks this is known as the 'z-index'.

When a Scene Camera is preparing to render each frame, it will sort all the renderable Game Objects in the Scene based on their depth value. Those with the lowest depth values are rendered first, with the Game Objects with the highest depth values being rendered last, or 'on top' of the earlier ones.

By default, all Game Objects are given a depth value of zero, meaning they are all sorted based on their creation order, and placement in the Display List. The Depth Component allows you to override this.

The current depth of a Game Object is stored in its `depth` numeric property:

```
const depth = sprite.depth;
```

You can set the depth of a Game Object using the chainable `setDepth` method:

```
sprite.setDepth(value);
```

Or, you can modify the `depth` property directly:

```
sprite.depth = value;
```

The value can be any number, either an integer or a float. The default value is zero.

There is no upper or lower bounds on what the value can be and the numbers do not have to be assigned consecutively. If it's easier for you to give a Game Object a depth of 1000, and another a depth of 500, then you're free to do so.

You can also bind the depth property to a Game Objects position. For example, it's quite common to bind the depth of a Game Object to its `y` position, so that the higher it is in the Scene, the higher its depth value:

```
update ()
{
    sprite.setDepth(sprite.y);
}
```

If one or more Game Objects share the same `depth` value, then they are sorted based on their index within the Display List. The first one in the list is rendered first, and so on.

### Depth Updates[​](#depth-updates "Direct link to Depth Updates")

When the `depth` property of any Game Object is modified, the Depth Component tells the Scene that it needs to run a depth sort on the Display List. This is done by the component calling the `DisplayList.queueDepthSort` method and it happens automatically, you don't need to do anything else.

Because sorting the rendering list can be a costly operation if there are a lot of Game Objects, Phaser will queue the depth sort and only execute it at render time. If no Game Objects have had their depth changed since the last frame, the depth sort is skipped entirely.

Creating new Game Objects, or removing existing ones, will also cause the depth sort to be queued.

### Depth and Containers[​](#depth-and-containers "Direct link to Depth and Containers")

Container Game Objects can have their depth property set just like any other Game Object and it will influence at which point they are rendered. However, when a child is placed inside a Container, its own depth value is ignored. Instead, the depth of the Container is used by all children and cannot be overidden.

If you wish to adjust the order of children within a Container, there are specific methods available to do this, such as `moveUp`, `moveDown`, `sendToBack` and so on. See the Container documentation for more details.

## Flip Component[​](#flip-component "Direct link to Flip Component")

The Flip Component allows for texture-based Game Objects to 'flip' themselves either horizontally, vertically or both. As the name implies, this means the texture being displayed by the Game Object is inverted on the respective axis.

The current flip of a Game Object is stored in its `flipX` and `flipY` boolean properties:

```
const flipX = player.flipX;
const flipY = player.flipY;
```

To set the flipped state of a Game Object you can use the chainable `setFlip`, `setFlipX` and `setFlipY` methods:

```
player.setFlip(x, y);
player.setFlipX(x);
player.setFlipY(y);
```

Or, you can set the `flipX` and `flipY` properties directly:

```
player.flipX = true;
player.flipY = false;
```

### Toggle and Reset a Flip[​](#toggle-and-reset-a-flip "Direct link to Toggle and Reset a Flip")

There are two helper methods available which will toggle the current flipX or flipY state:

```
player.toggleFlipX();
player.toggleFlipY();
```

You can reset the flipped state of a Game Object by calling the `resetFlip` method:

```
player.resetFlip();
```

### Flip vs. Scale[​](#flip-vs-scale "Direct link to Flip vs. Scale")

As you may have read in the Scale section of the guide, you can achieve the same visual effect as Flip by setting the scale to a negative value.

However, flip works independently of scale and is set as a boolean, not a ratio. This allows you to flip a Game Object based on an event, such as a patrolling enemy reaching a wall, irrespective of its scale value.

Game Objects always flip based on the center of their texture frame. You cannot set the origin of a flip.

## Mask Component[​](#mask-component "Direct link to Mask Component")

The Mask Component allows you to set if a Game Object should be 'masked' during rendering. A mask controls which pixels of the Game Object are visible during rendering. Anything outside of the mask is not rendered. In Phaser there are two types of mask: a Bitmap Mask and a Geometry Mask.

The current mask of a Game Object is stored in its `mask` property:

```
const mask = sprite.mask;
```

You can set the mask of a Game Object using the chainable `setMask` method:

```
sprite.setMask(mask);
```

Or, you can set the `mask` property directly:

```
sprite.mask = mask;
```

To remove a mask, you can either call the chainable `clearMask` method:

```
sprite.clearMask();
```

Or, set the `mask` property to `null`:

```
sprite.mask = null;
```

When using the `clearMask` method you also have the option of destroying the mask currently attached to the Gamne Object:

```
sprite.clearMask(true);
```

### How Masks Work in Phaser[​](#how-masks-work-in-phaser "Direct link to How Masks Work in Phaser")

There are two types of mask in Phaser, which we will cover in the next two sections. Although they offer different features they are both created and applied in the same way.

Masks are global objects. They are not bound to, or belong to any one single Game Object. You can, and often should, use the same mask on as many different Game Objects as you like, at the same time.

Masks are created and positioned in world space only. They are not applied relative to the Game Object they are masking. For example, if you create a mask positioned at world coordinates 200x300, then it will be positioned at 200x300 regardless of where the Game Object it is masking is.

Masks themselves are not Game Objects, they do not live on the display list and cannot be modified like a Game Object, i.e. you cannot set their rotation or scale as you would a Sprite. That does not mean you cannot modify a mask post-creation, it simply means that mask objects do not have a Transform component.

### Geometry Mask[​](#geometry-mask "Direct link to Geometry Mask")

A Geometry Mask is a special type of mask that uses the path information from a Graphics Game Object in order to define its shape.

With the Canvas Renderer it uses the 'clipping path' feature of the Canvas API. The WebGL Renderer uses a built-in WebGL feature called the Stencil Buffer.

It's called a Geometry Mask because it uses geometric data in order to create itself. Graphics Game Objects have lots of features available for generating these paths, including `lineTo`, `arc`, `ellipse` and more. Please see the Graphics Game Object documentation for more details.

Because it uses path data for the mask it means you cannot do 'per pixel' masking with this type of mask. It's not suitable for creating a mask from a sprite with a gradient texture, for example. For that you should use a Bitmap Mask instead.

Geometry Masks have the ability to set their `invertAlpha` boolean properties. This is a WebGL only feature and allows you to 'invert' which area of the mask is applied, or not.

### Bitmap Mask[​](#bitmap-mask "Direct link to Bitmap Mask")

A Bitmap Mask uses a texture in order to control which pixels will be 'masked out' of the target Game Object during rendering. In order to achieve this it uses a special internal pipeline called the BitmapMask Pipeline. Because of this, it only works with the WebGL Renderer.

As it uses a texture for the shader input it means you can mask things on a per-pixel level, something not possible with the Geometry Mask. The source of the Bitmap Mask can be either a texture-based Game Object, such as a Sprite, or a Dynamic Texture instance.

The Bitmap Mask shader works by taking the alpha level from the mask texture and the alpha level of the masked Game Object and calculating the final resulting alpha level from the two, per pixel. It does not matter what color the mask texture is drawn in, all it looks at is the alpha value of each pixel. For example, if the mask has an alpha value of 0.95 for a specific pixel, and the Game Object texture has an alpha of 0.5 for the same pixel, the final alpha value when rendered will be 0.45. Naturally, the lower the resulting alpha value, the less the Game Object will be visible through it.

Bitmap Masks have the ability to set their `invertAlpha` boolean properties. This allows you to invert the alpha comparison, so that a low alpha value in the mask texture results in a high alpha value in the masked Game Object, and vice versa.

Note that you cannot set a Bitmap Mask and a Blend Mode on a single Game Object.

### Performance Considerations[​](#performance-considerations "Direct link to Performance Considerations")

When using Geometry Masks you should keep in mind the complexity of the path, i.e. how many points it has in it. The more complex the path, the longer it will take both Canvas and WebGL to render the masked Game Objects.

When using Bitmap Masks you should keep in mind the size of the masked texture. The larger it is, the more pixels have to be passed through the mask shader and the more GPU power will be required to render the masked Game Objects.

With both types of mask, the renderer needs to perform a lot of additional calculations to handle the masking. This includes breaking the batch in WebGL, enabling the stencil functions or mask shader and then rendering the masked Game Objects. For this reason you should never apply a mask to a Game Object that doesn't yet require it.

Masks are, however, batched. This means if you have a group of masked Game Objects in sequence in the Display List, all sharing the same mask, then you will only pay the cost of establishing that mask once.

## Origin Component[​](#origin-component "Direct link to Origin Component")

By default most Game Objects are _centered_ on their `x` and `y` coordinates. This means that if you create a Sprite at the coordinates 300x200, then the _center_ of the Sprite will be placed at 300x200.

In some game frameworks the default origin is the top-left, and in others the bottom-left. It is also sometimes known as the 'anchor point' or 'pivot point'. However, in Phaser it's called the origin and it defaults to the center. You can change this via the methods available from the Origin Component.

The current origin of a Game Object is stored in its `originX` and `originY` numeric properties:

```
const originX = player.originX;
const originY = player.originY;
```

To set the origin of a Game Object you can use the chainable `setOrigin` method:

```
player.setOrigin(x, y);
```

Or, you can set the `originX` and `originY` properties directly:

```
player.originX = 0.5;
player.originY = 0.5;
```

The values are given as a normalized value between 0 and 1. For example, setting the origin to 0.5 means it will be placed exactly in the center of the Game Object, no matter what its dimensions. A value of 0 would be the top-left of the Game Object, and 1 would be the bottom-right.

The origin controls both the placement of the Game Object and also the point around which it rotates. If you wanted to rotate a Game Object around its top-left corner, you would set its origin to be 0x0.

Or, if you wanted to position a Game Object in the bottom-right of the screen, and the screen was 800x600 in size, you could set the origin to be 1x1 and its position to be 800x600.

Game Objects can only have one origin. For example, they do not have a unique origin for rotation and another for position, or scale. If you need to emulate this behavior, you can create use a Container Game Object and then add your other Game Objects to it.

### The Display Origin[​](#the-display-origin "Direct link to The Display Origin")

Phaser also offers what is known as the Display Origin. This is a way to set the origin of a Game Object using pixel values instead of normalized ones. The range of the values is between 0 and the base width or height of the Game Object.

To set the display origin of a Game Object you can use the chainable `setDisplayOrigin` method:

```
player.setDisplayOrigin(x, y);
```

Or, you can set the `displayOriginX` and `displayOriginY` properties directly:

```
player.displayOriginX = 256;
player.displayOriginY = 128;
```

### Custom Frame Pivot[​](#custom-frame-pivot "Direct link to Custom Frame Pivot")

Some software, such as Texture Packer, allows you to define a specific 'pivot point' for a texture frame. This is then exported in the JSON data that Texture Packer creates. Phaser will look for these custom pivot points and then set the origin of the Game Object to match it. This is done via the method `setOriginFromFrame`:

```
player.setOriginFromFrame();
```

This is called automatically if you create a Sprite and provide it with a texture frame that has a custom pivot point in the data. But you can also call it directly, if you need to.

## Pipeline Component[​](#pipeline-component "Direct link to Pipeline Component")

The Pipeline Component controls which rendering pipeline the Game Object uses to render with. This is only set if the Phaser Game is using the WebGL Renderer. The Canvas Renderer does not use custom pipelines.

A Pipeline is an internal term and class construct that Phaser uses to handle rendering different types of Game Object. For example, there is the Multi Pipeline, which Sprites use, a Rope Pipeline for the Rope Game Object, and so on. You can also create your own custom pipelines, which can give you a lot of flexibility and power when it comes to rendering. The Pipeline Component is how you set a pipeline on a Game Object.

The current pipeline of a Game Object is stored in its `pipeline` property:

```
const pipeline = sprite.pipeline;
```

This will be `null` by default. It is not set until the Game Object is instantiated. As part of that process, all Game Objects call the `initPipeline` method, which is responsible for setting the default pipeline the Game Object uses. This is an internal method and should not be called directly.

You can set the pipeline of a Game Object using the chainable `setPipeline` method:

```
sprite.setPipeline(pipeline);
```

Or, you can set the `pipeline` property directly:

```
sprite.pipeline = pipeline;
```

When using the `setPipeline` method you can pass either a string, or an instance of a `WebGLPipeline` to the method. Regardless of which you pass, it will look-up the pipeline in the Pipeline Manager and if found it will be set on the Game Object. If you pass a string that doesn't match any pipeline, it will be ignored. If you pass a pipeline that isn't found in the Pipeline Manager, it will be ignored.

To remove a pipeline, you can either call the chainable `resetPipeline` method:

```
sprite.resetPipeline();
```

Or, set the `pipeline` property to match the `defaultPipeline` property:

```
sprite.pipeline = sprite.defaultPipeline;
```

The `defaultPipeline` property is set when the Game Object is first created and should be treated as read-only.

If you wish to get the string-based name of the pipeline the Game Object is using, you can call the `getPipelineName` method:

```
const name = sprite.getPipelineName();
```

### Pipeline Data[​](#pipeline-data "Direct link to Pipeline Data")

The Pipeline Component also has a `pipelineData` property, which is an object that contains data that the pipeline may need during rendering. You can set a key-value object to be used as the pipeline data by passing it to the `setPipeline` method:

```
sprite.setPipeline(pipeline, { foo: 1, bar: 2 });
```

Or, you can call the `setPipelineData` method:

```
sprite.setPipelineData('key', value);
```

Pipeline data is not used by any of the default pipelines in Phaser, but is made available for your own custom pipelines. For example, if you wanted to create a pipeline that colored Game Objects in a special way, you could store the color of the Game Object in the pipeline data, ready for it to read prior to rendering.

Creating custom pipelines is an advanced feature of Phaser and requires a good understanding of WebGL and GLSL shaders. It will be covered elsewhere in this guide.

## Scroll Factor Component[​](#scroll-factor-component "Direct link to Scroll Factor Component")

The Scroll Factor Component allows you to control the scroll factor of a Game Object. The "scroll factor" is how much influence a camera will exert upon a Game Object as the camera scrolls around the game world.

As covered in the Transform section, Game Objects have a position within the world. This position is combined with the Scene camera and used to calculate where the Game Object should be rendered on-screen. If the camera is moving around the world, the Game Object will appear to move with it, even though its position hasn't changed, simply by virtue of the fact that the camera is now looking at another part of the world.

The scroll factor allows you to modify the relationship between the Game Objects position and how the Camera projects it. Setting a scroll factor never changes the position of the Game Object, or any related physics bodies, it just changes where they are rendered by the camera.

The current scroll factor of a Game Object is stored in its `scrollFactorX` and `scrollFactorY` numeric properties:

```
const scrollFactorX = player.scrollFactorX;
const scrollFactorY = player.scrollFactorY;
```

To set the scroll factor of a Game Object you can use the chainable `setScrollFactor` method:

```
player.setScrollFactor(x, y);
```

Or, you can set the `scrollFactorX` and `scrollFactorY` properties directly:

```
player.scrollFactorX = 0.5;
player.scrollFactorY = 0.5;
```

The default value for each axis is 1. This means as the camera scrolls, the Game Object will appear to move at the exact same rate.

A value of zero will stop the Game Object from being influenced by the camera. This will effectively 'lock' it in place on the screen. This can be useful if you wish to create a UI or other interface element that remains in the same place regardless of where the camera is looking.

A value of 0.5 will make the Game Object move at half the rate of the camera. The scroll factor can be any value from zero and above, although realistically you would likely clamp it to a value between 0 and 1.

## Size Component[​](#size-component "Direct link to Size Component")

The Size Component is responsible for managing both the base and display size of a Game Object.

Most Game Objects have an instrinsic, or base size. For texture-based Game Objects, such as Sprites, the size is set automatically to match the size of the texture frame the Sprite is using. When the frame changes, the size is updated automatically. Some Game Objects have a size that you specify upon creation, such as the Tile Sprite.

It is very rare for you to need to change the base size of a Game Object. However, there are some Game Objects, such as Containers, which do not have a base size. In these cases, the `setSize` method is used to set the size of the Game Object.

The current base size of a Game Object is stored in its `width` and `height` numeric properties:

```
const width = player.width;
const height = player.height;
```

To set the size you can use the chainable `setSize` method:

```
player.setSize(width, height);
```

Or, you can set the `width` and `height` properties directly:

```
player.width = 128;
player.height = 128;
```

The size is used in lots of internal places, from creating input hit areas, to physics bodies, to calculating the bounds of a Game Object. As mentioned, it's not common to adjust it, however the properties are public should you need to. Just be aware it may have unintended consequences.

### Display Size[​](#display-size "Direct link to Display Size")

Unlike the Game Object's size, its Display Size was created specifically for you to modify as needed.

The Display Size is, for a texture-based Game Object, its frame size multiplied by its local scale. For example, if a Sprite has a 128x128 texture frame set and a scale of 2.0, then its display width and height would be 256x256.

The current display size of a Game Object is stored in its `displayWidth` and `displayHeight` numeric properties:

```
const width = player.displayWidth;
const height = player.displayHeight;
```

To set the size you can use the chainable `setDisplaySize` method:

```
player.setDisplaySize(width, height);
```

Or, you can set the `displayWidth` and `displayHeight` properties directly:

```
player.displayWidth = 128;
player.displayHeight = 128;
```

The values are given in pixels.

Setting these values, either directly or via the method, will adjust the local _scale_ of the Game Object. It provides a way for you to set the size in pixels that you wish the Game Object to be displayed at, rather than as a scale ratio.

### Parent Size[​](#parent-size "Direct link to Parent Size")

A Game Object Container has no size by default. You can set its size via the `setSize` method, but it will only impact the Container itself, not any of its children. If you wish to set the size of the Container and all children, you should scale it instead.

If a Game Object has a parent Container then the display size of the parent is automatically factored in to the Game Object's size. For example, if you have a Sprite that is 128x128 in size, but its parent Container has a scale of 0.5, then the Sprite will be displayed at 64x64 pixels. This is because it's scaled by the Container.

If you set the display width or height of a Game Object to zero, it will be skipped for rendering. This is because the Game Object has no dimensions, so it cannot be seen. Therefore, to optimize the rendering pass, Phaser will skip it entirely.

## Transform Component[​](#transform-component "Direct link to Transform Component")

The Transform Component is responsible for managing the position, scale and rotation of a Game Object.

Most Game Objects have this component, but you can test for it programatically by checking if the `hasTransformComponent` property exists and is `true`:

```
if (player.hasTransformComponent)
{
    //  This Game Object has a Transform Component
}
```

### Position[​](#position "Direct link to Position")

The current local position of a Game Object is stored in its `x` and `y` properties.

```
const x = player.x;
const y = player.y;
```

You can set the position using the chainable `setPosition`, `setX` and `setY` methods:

```
player.setPosition(x, y);
player.setX(x);
player.setY(y);
```

Or, you can set the `x` and `y` properties directly:

```
player.x = x;
player.y = y;
```

They can be either negative or positive values, and whole numbers or floats.

The position of a Game Object is always relative to its parent Container, if it has one. If it doesn't have a parent, then the position is its location within the Game World.

For example:

```
container.setPosition(300, 200);
child.setPosition(100, 100);
```

In the code above, the Container is positioned at 300 x 200 in the game world. The child of the Container is positioned at 100 x 100. This means that the child will appear at 400 x 300 in the game world, because its position is relative to the Container.

```
container.setPosition(300, 200);
child.setPosition(-100, -100);
```

In this code, the child will appear at 200 x 100 in the game world, because it has a negative position, relative to its parent.

The position is always set and returned as a number. This allows you to use the position directly in further calculations, or manipulate it as you would any other number:

```
enemy.x = player.x;
enemy.y = player.y - 100;
```

See the Origin Component to learn how Phaser knows which point of the Game Object to use as its x/y anchor.

Phaser also has two additional position related properties: `z` and `w`. You can set these optional values when calling `setPosition`, or they have their own chainable methods `setZ` and `setW`. These properties are not typically used internally by Phaser, but are made available should you require them for more advanced position, such as depth sorting.

The `copyPosition` method allows you to copy a Game Objects position directly to another object:

```
enemy.copyPosition(player);
```

The target object can be any object that has public `x` and `y` properties, such as another Game Object, or a Vector2.

You can also set the Game Object to have a random position with the `setRandomPosition` method:

```
enemy.setRandomPosition();
```

By default, if you don't provide any parameters, the Game Object will be given a position anywhere without the size set by the Scale Manager. However, you can also pass in x, y, width and height parameters to the method, to control a rectangle in which the random position will be set:

```
enemy.setRandomPosition(100, 100, 600, 400);
```

The Geometry classes have a variety of similar methods, for positioning objects within geometric shapes, however this method is handy if you just want to quickly position an object anywhere on-screen.

### Scale[​](#scale "Direct link to Scale")

The current local scale of a Game Object is stored in its `scaleX` and `scaleY` properties.

```
const scaleX = player.scaleX;
const scaleY = player.scaleY;
```

You can set the scale using the chainable `setScale` method:

```
player.setScale(x, y);
```

Or, you can set the `scaleX` and `scaleY` properties directly:

```
player.scaleX = x;
player.scaleY = y;
```

There is also a special property called `scale` which allows you to set both the x and y scale at the same time, to the same value:

```
player.scale = 2;
```

Scale values can be either negative or positive, and whole numbers or floats.

By default, Game Objects have a scale value of 1, meaning they will be rendered at the same size as their texture frame. By adjusting the scale properties you can make them appear bigger or smaller. The number you give is multiplied by their base size. For example, a scale value of 0.5 would halve the displayed size of the Game Object, where as a value of 2 would double it.

Setting a scale does not change the actual underlying size of the Game Object. If you were to read the width or height of a Game Object after adjusting its scale, the returned values would be the un-scaled original sizes. You can read more about this in the Size Component section.

The scale is always set and returned as a number. This allows you to use the scale directly in further calculations, or manipulate it as you would any other number.

Scaling always takes place around the center of the Game Object, regardless of the Game Objects origin, and cannot be changed.

The scale of a Game Object is always relative to its parent Container, if it has one.

For example:

```
container.setScale(2, 2);
```

In the code above, the Container is scaled by 2 on each axis, meaning and all of its children will be doubled in size.

```
container.setScale(2, 2);
child.setScale(2, 2);
```

In this code, the child will appear at 4x the size of the container, because it has been scaled twice itself and also inherits the double scale from its parent.

If you scale any axis of a Game Object to zero, it will be skipped for rendering. This is because a Game Object with a scale of zero has no dimensions, so it cannot be seen. Therefore, to optimize the rendering pass, Phaser will skip those Game Objects entirely.

If you scale a Game Object negatively, an interesting effect happens. The Game Object will appear flipped. For example:

```
player.scaleX = -1;
```

This will render the Game Object as if it was flipped horizontally. This is handy for characters that need to face in two directions but you only need to store the textures drawn in one direction, using the negative scale them to render the opposites at run-time. Note that Phaser also has a 'Flip Component' that can be used to flip a Game Object without adjusting its scale.

When you scale a texture based Game Object it's important to understand that the renderer will need to 'guess' at any pixels that are now present because of the increased size of the Game Object. For example, if you have a 16x16 texture and you scale it by 4, it will appear as 64x64 on screen. All of those extra pixels that didn't exist before in the original texture are created by the GPU during the rendering process. A similar thing happens if you scale a texture down. The GPU has to decide which pixels to not display and tries to create an average that best represents the orignal image.

Lots of art software, like Photoshop, have the ability to apply special filters and effects when resizing images to create more refined results. However, WebGL and Canvas don't have this feature and they tend to favor speed over visual fidelity. After all, unlike Photoshop, they have to do this 60 times a second, or more. If you see a drop in visual quality worse than you were expecting, then you should consider using a smaller, or larger, texture that was pre-scaled in an art package instead.

### Rotation[​](#rotation "Direct link to Rotation")

The current local rotation of a Game Object is stored in its `rotation` property:

```
const rotation = player.rotation;
```

The `rotation` value is always in radians. If you prefer to work with degrees, you can use the `angle` property instead:

```
const angle = player.angle;
```

To set the rotation, or angle, you can use the chainable `setRotation` and `setAngle` methods:

```
player.setRotation(rotation);
player.setAngle(angle);
```

Or, you can set the `rotation` and `angle` properties directly:

```
player.rotation = rotation;
player.angle = angle;
```

Phaser uses a right-handed coordinate system, where 0 is East, to the right, and 3.14 (or 180 degrees) is West, to the left. South is 1.57, or 90 degrees and North is -1.57 (or -90 degrees). If you visualise the rotation as a circle, the bottom half is positive and the top-half is negative. This is the same as Adobe Flash, from which the first version of Phaser took its inspiration.

Rotation in Phaser always takes place around the origin of the Game Object. Which means by default Game Objects typically rotate around their center. As you've read, you can adjust the origin. This changes where both the position and rotation occurs. You cannot change the rotation point of a Game Object, only its origin.

The rotation of a Game Object is always relative to its parent Container, if it has one.

For example:

```
container.setRotation(0.75);
```

In the code above, the Container is rotated by 0.75 radians, meaning all of its children will be rotated by the same amount.

```
container.setRotation(0.75);
child.setRotation(0.75);
```

In this code, the child will be rotated by 1.5 radians in total, because it inherits the rotation from its parent, then adds its own.

The `rotation` property only contains the local rotation value. If you wish to get the sum rotation of the Game Object taking into account all of its ancestors, you can use the `getParentRotation` method:

```
const rotation = player.getParentRotation();
```

This will return the total rotation of all parent Containers, in radians. If you need the world rotation, then add the Game Objects rotation to the final value:

```
const rotation = player.getParentRotation() + player.rotation;
```

### Local and World Transforms[​](#local-and-world-transforms "Direct link to Local and World Transforms")

The Transform Component has a couple of methods that allow you to return a Transform Matrix instance that has been set to be either the local or world transform for the Game Object.

A Transform Matrix is a 3x3 identity matrix use for perform affine transformations. In Phaser, the operations are performed in the order of Translation, Rotation and then Scale, always in that order.

The method `getLocalTransformMatrix` will return a purely local Transform Matrix:

```
const matrix = player.getLocalTransformMatrix();
```

This matrix will not include any transforms from parent Containers. It will only contain the transforms of the Game Object itself.

The method `getWorldTransformMatrix` will return a Transform Matrix that contains the Game Objects local transforms, multiplied with those of all of its parent Containers:

```
const matrix = player.getWorldTransformMatrix();
```

Both methods have the option to be passed Transform Matrix instances. If given, the values will be set in those, instead of a new instance being created and returned. If you are calling either of these methods a lot, i.e. in a constant update loop, or en-masse, then you should create some temporary matrices to pass to them, to avoid the constant creation of new objects:

```
const tempMatrix = new Phaser.GameObjects.Components.TransformMatrix();

player.getLocalTransformMatrix(tempMatrix);
```

Or:

```
const tempMatrix = new Phaser.GameObjects.Components.TransformMatrix();
const tempParentMatrix = new Phaser.GameObjects.Components.TransformMatrix();

player.getWorldTransformMatrix(tempMatrix, tempParentMatrix);
```

## Visible Component[​](#visible-component "Direct link to Visible Component")

The Visible Component is responsible for setting the visible state of a Game Object.

A Game Object with a visible state of `true` is rendered to the display, where-as one with a visible state of `false` is not. By default, Game Objects have a visible state of `true`.

The current local visible state of a Game Object is stored in its `visible` boolean property:

```
const visible = player.visible;
```

To set the visible state you can use the chainable `setVisible` method:

```
player.setVisible(visible);
```

Or, you can set the `visible` boolean directly:

```
player.visible = false;
```

By default, Game Objects will have a visible state of `true`. This means they will be rendered.

Being able to toggle the visibility of a Game Object is very useful for quickly showing or hiding Game Objects, without impacting their positions or other properties.

Hidden Game Objects are skipped by the renderer, saving cycle time, but still retain their internal position and state. This means that you can hide a Game Object, then make it visible again at a later stage, without having to reposition it or set other properties again.

An invisible Game Object is still updated, however. For example, if you had an animated Sprite that was playing through an animation sequence, then setting it to be invisible would not cause the animation to pause as it would still be updating. The same goes for other actions, such as tweens, or physics collisions. The visible state is purely a rendering toggle.

### Parent Visibility[​](#parent-visibility "Direct link to Parent Visibility")

If a Game Object has a parent Container, then the visible state of the parent will control if any of its children are rendered, or not. An invisible parent will skip rendering of all children, regardless of their own visible settings. However, if the parent is visible, then the childs visibliity will be used instead.
