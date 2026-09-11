# Game Objects

All Game Objects in Phaser extend from a base class called `Phaser.GameObjects.GameObject`. On its own, this class can't do much. It cannot render, for example, or be added to the display list. What it does do is provide all of the building blocks and core functionality that Game Objects need.

In this section we will cover the properties and methods that the base Game Object class has. This means, anything you read in this section is also available in every other Game Object within Phaser.

## Scene[​](#scene "Direct link to Scene")

A Game Object can only belong to one Scene. A reference to the Scene it belongs to is available in the `scene` property:

```
const scene = sprite.scene;
```

Although it isn't, for internal reasons, you should consider this property as read-only. You cannot change the Scene that a Game Object belongs to once it has been created. The `scene` property is passed in the constructor of the Game Object and is set immediately.

When a Game Object is destroyed, the reference to the Scene is nulled-out. If you get any errors in your code relating to an 'undefined' Scene, then make sure you are not dealing with a destroyed Game Object.

Game Objects have two callbacks that are invoked when they are added to, or removed from, a Scene:

```
class MySprite extends Phaser.GameObjects.Sprite
{
    constructor (scene, x, y, texture, frame)
    {
        super(scene, x, y, texture, frame);
    }

    addedToScene ()
    {
        super.addedToScene();

        //  This Game Object has been added to a Scene
    }

    removedFromScene ()
    {
        super.removedFromScene();

        //  This Game Object has been removed from a Scene
    }
}
```

You are free to use these callbacks in your custom Game Objects, in order to set-up any Scene specific data, or to perform any tasks that need to happen when the Game Object is added to, or removed from, a Scene. Be aware that some Game Objects, such as Sprites, use these callbacks, so make sure you always call `super` when overriding them, as in the example above.

Instead of using the callbacks, you can listen for the `ADDED_TO_SCENE` and `REMOVED_FROM_SCENE` events instead:

```
sprite.on(Phaser.GameObjects.Events.ADDED_TO_SCENE, handler);
sprite.on(Phaser.GameObjects.Events.REMOVED_FROM_SCENE, handler);
```

Both event handlers are sent a reference to the Game Object as the first parameter, and the Scene as the second.

## Creating a game object[​](#creating-a-game-object "Direct link to Creating a game object")

Usually, create and add game objects in the scene's `create()` method.

The `add` methods create and add at once:

```
const sprite = this.add.sprite(0, 0, 'mummy');
```

The `make` methods do the same, when given `add: true`:

```
const sprite = this.make.sprite({ x: 0, y: 0, key: 'mummy', add: true });
// OR
const sprite = this.make.sprite({ x: 0, y: 0, key: 'mummy' }, true);
```

Game objects can be instantiated and then added manually:

```
const sprite = this.add.existing(new Phaser.GameObjects.Sprite(this, 0, 0, 'mummy'));
```

Game objects can be created in a disabled or invisible state:

```
const sprite = this.add.sprite(0, 0, 'mummy').setActive(false).setVisible(false);
```

With `add: false`, the `make` methods do not add the new game object to the scene display list:

```
const sprite = this.make.sprite({ x: 0, y: 0, key: 'mummy', add: false });
// OR
const sprite = this.make.sprite({ x: 0, y: 0, key: 'mummy' }, false);
```

These game objects aren't displayed at all.

Game objects instantiated directly are not added to the scene display list or update list:

```
const sprite = new Phaser.GameObjects.Sprite(this, 0, 0, 'mummy');
```

The update list will also update any object with `active: true` and a `preUpdate()` method:

```
this.sys.updateList.add({
  active: true,
  preUpdate: () => { console.count(); }
});
```

## Removing a game object[​](#removing-a-game-object "Direct link to Removing a game object")

Temporarily remove a game object:

```
sprite.setActive(false).setVisible(false);
```

Permanently remove a game object:

```
sprite.destroy();
```

Destroyed game objects can't be reused. You can detect a destroyed game object by `gameObject.scene === undefined`. (It has `active === false` and `visible === false` as well.)

All game objects are destroyed when the scene is stopped, so you don't need to do that yourself.

## Display List[​](#display-list "Direct link to Display List")

If the Game Object resides on a Display List, which most do, then this is available via the `displayList` property:

```
const list = sprite.displayList;
```

A Game Object can either be on a Display List that belongs to its parent Scene, or it can be on a Layer that belongs to the Scene. This property can also be `null`. As with the `scene` property, you should consider this property as read-only and never change it directly.

The `displayList` property is set when the methods `addToDisplayList` and `removeFromDisplayList` are called. This happens automatically when you create a Game Object via the Game Object Factory, or add or remove it from a Layer.

A Game Object can only exist on one Display List or Layer at any given time, but may move freely between them. If the Game Object is already on another Display List when this method is called, it will first be removed from it, before being added to the new list.

If a Game Object isn't on any Display List, it will not be rendered. If you just wish to temporarly disable it from rendering, consider using the `setVisible` method, instead of adding and removing it.

The act of adding and removing a Game Object will emit the `ADDED_TO_SCENE` and `REMOVED_FROM_SCENE` events respectively.

It's not common to need to call these methods directly, but they are exposed should you require them.

## State and Name[​](#state-and-name "Direct link to State and Name")

The `state` property is a number or string value that you can use to store the current state of a Game Object. Use this property to track the state of a Game Object during its lifetime. For example, it could change from a state of 'moving', to 'attacking', to 'dead'. The state value should be an integer (ideally mapped to a constant in your game code), or a string. These are recommended to keep it light and simple, with fast comparisons. If you need to store complex data about your Game Object, look at using the Data Component instead.

```
sprite.state = 'ALIVE';
```

You can also call the chainable `setState` method:

```
sprite.setState('ALIVE');
```

The `name` property is a string-based name that you can use to identify a Game Object. For example, you could use it to store the type of Game Object, such as `player` or `enemy`.

```
sprite.name = 'player';
```

You can also call the chainable `setName` method:

```
sprite.setName('player');
```

Neither of these properties are ever used by Phaser directly. They are made available purely for you to take advantage of to help structure your games.

## Update List and Active[​](#update-list-and-active "Direct link to Update List and Active")

Every Scene has an Update List. This is a special type of list that is responsible for calling the `preUpdate` method on all Game Objects on the list, once per game step. Some Game Objects need this, others don't. For example, a Sprite needs to have its Animation component updated every frame, so it adds itself to the Update List. However, a Text object doesn't have any components that require updating, so it doesn't add itself to the Update List. If you create a customn class, then you can choose if it should be added to the Update List, or not. You can do this by calling its `addToUpdateList` method:

```
sprite.addToUpdateList();
```

As long as the Game Object has a `preUpdate` method, and doesn't already exist on the Scene Update List, it will be added. You can then use the `preUpdate` method to run any customn logic that your Game Object requires, i.e.:

```
class Bullet extends Phaser.GameObjects.Image
{
    constructor (scene, x, y)
    {
        super(scene, x, y, 'bullet');

        this.addToUpdateList();
    }

    preUpdate (time, delta)
    {
        this.x += 10;

        if (this.x > 800)
        {
            this.setActive(false);
            this.setVisible(false);
        }
    }
}
```

Here we have a custom Game Object called `Bullet`. It extends from `Phaser.GameObjects.Image`, which doesn't use the Update List by itself usually. This is why we call `addToUpdateList` in the constructor. It then uses the `preUpdate` method to move itself across the screen, and if it goes off the edge, it deactivates itself. This means it will no longer be updated by the Update List, and will be skipped in future game steps.

When `preUpdate` is called, it is sent two parameters by the Update List. The first is the current timestamp, as generated by the browser. The second is the delta value, which is derived from the timestamp. This is the difference between the current frame and the previous frame. It is a value expressed in milliseconds and is the amount of time that elapsed between frames. This is what you should use to update your Game Object, rather than relying on `setTimeout` or other methods, because it handles pauses and slowdowns in the browser.

Related to the Update List, the `active` property is a boolean that controls if the Game Object is processed by the Update List, or not. A Game Object that is `active` will have its `preUpdate` method called during the game step, otherwise it will be skipped:

```
sprite.active = false;
```

You can also set the active state of a Game Object by calling the chainable `setActive` method:

```
sprite.setActive(false);
```

As mentioned, not all Game Objects are added to the Update List. For example, toggling this property on a basic Image Game Object won't actually change anything, because Images are not updated by the Update List. However, if you have a custom Game Object that is on the Update List, this is how you toggle it being processed, or not, without needing to add and remove it from the list.

## Parent Containers[​](#parent-containers "Direct link to Parent Containers")

A Game Object can only have one parent Container. A reference to the Container it belongs to is available in the `parentContainer` property:

```
const container = sprite.parentContainer;
```

You should consider this property as read-only. It is set automatically when you add the Game Object to a Container, and nulled when it is removed, or destroyed.

Related to this is the method `getIndexList`. This will return an array of all the indexes of the Game Objects ancestors, going from its position up to the root of the Display List, via any parent Containers:

```
const indexes = sprite.getIndexList();
```

Internally, this is used by the Input Plugin. But you can call it directly if you need to know the depth of the Game Object within the Display List hierarchy.

## Visibility[​](#visibility "Direct link to Visibility")

Game objects can be made invisible or hidden. An invisible game object will skip rendering, but will still process update logic.

*   Get a game object's visibility:
    
    ```
    var visible = gameObject.visible; // returns true or false
    ```
    
*   Set a game object's visibility:
    
    ```
    gameObject.visible = visible;
    gameObject.setVisible(visible);
    ```
    

## Textures[​](#textures "Direct link to Textures")

Certain game objects hold a texture and texture frame.

*   Create a game object with a texture and frame:
    
    ```
    const gameObject = this.add.sprite(0, 0, key, frame);
    ```
    
    *   `key` :　The key of the texture to be used, stored in the Texture Manager, or a Texture instance.
    *   `frame` :　The name or index of the frame within the Texture.
*   Get texture:
    
    ```
    var texture = gameObject.texture;
    var frame = gameObject.frame;
    ```
    
*   Get texture key, frame name:
    
    ```
    var textureKey = gameObject.texture.key;
    var frameName = gameObject.frame.name;
    ```
    
*   Example:
    
    ```
    const sprite = this.add.sprite(0, 0, 'mummy', 1);
    ```
    

The `texture` argument (`'mummy'`) is the key (name) of the texture to load into the sprite when creating it.

Game objects can't be created without a texture. Instead they will receive the "default" texture and frame (32 × 32 transparent):

```
const sprite = this.add.sprite(0, 0);
console.log(sprite.texture.key); // → '__DEFAULT'
console.log(sprite.displayWidth, sprite.displayHeight); // → 32, 32
```

To change texture frames:

*   Set frame
    
    ```
    gameObject.setFrame(frame);
    // gameObject.setFrame(frame, updateSize, updateOrigin);
    ```
    
    *   `frame` :　The name or index of the frame within the Texture.
    *   `updateSize` : Should this call adjust the size of the Game Object?
    *   `updateOrigin` : Should this call adjust the origin of the Game Object?
*   Set frame by frame object
    
    ```
    gameObject.setFrame(frameObject);
    // gameObject.setFrame(frameObject, updateSize, updateOrigin);
    ```
    

```
// Spritesheet-style frame names
sprite.setFrame(2);
sprite.setFrame('2');

// Atlas-style frame names
sprite.setFrame('walkLeft');
```

To change textures:

*   Set texture via key string
    
    ```
    gameObject.setTexture(key);
    // gameObject.setTexture(key, frame);
    // gameObject.setTexture(key, frame, updateSize, updateOrigin);
    ```
    
*   Example:
    
    ```
    const sprite = this.add.sprite(0, 0, 'mummy');
    
    sprite.setTexture('bat');
    console.log(sprite.texture.key); // → 'bat'
    ```
    

Loading or playing an animation can also change a Sprite's texture:

```
const sprite = this.add.sprite(0, 0, 'mummy');

sprite.play('snakeAttack');
console.log(sprite.texture.key); // → 'snake'
```

## Position, origin, and size[​](#position-origin-and-size "Direct link to Position, origin, and size")

`x` and `y` are the game object's local position (if within a Container) or local and world position (if not within a Container). `z` and `w` aren't used by Phaser, so you could use them yourself. `z` is not `depth`.

*   Get a game object's position:
    
    ```
    var x = gameObject.x;
    var y = gameObject.y;
    ```
    
*   Set a game object's position:
    
    ```
    gameObject.x = 0;
    gameObject.y = 0;
    gameObject.setPosition(x,y);
    gameObject.setX(x);
    gameObject.setY(y);
    ```
    
*   Setting a random position:
    
    ```
    gameObject.setRandomPosition(x, y, width, height);
    // gameObject.setRandomPosition(); // x=0, y=0, width=game.width, height=game.height
        ```
    ```
    

`width` and `height` are a game object's intrinsic or unscaled size. For frame-based objects (Image, Sprite), these are the size of the current texture frame and you shouldn't set them. For others (Container, TileSprite), you can set an intrinsic size this way.

*   Get a game object's size:
    
    ```
    var width = gameObject.width;
    var height = gameObject.height;
    ```
    
*   Set a game object's size:
    
    ```
    gameObject.setSize(width, height);
    ```
    
    or
    
    ```
    gameObject.width = width;
    gameObject.height = height;
    ```
    

`originX` and `originY` are the game object's visual origin, in normalized coordinates: (0, 0) is the top-left and (1, 1) is the bottom-right. Rotation and scaling happen from the origin; flipping happens across the center. Most game objects have a default origin of (0.5, 0.5), the center. Render Texture, Text, and Bitmap Text game objects have a default origin of (0, 0), the top-left. Container game objects have a nonconfigurable origin of (0.5, 0.5) for a few special purposes. Blitter and Graphics game objects have a nominal origin of (0, 0), as they're dimensionless.

*   Get a game object's origin:
    
    ```
    var originX = gameObject.originX;
    var originY = gameObject.originY;
    ```
    
*   Set a game object's origin:
    
    ```
    gameObject.setOrigin(x, y);
    // gameObject.setOrigin(x); // y = x if y is not set
    ```
    
*   Set a game object's origin to top-left
    
    ```
    gameObject.setOrigin(0);
    ```
    
*   Set a game object's origin to top-center
    
    ```
    gameObject.setOrigin(0.5, 0);
    ```
    
*   Set a game object's origin to top-right
    
    ```
    gameObject.setOrigin(1, 0);
    ```
    
*   Set a game object's origin to left-center
    
    ```
    gameObject.setOrigin(0, 0.5);
    ```
    
*   Set a game object's origin to center
    
    ```
    gameObject.setOrigin(0.5);
    ```
    
*   Set a game object's origin to right-center
    
    ```
    gameObject.setOrigin(1, 0.5);
    ```
    
*   Set a game object's origin to bottom-left
    
    ```
    gameObject.setOrigin(0, 1);
    ```
    
*   Set a game object's origin to bottom-center
    
    ```
    gameObject.setOrigin(0.5, 1);
    ```
    
*   Set a game object's origin to bottom-right
    
    ```
    gameObject.setOrigin(1);
    ```
    

`flipX` and `flipY` are the game object's rendering toggle to flip the rendered texture on the horizontal or vertical axis. It does not affect the game object's scale value or physics body.

*   Get a game object's flip values:
    
    ```
    var flip = gameObject.flipX;  // flip: true/false
    var flip = gameObject.flipY;  // flip: true/false
    ```
    
*   Set a game object's flip values:
    
    ```
    gameObject.flipX = flip;
    gameObject.flipY = flip;
    gameObject.setFlipX(flip);
    gameObject.setFlipY(flip);
    gameObject.setFlip(flipX, flipY);
    gameObject.toggleFlipX();
    gameObject.toggleFlipY();
    gameObject.resetFlip();  // equal to gameObject.setFlip(false, false);
    ```
    

`displayOriginX` and `displayOriginY` are the game object's origin in unscaled pixel coordinates:

```
(displayOriginX, displayOriginY) == (width, height) * (originX, originY)
```

They are unrelated to `displayWidth` and `displayHeight`, since they refer to the intrinsic size.

`displayWidth` and `displayHeight` are the game object's scaled dimensions, in pixel coordinates:

```
(displayWidth, displayHeight) == (width, height) * (scaleX, scaleY)
```

*   Get a game object's display size:
    
    ```
    var displayWidth = gameObject.displayWidth;
    var displayHeight = gameObject.displayHeight;
    ```
    
*   Set a game object's display size:
    
    ```
    gameObject.setDisplaySize(displayWidth, displayHeight);
    ```
    
    or
    
    ```
    gameObject.displayWidth = displayWidth;
    gameObject.displayHeight = displayHeight;
    ```
    
*   Get a game object's scale:
    
    ```
    var scaleX = gameObject.scaleX;
    var scaleY = gameObject.scaleY;
    ```
    
    or
    
    ```
    var scale = gameObject.scale;  // Returns (scaleX + scaleY)/2
    ```
    
*   Set a game object's scale:
    
    ```
    gameObject.setScale(scaleX, scaleY);
    ```
    
    or
    
    ```
    gameObject.scaleX = scaleX;
    gameObject.scaleY = scaleY;
    ```
    
    or
    
    ```
    gameObject.scale = scale;  // Set scaleX, scaleY to scale
    ```
    

You can get or set a game object's visual size from these. There's no need to set both `displayWidth` and `scaleX` or `displayHeight` and `scaleY`, because both properties are doing the same thing.

Frame-based game objects (Image, Sprite) may change size when switching frames or textures.

When a texture frame has a custom pivot set (usually in the texture atlas), the game object origin is updated automatically when changing frames.

`angle` (degrees, -180 to 180) and `rotation` (radians, -π to π) are the same attribute, in different units. In its initial position, a game object has angle and rotation 0.

*   Get a game object's angle:
    
    ```
    var angle = gameObject.angle;
    var radians = gameObject.rotation;  // angle in radians
    ```
    
*   Set a game object's angle:
    
    ```
    gameObject.angle = degrees;
    gameObject.rotation = radians;
    gameObject.setAngle(degrees);
    gameObject.setRotation(radians);
    ```
    

## Local position and bounds[​](#local-position-and-bounds "Direct link to Local position and bounds")

For game objects not in Containers, local coordinates are also world coordinates.

The local center is `gameObject.x`, `gameObject.y` for origin (0.5, 0.5) or `gameObject.getCenter()` for any origin.

The local, unrotated, unscaled bounds are given by

```
const rect = Phaser.Display.Bounds.GetBounds(gameObject);
// → Rectangle { x, y, width, height, left, top, right, bottom … }
```

This is a rectangle with dimensions identical to the game object's `width` and `height`, positioned by its origin.

You can get the edge coordinates separately:

```
const left = Phaser.Display.Bounds.GetLeft(gameObject);
```

And you can set them:

```
Phaser.Display.Bounds.SetLeft(gameObject, 0);
```

You can calculate the local, unrotated, scaled bounds yourself:

```
const left = gameObject.x - gameObject.originX * gameObject.displayWidth;
const top = gameObject.y - gameObject.originY * gameObject.displayHeight;
```

The local, rotated, scaled coordinates of the four corners and four edge midpoints are given by `getTopLeft()`, `getLeftCenter()`, etc.

The `getLocalPoint()` method converts world coordinates into a game object's **own** coordinate space (including transforms). For an image, these are also texture coordinates. For a shape, these may be similar to the geometry coordinates. For a container, these are the child object's local coordinates.

```
var point = gameObject.getLocalPoint(x, y);  // point : {x, y}
// var out = gameObject.getLocalPoint(x, y, out);
```

or

```
var out = gameObject.getLocalPoint(x, y, out, camera);
```

## World position and bounds[​](#world-position-and-bounds "Direct link to World position and bounds")

These are for game objects in Containers. (For game objects not in Containers, world coordinates are also local coordinates.)

The game object's position in world coordinates is

```
const { tx, ty } = gameObject.getWorldTransformMatrix();
```

The bounds in world coordinates are

```
const bounds = gameObject.getBounds();
// → Rectangle { x, y, width, height, left, top, right, bottom, centerX, centerY, … }
```

This is the smallest axis-aligned rectangle containing the rotated, scaled corners of the game object.

The transformed corners in world coordinates are:

```
const { x, y } = gameObject.getTopLeft(undefined, true);
const { x, y } = gameObject.getTopCenter(undefined, true);
const { x, y } = gameObject.getTopRight(undefined, true);
const { x, y } = gameObject.getLeftCenter(undefined, true);
const { x, y } = gameObject.getRightCenter(undefined, true);
const { x, y } = gameObject.getBottomLeft(undefined, true);
const { x, y } = gameObject.getBottomCenter(undefined, true);
const { x, y } = gameObject.getBottomRight(undefined, true);
```

And the center in world coordinates is

```
const { x, y } = gameObject.prepareBoundsOutput(gameObject.getCenter(), true);
```

or (Phaser v3.60)

```
const { x, y } = gameObject.getCenter(undefined, true);
```

## Geometry[​](#geometry "Direct link to Geometry")

You can convert most game objects to a Geom point, circle, or rectangle for some calculations, such as intersection checks.

## Crop[​](#crop "Direct link to Crop")

Crop clips the visible area of a game object's texture frame.

*   Applying a crop to a texture
    
    ```
    gameObject.setCrop(x, y, width, height);
    ```
    
*   Resetting crop
    
    ```
    gameObject.setCrop();
    // gameObject.isCropped = false;
    ```
    
*   Example:
    
    ```
    image.setCrop(0, 0, 64, 32);
    ```
    

The values are in texture coordinates, where (0, 0) is the top-left of the texture.

Cropping doesn't change the game object's actual bounds or its input hit area.

## Input[​](#input "Direct link to Input")

Use `setInteractive()` to let a game object receive input events. Any game object can be made interactive, but only some have an automatic hit area. For the others you need to provide a hit area and hit test function.

*   Basic usage:

```
gameObject.setInteractive().on('pointerdown', function(pointer, localX, localY, event){
    // ...
});
```

For game objects with a texture frame (`frame`) or a nonzero `width` and `height`, `setInteractive()` with no arguments creates a rectangular hit area of the same size:

```
const sprite = this.add.sprite(0, 0, 'mummy').setInteractive();

console.log(sprite.input.hitArea); // → Rectangle { x: 0, y: 0, width: 32, height: 48 }
```

`hitArea` is in local coordinates, where (0, 0) is the top-left of the game object, regardless of origin.

You can construct the same hit area manually. You must pass a hit area **and** hit test function:

```
sprite.setInteractive(
  new Phaser.Geom.Rectangle(0, 0, sprite.frame.realWidth, sprite.frame.realHeight),
  Phaser.Geom.Rectangle.Contains
);
```

You can use any geometry shape, with the corresponding `Contains` function:

```
sprite.setInteractive(
  new Phaser.Geom.Circle(sprite.displayOriginX, sprite.displayOriginY, sprite.width),
  Phaser.Geom.Circle.Contains
);
```

You can use your own hit area and test function:

```
sprite.setInteractive({
  hitArea: [
    new Phaser.Geom.Circle(0, 0, 32),
    new Phaser.Geom.Circle(64, 64, 32),
    new Phaser.Geom.Circle(128, 128, 32)
  ],

  hitAreaCallback: (hitArea, x, y, gameObject) => {
    return hitArea[0].contains(x, y) ||
        hitArea[1].contains(x, y) ||
        hitArea[2].contains(x, y);
  }
});
```

## Alpha[​](#alpha "Direct link to Alpha")

Game objects with `alpha === 0` are invisible.

In WebGL mode the four corners of a texture can have different alpha values.

*   Get a game object's alpha:
    
    ```
    var alpha = gameObject.alpha;  // 0~1
    ```
    
*   Set a game object's alpha:
    
    ```
    gameObject.setAlpha(alpha);
    // gameObject.alpha = alpha;
    ```
    
    or in WebGL mode:
    
    ```
    gameObject.setAlpha(topLeft, topRight, bottomLeft, bottomRight);
    // gameObject.alphaTopLeft = alpha;
    // gameObject.alphaTopRight = alpha;
    // gameObject.alphaBottomLeft = alpha;
    // gameObject.alphaBottomRight = alpha;
    ```
    
*   Clear (set to `1`)
    
    ```
    gameObject.clearAlpha();
    ```
    

## Tint[​](#tint "Direct link to Tint")

**Tint** is a dye-like color effect on a game object's texture. It's WebGL only.

*   Get a game object's tint:
    
    ```
    var color = gameObject.tintTopLeft; // color: 0xRRGGBB
    var color = gameObject.tintTopRight;
    var color = gameObject.tintBottomLeft;
    var color = gameObject.tintBottomRight;
    var isTinted = gameObject.isTinted; // is the game object tinted?
    ```
    

Mathematically, tint multiplies each texture pixel by the tint color, so a tinted pixel is never brighter than an untinted one. White tint (0xffffff) has no effect and black tint (0x000000) makes all pixels black. In the texture, white pixels tint completely and black pixels not at all. So white images are good for tintable shapes or bitmap text.

**Tint fill** is an opaque fill, like a paint bucket fill:

```
sprite.setTintFill(0x01ff70);
```

`clearTint()` removes both kinds of tint.

The four corners of a game object's texture can be tinted separately, forming gradients:

```
sprite.setTint(0xff4136, 0xffdc00, 0x2ecc40, 0x0074d9);
// OR
sprite.tintTopLeft = 0xff4136; // etc.
```

!!! note `gameObject.tint` is a write-only property

## Depth and render order[​](#depth-and-render-order "Direct link to Depth and render order")

Game objects are rendered by their position in the display list, start to end (or back to front). By default this is the order you added them to the scene in.

You can move them within the display list:

```
this.children.bringToTop(gameObject);

this.children.sendToBack(gameObject);

this.children.moveUp(gameObject);
this.children.moveDown(gameObject);
this.children.moveAbove(child1, child2);  // Move child1 above child2
this.children.moveBelow(child1, child2);  // Move child1 below child2

this.children.moveTo(gameObject, depth);
this.children.swap(child1, child2);
```

(`this.children` is the scene display list, also found at `this.sys.displayList`.)

Game objects in containers can be moved the same way by the container's methods:

```
container.bringToTop(gameObject);
// etc.
```

You can assign a depth-sort order (z-index):

```
gameObject.depth = value;
gameObject.setDepth(value);
```

`depth` (z-index) is **a sort order, not a position in the display list**. All game objects have a default `depth` of 0. Larger depths sort to the front of smaller depths. The sorting happens right before the scene renders. Game objects keep their `depth` after sorting.

*   Get a game object's `depth`:
    
    ```
    var depth = gameObject.depth;
    ```
    

You can use fractional or negative values for `depth`. You don't need to use gigantic values.

Game objects in layers can also be depth sorted this way, but game objects in containers can't.

> Containers themselves can be depth sorted just like anything else, so it only really becomes an issue when a Container is used to house multiple different entities, i.e. one Container holding say all enemies for a level and suddenly you want one to pop above the rest. In this case, it needs removing from its Container, adding to another one (higher up the render list) until the effect is over, then putting back again.

## Blend mode[​](#blend-mode "Direct link to Blend mode")

Blend modes affect how a game object is rendered when another game object is underneath it.

Blend modes have different effects under Canvas and WebGL, and from browser to browser, depending on support.

*   Get a game object's blend mode:
    
    ```
    var blendMode = gameObject.blendMode;
    ```
    
*   Set a game object's blend mode:
    
    ```
    gameObject.blendMode = blendMode;
    gameObject.setBlendMode(blendMode);
    ```
    

### WebGL and Canvas[​](#webgl-and-canvas "Direct link to WebGL and Canvas")

*   `'NORMAL'`, or `Phaser.BlendModes.NORMAL`, or `0`
    *   Default setting and draws new shapes on top of the existing canvas content.
*   `'ADD'`, or `Phaser.BlendModes.ADD`, or `1`
    *   Where both shapes overlap the color is determined by adding color values.
*   `'MULTIPLY'`, or `Phaser.BlendModes.MULTIPLY`, or `2`
    *   The pixels are of the top layer are multiplied with the corresponding pixel of the bottom layer. A darker picture is the result.
*   `'SCREEN'`, or `Phaser.BlendModes.SCREEN`, or `3`
    *   The pixels are inverted, multiplied, and inverted again. A lighter picture is the result (opposite of multiply)
*   `'ERASE'`, or `Phaser.BlendModes.ERASE`, or `17`
    *   Alpha erase blend mode. Only works when rendering to a framebuffer, like a _Render Texture_

### Canvas only[​](#canvas-only "Direct link to Canvas only")

*   `'OVERLAY'`, or `Phaser.BlendModes.OVERLAY`, or `4`
    *   A combination of multiply and screen. Dark parts on the base layer become darker, and light parts become lighter.
*   `'DARKEN'`, or `Phaser.BlendModes.DARKEN`, or `5`
    *   Retains the darkest pixels of both layers.
*   `'LIGHTEN'`, or `Phaser.BlendModes.LIGHTEN`, or `6`
    *   Retains the lightest pixels of both layers.
*   `'COLOR_DODGE'`, or `Phaser.BlendModes.COLOR_DODGE`, or `7`
    *   Divides the bottom layer by the inverted top layer.
*   `'COLOR_BURN'`, or `Phaser.BlendModes.COLOR_BURN`, or `8`
    *   Divides the inverted bottom layer by the top layer, and then inverts the result.
*   `'HARD_LIGHT'`, or `Phaser.BlendModes.HARD_LIGHT`, or `9`
    *   A combination of multiply and screen like overlay, but with top and bottom layer swapped.
*   `'SOFT_LIGHT'`, or `Phaser.BlendModes.SOFT_LIGHT`, or `10`
    *   A softer version of hard-light. Pure black or white does not result in pure black or white.
*   `'DIFFERENCE'`, or `Phaser.BlendModes.DIFFERENCE`, or `11`
    *   Subtracts the bottom layer from the top layer or the other way round to always get a positive value.
*   `'EXCLUSION'`, or `Phaser.BlendModes.EXCLUSION`, or `12`
    *   Like difference, but with lower contrast.
*   `'HUE'`, or `Phaser.BlendModes.HUE`, or `13`
    *   Preserves the luma and chroma of the bottom layer, while adopting the hue of the top layer.
*   `'SATURATION'`, or `Phaser.BlendModes.SATURATION`, or `14`
    *   Preserves the luma and hue of the bottom layer, while adopting the chroma of the top layer.
*   `'COLOR'`, or `Phaser.BlendModes.COLOR`, or `15`
    *   Preserves the luma of the bottom layer, while adopting the hue and chroma of the top layer.
*   `'LUMINOSITY'`, or `Phaser.BlendModes.LUMINOSITY`, or `16`
    *   Preserves the hue and chroma of the bottom layer, while adopting the luma of the top layer.
*   `'SOURCE_IN'`, or `Phaser.BlendModes.SOURCE_IN`, or `18`
    *   The new shape is drawn only where both the new shape and the destination canvas overlap. Everything else is made transparent.
*   `'SOURCE_OUT'`, or `Phaser.BlendModes.SOURCE_OUT`, or `19`
    *   The new shape is drawn where it doesn't overlap the existing canvas content.
*   `'SOURCE_ATOP'`, or `Phaser.BlendModes.SOURCE_ATOP`, or `20`
    *   The new shape is only drawn where it overlaps the existing canvas content.
*   `'DESTINATION_OVER'`, or `Phaser.BlendModes.DESTINATION_OVER`, or `21`
    *   New shapes are drawn behind the existing canvas content.
*   `'DESTINATION_IN'`, or `Phaser.BlendModes.DESTINATION_IN`, or `22`
    *   The existing canvas content is kept where both the new shape and existing canvas content overlap. Everything else is made transparent.
*   `'DESTINATION_OUT'`, or `Phaser.BlendModes.DESTINATION_OUT`, or `23`
    *   The existing content is kept where it doesn't overlap the new shape.
*   `'DESTINATION_ATOP'`, or `Phaser.BlendModes.DESTINATION_ATOP`, or `24`
    *   The existing canvas is only kept where it overlaps the new shape. The new shape is drawn behind the canvas content.
*   `'LIGHTER'`, or `Phaser.BlendModes.LIGHTER`, or `25`
    *   Where both shapes overlap the color is determined by adding color values.
*   `'COPY'`, or `Phaser.BlendModes.COPY`, or `26`
    *   Only the new shape is shown.
*   `'XOR'`, or `Phaser.BlendModes.XOR`, or `27`
    *   Shapes are made transparent where both overlap and drawn normal everywhere else.

## Effects[​](#effects "Direct link to Effects")

All effects work in WebGL mode only and do not have canvas counterparts. The effects include the following:

*   Barrel Distortion
*   Bloom
*   Blur
*   Bokeh / Tilt Shift
*   Circle Outline
*   Color Matrix
*   Glow
*   Displacement
*   Gradient
*   Pixelate
*   Shine
*   Shadow
*   Vignette
*   Wipe / Reveal

> Pre FX are for texture based game objects only (Sprite, TileSprite, Video, etc.), but Post FX applies to anything, including Cameras. The difference is that Pre FX can alter the actual draw of the game object, sort of like having a custom pipeline but far less stress.
> 
> If you apply Post FX to a Container, then it will render all children to that fx, then run the shader on it and put the results in to the game – so if you had a 'glow' shader it would glow everything as one single object. Pre FX on the other hand would glow each object in turn. So more expensive, but likely more the required result depending on the game.

## Scroll factor[​](#scroll-factor "Direct link to Scroll factor")

Scroll factor controls how much game objects move (relative to the game canvas) when the camera is scrolled.

*   Get a game object's scroll factor:
    
    ```
    var scrollFactorX = gameObject.scrollFactorX;
    var scrollFactorY = gameObject.scrollFactorY;
    ```
    
*   Set a game object's scroll factor:
    
    ```
    gameObject.setScrollFactor(scrollFactor);
    gameObject.setScrollFactor(scrollFactorX, scrollFactorY);
    ```
    

Scroll factor: 0~1

*   0 = fixed to camera
*   0.25 = quarter the speed of the camera
*   0.5 = half the speed of the camera

The default values are (1, 1). Scroll factor (0, 0) can be used for fixed backgrounds or UI elements. Factors between 0 and 1 can be used for parallax scrolling effects.

Don't use scroll factors other than (1, 1) for physics game objects, as it doesn't make sense.

## State[​](#state "Direct link to State")

You can store simple values (number or string) in the `state` field.

*   Get a game object's state:
    
    ```
    var state = gameObject.state;
    ```
    
*   Set a game object's state:
    
    ```
    gameObject.setState(state);
    ```
    
*   Examples:
    
    ```
    // State
    mummy.state = 'sleeping';
    bat.state = 'movingLeft';
    
    // Coins
    treasure.state = 10;
    treasure.state -= 1;
    
    // Health
    snake.state = 3;
    ```
    

## Data[​](#data "Direct link to Data")

Use the data store for a more structured approach, or lots of data. By default, the Data Manager is set to `null`. It is usually unnecessary to enable as it is automatically enabled when data is added. To enable a game object's data manager:

```
gameObject.setDataEnabled();
```

*   Get a game object's data:
    
    ```
    var value = gameObject.getData(key);
    var values = gameObject.getData(keys); // keys: an array of keys
    var value = gameObject.data.values[key];
    ```
    
    Example:
    
    ```
    mummy.getData('health'); // → 3
    ```
    
*   Set a game object's data (automatically enables the Data Manager):
    
    ```
    gameObject.setData(key, value);
    gameObject.incData(key, value); // increments existing value or if the key doesn't exist, increases the value from 0
    gameObject.setData(obj); // obj: {key0:value0, key1:value1, ...}
    gameObject.data.values[key] = value;
    gameObject.data.values[key] += inc;
    gameObject.toggleData(key); // toggles a boolean value for the given key or if the key doesn't exist, toggles the value from false
    ```
    
    Example:
    
    ```
    mummy.setData('isAlive', true);
    mummy.setData('health', 3);
    mummy.incData('health', 3); // increments existing value (health += 3) or if the key doesn't exist, increases the value from 0
    
    let obj = { health: 3 };
    mummy.setData(obj);
    mummy.data.values['health'] = 3;
    mummy.data.values['health'] += 3;
    
    mummy.toggleData('isAlive');
    ```
    

The data store emits events (from the game object itself) when values are added or changed. Be sure the data manager is enabled before binding any data-changed events.

*   Set data evants
    
    ```
    gameObject.on('setdata', function(gameObject, key, value){ /* ... */ });
    ```
    
*   Change data events
    
    ```
    gameObject.on('changedata', function(gameObject, key, value, previousValue){ /* ... */ });
    ```
    
    ```
    gameObject.on('changedata-' + key, function(gameObject, value, previousValue){ /* ... */ });
    ```
    
    Example:
    
    ```
    mummy.on('changedata-health', (gameObject, dataKey, dataValue) => {/*…*/});
    ```
    

You can store other objects like game objects, timer events, or tweens. The data store is cleared when the parent game object is destroyed, so there's no problem with cleanup.

```
const cat = this.add.sprite(/*…*/);

mummy.setData('familiar', cat);
// …
mummy.destroy();
```

## Name[​](#name "Direct link to Name")

You can use the `name` field to identify your game objects, either for game logic or debugging. Phaser doesn't use this field.

*   Get a game object's name:
    
    ```
    var name = gameObject.name;
    ```
    
*   Set a game object's name:
    
    ```
    gameObject.setName(name);
    gameObject.name = name;
    ```
    
*   Example:
    
    ```
    this.add.sprite(0, 0, 'bat').setName('bat1');
    
    mummy.setName('Reginald');
    ```
    

## Type[​](#type "Direct link to Type")

E.g., "TileSprite". Phaser uses this so you should leave it alone.

## Events[​](#events "Direct link to Events")

Game objects emit events directly.

Each game object emits [ADDED\_TO\_SCENE](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.Events.ADDED_TO_SCENE), [REMOVED\_FROM\_SCENE](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.Events.REMOVED_FROM_SCENE), and [DESTROY](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.Events.DESTROY). `ADDED_TO_SCENE` and `REMOVED_FROM_SCENE` are fired when adding to or removing from any display list, e.g., containers. Only `DESTROY` happens only once.

Animatable game objects (e.g. Sprite) also emit [animation events](https://newdocs.phaser.io/docs/latest/Phaser.Animations.Events).

Interactive game objects also emit interaction events.

Video game objects also emit playback events.

Game objects with a data store also emit [data events](https://newdocs.phaser.io/docs/latest/Phaser.Data.Events).

## Creation patterns[​](#creation-patterns "Direct link to Creation patterns")

The `make` methods are flexible and work well with structured data, like JSON.

Groups provide `create()` and `createMultiple()` methods.

There are simple ways to organize game object creation without extending classes:

```
function create() {
  const mummy = createMummy.call(this, 0, 0);
}

function createMummy(x, y) {
  return this.add.mummy(x, y, 'mummy');
}
```

If you don't like `call()`:

```
function create() {
  const mummy = createMummy(this, 0, 0);
}

function createMummy(scene, x, y) {
  return scene.add.mummy(x, y, 'mummy');
}
```

You can add creator and factory methods without extending classes:

```
function create() {
  const mummy = this.add.mummy(0, 0);
}

Phaser.GameObjects.GameObjectFactory.register('mummy', function (x, y) {
  return this.sprite(x, y, 'mummy');
}
```

## Extending game objects[​](#extending-game-objects "Direct link to Extending game objects")

Most beginners shouldn't extend game object classes yet.

Choose a class to extend and call `super()` with all required arguments. Don't extend [Phaser.GameObjects.GameObject](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.GameObject) by itself.

```
class MummySprite extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y, texture = 'mummy', frame = 0) {
    super(scene, x, y, texture, frame);
    // this.scene, this.x, this.y, this.texture, this.frame are set.
  }
}
```

Phaser game object classes don't **add** themselves to the scene, so `super()` will not do that.

Add the game object separately, in the scene:

```
this.add.existing(new MummySprite(this, 0, 0));
```

or add it from the class:

```
this.scene.add.existing(this);
```

If you override the class's `preUpdate()` method, call the superclass method as well with the same arguments. Otherwise the game object may freeze.

```
class MummySprite extends Phaser.GameObjects.Sprite {
  // …
  preUpdate (time, delta) {
    super.preUpdate(time, delta);
    // …
  }
}
```

If you override the class's `destroy()` method, call the superclass method also. Or consider using the [DESTROY](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.Events.DESTROY) event instead.

A game object's `update()` method isn't called automatically. You can

*   call the `update()` method yourself; or
*   add the game object to a group with `runChildUpdate = true`; or
*   bind the `update()` method to the scene's UPDATE event (the arguments match):

```
class MummySprite extends Phaser.GameObjects.Sprite {
  constructor () {
    // …
    const { events } = this.scene;

    events.on('update', this.update, this);

    this.once('destroy', function () {
      events.off('update', this.update, this);
    }, this);
  }

  update (time, delta) {
    // …
  }
}
```

## Custom game object classes[​](#custom-game-object-classes "Direct link to Custom game object classes")

*   Creating a pure entity class holding a game object:
    
    ```
    class Mummy {
        constructor (scene, x, y) {
            this.sprite = scene.add.sprite(x, y, 'mummy');
            
            // You may need to reach the parent object from the sprite, e.g., from within a callback.
            this.sprite.setData('parent', this);
    
            this.sprite.once('destroy', this.onSpriteDestroyed, this);
        }
        
        onSpriteDestroyed (sprite) {
            this.sprite = null;
        }
    }
    ```
    
*   Creating a custom game object class:
    
    ```
    class MyClass extends BaseClass {
        constructor(scene, x, y) {
            super(scene, x, y);
            // ...
            scene.add.existing(this);
        }
        // ...
    
        // preUpdate(time, delta) {
        //     if (super.preUpdate) {
        //         super.preUpdate(time, delta);
        //     }
        // }
    
        // destroy(fromScene) {
        //     //  This Game Object has already been destroyed
        //     if (!this.scene) {
        //         return;
        //     }
        //     super.destroy(fromScene);
        // }
    }
    ```
    
    *   `scene.add.existing(gameObject)` : Adds an existing Game Object to this Scene.
        *   If the Game Object renders, it will be added to the Display List.
        *   If it has a `preUpdate` method, it will be added to the Update List.
            *   Some kinds of game object like Sprite, Dom-element has `preUpdate` method already.
*   Creating a custom class instance:
    
    ```
    var image = new MyClass(scene, x, y, key);
    ```
    

## Common Problems[​](#common-problems "Direct link to Common Problems")

### I added a game object but I can't see it[​](#i-added-a-game-object-but-i-cant-see-it "Direct link to I added a game object but I can't see it")

The game developer's lament.

*   it's outside the camera viewport
*   it's behind another game object
*   it has the "default" (blank) texture
*   it's not on the display list
*   it has `visible === false`
*   it has `alpha === 0`
*   it has scale 0
*   it's masked
*   it was already destroyed

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
