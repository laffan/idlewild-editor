# Scale Manager

Scale game window, built-in method of phaser.

## Setup[​](#setup "Direct link to Setup")

Setup scale mode in [game configuration](/phaser/concepts/game).

```
var config = {
    // ...
    parent: divId,

    // Game size
    width: 1024,
    height: 768,

    scale: {
        // Or set parent divId here
        parent: divId,

        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,

        // Or put game size here
        // width: 1024,
        // height: 768,

        // Minimum size
        min: {
            width: 800,
            height: 600
        },
        // Or set minimum size like these
        // minWidth: 800,
        // minHeight: 600,

        // Maximum size
        max: {
            width: 1600,
            height: 1200
        },
        // Or set maximum size like these
        // maxWidth: 1600,
        // maxHeight: 1200,

        zoom: 1,  // Size of game canvas = game size * zoom
    },
    autoRound: false
    // ...
};
var game = new Phaser.Game(config);
```

*   `scale.mode` :
    *   `Phaser.Scale.NONE` : No scaling happens at all.
    *   `Phaser.Scale.FIT` : The width and height are automatically adjusted to fit inside the given target area, while keeping the aspect ratio. Depending on the aspect ratio there may be some space inside the area which is not covered.
    *   `Phaser.Scale.ENVELOP` : The width and height are automatically adjusted to make the size cover the entire target area while keeping the aspect ratio. This may extend further out than the target size.
    *   `Phaser.Scale.WIDTH_CONTROLS_HEIGHT` : The height is automatically adjusted based on the width.
    *   `Phaser.Scale.HEIGHT_CONTROLS_WIDTH` : The width is automatically adjusted based on the height.
    *   `Phaser.Scale.EXPAND` : The Canvas's visible area is resized to fit all available parent space like RESIZE mode, and scale canvas size to fit inside the visible area like FIT mode.
    *   `Phaser.Scale.RESIZE` : The Canvas is resized to fit all available _parent_ space, regardless of aspect ratio.
*   `scale.autoCenter` :
    *   `Phaser.Scale.NO_CENTER` : The game canvas is not centered within the parent by Phaser.
    *   `Phaser.Scale.CENTER_BOTH` : The game canvas is centered both horizontally and vertically within the parent.
    *   `Phaser.Scale.CENTER_HORIZONTALLY` : The game canvas is centered horizontally within the parent.
    *   `Phaser.Scale.CENTER_VERTICALLY` : The game canvas is centered both vertically within the parent.

## Resize canvas element[​](#resize-canvas-element "Direct link to Resize canvas element")

```
scene.scale.resize(width, height);
```

Modify the size of the Phaser canvas element directly. You should only use this if you are using the `NO_SCALE` scale mode,

## Set game size[​](#set-game-size "Direct link to Set game size")

```
scene.scale.setGameSize(width, height);
```

It should only be used if you're looking to change the base size of your game and are using one of the Scale Manager scaling modes, i.e. `FIT`. If you're using `NO_SCALE` and wish to change the game and canvas size directly, then please use the `resize` method instead.

## Get view port[​](#get-view-port "Direct link to Get view port")

```
var viewport = scene.scale.getViewPort();
// var viewport = scene.scale.getViewPort(camera, out);
```

*   `viewport` : The [Rectangle](/phaser/concepts/geometry#rectangle) of visible area.
*   `camera` : The [camera](/phaser/concepts/cameras) this viewport is respond upon.
*   `out` : The [Rectangle](/phaser/concepts/geometry#rectangle) of visible area.

## Members[​](#members "Direct link to Members")

*   The un-modified game size, as requested in the game config (the raw width / height), as used for world bounds, cameras, etc
    
    ```
    var gameSize = scene.scale.gameSize;
    ```
    
    *   `gameSize.width`, `gameSize.height`
*   The modified game size, which is the auto-rounded gameSize, used to set the canvas width and height (but not the CSS style)
    
    ```
    var baseSize = scene.scale.baseSize;
    ```
    
    *   `baseSize.width`, `baseSize.height`
*   The size used for the canvas style, factoring in the scale mode, parent and other values.
    
    ```
    var displaySize = scene.scale.displaySize;
    ```
    
    *   `displaySize.width`, `displaySize.height`
*   The size of parent dom element
    
    ```
    var parentSize = scene.scale.parentSize;
    ```
    
    *   `parentSize.width`, `parentSize.height`

## Events[​](#events "Direct link to Events")

```
scene.scale.on('resize', function(gameSize, baseSize, displaySize, previousWidth, previousHeight) {});
```

*   `gameSize` : The un-modified game size, as requested in the game config (the raw width / height)
    *   `gameSize.width`, `gameSize.height`
*   `baseSize` : The canvas width and height (actually size of canvas)
    *   `baseSize.width`, `baseSize.height`
*   `displaySize` : Size used for the canvas style (display size of canvas)
    *   `displaySize.width`, `displaySize.height`

## Update bounds[​](#update-bounds "Direct link to Update bounds")

This method dose not have to be invoked, unless the canvas position, or visibility is changed via any other method (i.e. via an Angular route).

```
scene.scale.updateBounds();
```

## Full screen[​](#full-screen "Direct link to Full screen")

Under `'pointerup'` touch event :

*   Start full screen
    
    ```
    scene.scale.startFullscreen();
    ```
    
*   Stop full screen
    
    ```
    scene.scale.stopFullscreen();
    ```
    
*   Toggle full screen
    
    ```
    scene.scale.toggleFullscreen();
    ```
    
*   Is full screen
    
    ```
    var isFullscreen = scene.scale.isFullscreen;
    ```
    

Games within an iframe will also be blocked from fullscreen unless the iframe has the `allowfullscreen` attribute.

Performing an action that navigates to another page, or opens another tab, will automatically cancel fullscreen mode, as will the user pressing the ESC key.

### Events[​](#events-1 "Direct link to Events")

*   Enter full screen
    
    ```
    scene.scale.on('enterfullscreen', function() {}, scope);
    ```
    
*   Enter full screen failed
    
    ```
    scene.scale.on('fullscreenfailed', function(error) {}, scope);
    ```
    
*   Leave full screen
    
    ```
    scene.scale.on('leavefullscreen', function() {}, scope);
    ```
    
*   Full screen unsupport
    
    ```
    scene.scale.on('fullscreenunsupported', function() {}, scope);
    ```
    
*   Leave full screen
    
    ```
    scene.scale.on('leavefullscreen', function() {}, scope);
    ```
    

## Orientation[​](#orientation "Direct link to Orientation")

### Properties[​](#properties "Direct link to Properties")

*   Is portrait orientation
    
    ```
    var isPortrait = scene.scale.isPortrait;
    ```
    
*   Is landscape orientation
    
    ```
    var isLandscape = scene.scale.isLandscape;
    ```
    

### Lock orientation[​](#lock-orientation "Direct link to Lock orientation")

```
scene.scale.lockOrientation(orientation);
```

*   `orientation` : `'landscape'`, or `'portrait'`;

### Events[​](#events-2 "Direct link to Events")

```
scene.scale.on('orientationchange', function(orientation) {
    if (orientation === Phaser.Scale.PORTRAIT) {

    } else if (orientation === Phaser.Scale.LANDSCAPE) {

    }
}, scope);
```

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
