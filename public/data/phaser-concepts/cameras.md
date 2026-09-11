# Cameras

Phaser has a built-in Camera system. A Camera is a way to control which part of your Game World you are currently looking at. You can move the camera around the world, and that in turn will influence which Game Objects are displayed, based on their world position. By default, a Scene creates a single Camera ready for you to use. It must always have at least one Camera, otherwise nothing will render.

You can add as many extra Cameras as you like. You can also control the position, size, rotation, scaling and viewport of each Camera. Common uses of being able to have multiple cameras are for creating split-screen games, or games with picture-in-picture effects.

Cameras can also be given a bounds. This is a rectangular area that the Camera cannot scroll outside of. By default, a Camera has no bounds, so it can freely scroll anywhere. However in practise you will likely need to constrain the Camera to a fixed area of your Game World, and the Camera Bounds are how you do this.

## Camera Basics[​](#camera-basics "Direct link to Camera Basics")

![Four cameras showing a giant robot](https://labs.phaser.io/screenshots/camera/cameras%20from%20state%20config.png)

Cameras display the game objects in a scene. You create or access them from the scene camera manager, `this.cameras`. By default each scene has one camera.

### Get the main camera[​](#get-the-main-camera "Direct link to Get the main camera")

```
var camera = this.cameras.main;
```

or

```
var camera = this.cameras.cameras[0];
```

### Get camera by name[​](#get-camera-by-name "Direct link to Get camera by name")

```
var camera = this.cameras.getCamera(name);
```

### Add new camera[​](#add-new-camera "Direct link to Add new camera")

```
var camera = this.cameras.add();
// var camera = this.cameras.add(x, y, width, height);
```

### Add new camera with name[​](#add-new-camera-with-name "Direct link to Add new camera with name")

```
var camera = this.cameras.add(
  undefined,
  undefined,
  undefined,
  undefined,
  false,
  name
);
// var camera = this.cameras.add(x, y, width, height, makeMain, name);
```

### Add existing camera[​](#add-existing-camera "Direct link to Add existing camera")

```
this.cameras.addExisting(camera);
```

### Create cameras from JSON[​](#create-cameras-from-json "Direct link to Create cameras from JSON")

```
this.cameras.fromJSON(config);
// this.cameras.fromJSON(configArray);
```

### Camera `config` :[​](#camera-config- "Direct link to camera-config-")

```
{
    name: '',
    x: 0,
    y: 0,
    width: scene.sys.scale.width,
    height: scene.sys.scale.height,
    zoom: 1,
    rotation: 0,
    scrollX: 0,
    scrollY: 0,
    roundPixels: false,
    visible: true,
    backgroundColor: false,
    bounds: null, // {x, y, width, height}
}
```

### Remove a camera[​](#remove-a-camera "Direct link to Remove a camera")

```
this.cameras.remove(camera);
```

### Destroy a camera[​](#destroy-a-camera "Direct link to Destroy a camera")

```
camera.destroy();
```

If you create multiple cameras then `main` is used as the default in some Phaser functions that accept a camera argument. You can assign any camera as main.

`this.cameras.default` is a non-rendering camera that represents a camera's default state (not resized or transformed).

Cameras are recreated each time the scene starts, so don't keep any references to them.

A camera has two distinct coordinate spaces, its **viewport** and **world view**.

Viewport

World view

`x`

`worldView.x` or `worldView.left`

`y`

`worldView.y` or `worldView.top`

`width`

`displayWidth` or `worldView.width`

`height`

`displayHeight` or `worldView.height`

`centerX`

`midPoint.x` or `worldView.centerX`

`centerY`

`midPoint.y` or `worldView.centerY`

## Viewport[​](#viewport "Direct link to Viewport")

The camera `viewport` is its "window" or visible area on the game canvas. `x` (left), `y` (top), `width`, `height`, `centerX`, `centerY`, `setSize()`, and `setViewport()` all refer to the viewport. By default the camera viewport is identical to the game viewport, i.e.,

`{ x: 0, y: 0, width: this.scale.width, height: this.scale.height }`

### Usage[​](#usage "Direct link to Usage")

*   Get camera position
    
    *   Top-left
        
        ```
        var top = camera.x;
        var left = camera.y;
        ```
        
    *   Center, relative to the top-left of the game canvas.
        
        ```
        var x = camera.centerX;
        var y = camera.centerY;
        ```
        
*   Get camera size (width & height)
    
    ```
    var width = camera.width;
    var height = camera.height;
    ```
    
    ```
    var displayWidth = camera.displayWidth;
    var displayHeight = camera.displayHeight;
    ```
    
*   Set camera viewpoirt
    
    ```
    camera.setViewport(top, left, width, height);
    ```
    
*   Set camera position
    
    ```
    camera.setPosition(top, left);
    // camera.x = top;
    // camera.y = left;
    ```
    
*   Set camera size
    
    ```
    camera.setSize(width, height);
    // camera.width = width;
    // camera.height = height;
    ```
    

## World view[​](#world-view "Direct link to World view")

The camera `worldView` is the area of the game world it can "see", based on its scroll, rotation, and zoom, in game world coordinates. `midPoint`, `displayWidth`, and `displayHeight` refer to this view area.

`midPoint` and `worldView` are updated **only** after the first scene render. If you need to use these earlier than that, use

```
function create() {
  // …
  this.cameras.main.preRender();
}
```

If you never scroll, zoom, or rotate a camera then its world view is identical to its viewport.

### Usage[​](#usage-1 "Direct link to Usage")

*   World view, a [rectangle object](/phaser/concepts/geometry#Rectangle)
    
    ```
    var worldView = camera.worldView;
    var x = worldView.x;
    var y = worldView.y;
    var width = worldView.width; // displayWidth
    var height = worldView.height; // displayHeight
    var left = worldView.left; // x
    var right = worldView.right; // x + width
    var top = worldView.top; // y
    var bottom = worldView.bottom; // y + height
    var centerX = worldView.centerX;
    var centerY = worldView.centerY;
    var isInside = worldView.contains(x, y);
    var randPoint = worldView.getRandomPoint(point); // point: {x, y}
    ```
    
*   Get middle point
    
    ```
    var x = camera.midPoint.x;
    var y = camera.midPoint.y;
    ```
    
*   Get world position
    
    ```
    var out = camera.getWorldPoint(x, y);
    // var out = camera.getWorldPoint(x, y, out);
    ```
    
    *   `x` , `y` : Position of camera.
    *   `out` : World position `{x, y}`

## Visibility & Input[​](#visibility--input "Direct link to Visibility & Input")

A visible camera will render and respond to pointer input unless you set the camera's `inputEnabled` to `false`.

An invisible camera will not render anything and will skip input tests.

### Usage[​](#usage-2 "Direct link to Usage")

*   Get camera visibility
    
    ```
    var visible = camera.visible;
    ```
    
*   Set camera visibility
    
    ```
    camera.setVisible(value);
    // camera.visible = value
    ```
    

## Rendering[​](#rendering "Direct link to Rendering")

You can change each camera's `roundPixels` property. By default it's the same value you set in the game config, or `false`.

`startFollow()` also sets the camera's `roundPixels` property to `false` by default unless the `roundPixels` argument is provided.

Setting `roundPixels` to `true`, makes the camera round pixel values to whole integers when rendering Game Objects. In some types of game, especially with pixel art, this is required to prevent sub-pixel aliasing.

### Round pixels usage[​](#round-pixels-usage "Direct link to Round pixels usage")

*   Get camera `roundPixels`
    
    ```
    var roundPixels = camera.roundPixels;
    ```
    
*   Set camera `roundPixels`
    
    ```
    camera.setRoundPixels(value);
    // camera.roundPixels = value
    ```
    

### Set background color[​](#set-background-color "Direct link to Set background color")

Use this to set a default background color for the camera.

```
camera.setBackgroundColor(color);
```

### Ignoring game objects[​](#ignoring-game-objects "Direct link to Ignoring game objects")

A camera will not render specified game objects.

```
camera.ignore(gameObject);
```

*   `gameObject` :
    *   A game object
    *   An array of game objects
    *   A group

## Effects[​](#effects "Direct link to Effects")

Cameras have timed **fade**, **flash**, **pan**, **rotate**, **shake**, and **zoom** effects. See the methods for details. Most methods won't interrupt an ongoing effect unless you pass `force = true`. You can reset a given effect with, e.g., `fadeEffect.reset()` or `flashEffect.reset()`. You can monitor an ongoing effect with, e.g., `fadeEffect.isRunning`, `fadeEffect.progress`, etc.

You shouldn't start a camera effect during every update. For that you should be using methods like `centerOn()`, `setRotation()`, `setZoom()` instead.

`fadeOut()` is usually paired with `fadeIn()`.

You can pass a callback or register an event handler (usually with `once()`) on the camera to act on the event completion.

You can reset all effects by calling the camera's `resetFX()` method.

You can also tween some camera properties (`alpha`, `rotation`, `scrollX`, `scrollY`, `zoom`) yourself instead of using the effects.

### Alpha[​](#alpha "Direct link to Alpha")

The Camera alpha value impacts every single object that the Camera renders. You can either set the property directly, i.e. via a Tween, to fade a Camera in or out, or via the chainable setAlpha method instead.

#### Usage[​](#usage-3 "Direct link to Usage")

*   Get camera alpha
    
    ```
    var alpha = camera.alpha;
    ```
    
*   Set camera alpha
    
    ```
    camera.setAlpha(value);
    // camera.alpha = value;
    ```
    

### Rotation[​](#rotation "Direct link to Rotation")

Camera rotation always takes place based on the Camera viewport. By default, rotation happens in the center of the `viewport`. You can adjust this with the `originX` and `originY` properties.

Rotation influences the rendering of all Game Objects visible by this Camera. However, it does not rotate the Camera viewport itself, which always remains an axis-aligned rectangle.

#### Usage[​](#usage-4 "Direct link to Usage")

*   Get camera rotation
    
    ```
    var angle = camera.rotation; // angle in radians
    ```
    
*   Set camera rotation
    
    ```
    camera.setAngle(angle); // angle in degree
    camera.setRotation(angle); // angle in radians
    camera.rotation = angle; // angle in radians
    ```
    

### Origin[​](#origin "Direct link to Origin")

Changing the origin allows you to adjust the point in the viewport from which rotation happens. Setting `x` and `y` to 0 rotates the camera from the top-left of the viewport. Setting `x` and `y` to 1 rotates the camera from the bottom right.

#### Usage[​](#usage-5 "Direct link to Usage")

*   Get camera origin
    
    ```
    var originX = camera.originX;
    var originY = camera.originY;
    ```
    
*   Set camera origin
    
    ```
    camera.setOrigin(x, y);
    // camera.originX = 0.5;
    // camera.originY = 0.5;
    ```
    

### Scrolling[​](#scrolling "Direct link to Scrolling")

`scrollX`, `scrollY` are the camera scroll coordinates, where (0, 0) is the initial scroll position. They represent the distance between the top-left of the camera's world view and its viewport. So increasing `scrollX` and `scrollY` moves the camera view down and to the right or the game world objects up and to the left, depending on your perspective.

`setScroll(x, y)` sets `scrollX` and `scrollY` directly.

`centerOn(x, y)` and `pan(x, y)` also scroll the camera, but their arguments refer to the camera's `midPoint`, so they are often a more natural choice.

Scroll coordinates are unzoomed.

#### Usage[​](#usage-6 "Direct link to Usage")

*   Scroll camera to x, y position
    
    ```
    camera.scrollX = scrollX;
    camera.scrollY = scrollY;
    ```
    
    or
    
    ```
    camera.setScroll(x, y);
    ```
    
*   Move camera to center of camera bounds
    
    ```
    camera.centerToBounds();
    ```
    
*   Center camera to x, y position
    
    ```
    camera.centerOn(x, y); // centered on the given coordinates
    ```
    
    or
    
    ```
    camera.centerOnX(x);
    camera.centerOnY(y);
    ```
    
*   Center Camera based on viewport size.
    
    ```
    camera.centerToSize();
    ```
    

### Follow game object[​](#follow-game-object "Direct link to Follow game object")

Sets the Camera to follow a Game Object.

`camera.startFollow(target, roundPixels, lerpX, lerpY, offsetX, offsetY)`

`target` can be a game object or point-like object.

The camera scrolls automatically to keep the target in the center of the viewport. The optional `lerpX` and `lerpY` arguments smooth the movement by interpolating the two positions.

The camera deadzone (if set) is an area where the follow target can move (relative to the viewport) without scrolling the camera. The deadzone is always centered on the follow target, in world coordinates.

#### Usage[​](#usage-7 "Direct link to Usage")

*   Start following
    
    ```
    camera.startFollow(gameObject);
    // camera.startFollow(gameObject, roundPx, lerpX, lerpY, offsetX, offsetY);  //
    ```
    
    *   `roundPx` : set true to round the camera position to integers
    *   `lerpX`, `lerpY` : A value between 0 and 1.
        *   `1` : Camera will instantly snap to the target coordinates.
        *   `0.1` : Camera will more slowly track the target, giving a smooth transition.
    *   `offsetX`, `offsetY` : The horizontal/vertical offset from the camera follow target.x position.
*   Stop following
    
    ```
    camera.stopFollow();
    ```
    
*   Set follow offset
    
    ```
    camera.setFollowOffset(x, y);
    ```
    
*   Set lerp
    
    ```
    camera.setLerp(x, y);
    ```
    
    *   `1` : Camera will instantly snap to the target coordinates.
    *   `0.1` : Camera will more slowly track the target, giving a smooth transition.
*   Deadzone
    
    ```
    camera.setDeadzone(width, height);
    ```
    
    If the target moves outside of this area, the camera will begin scrolling in order to follow it.
    
    *   Boundaries
        
        ```
        var left = camera.deadzone.left;
        var right = camera.deadzone.right;
        var top = camera.deadzone.top;
        var bootom = camera.deadzone.bottom;
        ```
        
    *   Clear deadzone
        
        ```
        camera.setDeadzone();
        ```
        

#### Events[​](#events "Direct link to Events")

*   Follower Update
    
    ```
    camera.on("followupdate", function (camera, gameObject) {});
    ```
    

### Bounds[​](#bounds "Direct link to Bounds")

Set the bounds of the Camera. The bounds are an axis-aligned rectangle.

The Camera bounds controls where the Camera can scroll to, stopping it from scrolling off the edges and into blank space. It does not limit the placement of Game Objects, or where the Camera viewport can be positioned.

Temporarily disable the bounds by changing the boolean `Camera.useBounds`.

Clear the bounds entirely by calling `Camera.removeBounds`.

If you set bounds that are smaller than the viewport it will stop the Camera from being able to scroll. The bounds can be positioned wherever you wish. By default they are from 0x0 to the canvas width x height. This means that the coordinate 0x0 is the top left of the Camera bounds. However, you can position them anywhere. So if you wanted a game world that was 2048x2048 in size, with 0x0 being the center of it, you can set the bounds x/y to be -1024, -1024, with a width and height of 2048. Depending on your game you may find it easier for 0x0 to be the top-left of the bounds, or you may wish 0x0 to be the middle.

#### Usage[​](#usage-8 "Direct link to Usage")

*   Get camera bounds
    
    ```
    var bounds = camera.getBounds(); // bounds: a rectangle object
    // var out = camera.getBounds(out);
    ```
    
*   Set camera bounds
    
    ```
    camera.setBounds(x, y, width, height);
    ```
    

### Zoom[​](#zoom "Direct link to Zoom")

Cameras can zoom in, or out of, a Scene.

A value of 0.5 would zoom the Camera out, to show twice as much of the Scene. A value of 2 would zoom the Camera in, so every pixel now takes up 2 pixels when rendered.

Set to 1 to return to the default zoom level.

Be careful to never set this value to zero.

#### Usage[​](#usage-9 "Direct link to Usage")

*   Get the camera zoom
    
    ```
    var zoomValue = camera.zoom;
    ```
    
*   Set the camera zoom
    
    ```
    camera.setZoom(zoomValue); // The minimum it can be is 0.001.
    camera.zoom = zoomValue;
    ```
    

## Other features[​](#other-features "Direct link to Other features")

### Get cameras below pointer[​](#get-cameras-below-pointer "Direct link to Get cameras below pointer")

Returns an array of all cameras below the given Pointer.

The first camera in the array is the top-most camera in the camera list.

*   Get all cameras below pointer

```
var cameras = this.cameras.getCamerasBelowPointer(pointer);
```

*   `cameras` : An array of cameras.
*   `pointer` : `{x, y}`

### Children[​](#children "Direct link to Children")

Takes an array of Game Objects and a Camera and returns a new array containing only those Game Objects that pass the willRender test against the given Camera.

#### Visible children[​](#visible-children "Direct link to Visible children")

*   Filter visible children
    
    ```
    var visible = this.cameras.getVisibleChildren(children, camera);
    ```
    
*   Get all visible children
    
    ```
    var visible = this.cameras.getVisibleChildren(
      scene.sys.displayList.list,
      camera
    );
    ```
    

#### Render children[​](#render-children "Direct link to Render children")

This array is populated with all of the Game Objects that this Camera has rendered in the previous (or current, depending on when you inspect it) frame.

It is cleared at the start of Camera.preUpdate, or if the Camera is destroyed.

*   Get render chilren
    
    ```
    var children = camera.renderList;
    ```
    

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
