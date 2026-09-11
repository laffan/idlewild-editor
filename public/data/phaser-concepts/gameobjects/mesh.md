# Mesh

The Mesh Game Object allows you to render a group of textured vertices and manipulate the view of those vertices, such as rotation, translation or scaling.

Support for generating mesh data from grids, model data or Wavefront OBJ Files is included.

Although you can use this to render 3D objects, its primary use is for displaying more complex Sprites, or Sprites where you need fine-grained control over the vertex positions in order to achieve special effects in your games. Note that rendering still takes place using Phaser's orthographic camera (after being transformed via `projectionMesh`, see `setPerspective`, `setOrtho`, and `panZ` methods). As a result, all depth and face tests are done in an eventually orthographic space.

The rendering process will iterate through the faces of this Mesh and render out each face that is considered as being in view of the camera. No depth buffer is used, and because of this, you should be careful not to use model data with too many vertices, or overlapping geometry, or you'll probably encounter z-depth fighting. The Mesh was designed to allow for more advanced 2D layouts, rather than displaying 3D objects, even though it can do this to a degree.

In short, if you want to remake Crysis, use a 3D engine, not a Mesh. However, if you want to easily add some small fun 3D elements into your game, or create some special effects involving vertex warping, this is the right object for you. Mesh data becomes part of the WebGL batch, just like standard Sprites, so doesn't introduce any additional shader overhead. Because the Mesh just generates vertices into the WebGL batch, like any other Sprite, you can use all of the common Game Object components on a Mesh too, such as a custom pipeline, mask, blend mode or texture.

Note that the Mesh object is WebGL only and does not have a Canvas counterpart.

The Mesh origin is always 0.5 x 0.5 and cannot be changed.

## Basic usage[​](#basic-usage "Direct link to Basic usage")

1.  Load texture
    
    ```
    this.load.image(key, url);
    ```
    
2.  Add mesh object
    
    ```
    var mesh = this.add.mesh(x, y, texture, frame);
    ```
    
    or
    
    ```
    var mesh = this.make.mesh({
      x: 0,
      y: 0,
      add: true,
    
      key: null,
      frame: null,
    });
    ```
    
3.  Set perspective or orthographic projection
    
    *   Perspective projection
        
        ```
        mesh.setPerspective(width, height, fov);
        // mesh.setPerspective(width, height, fov, near, far);
        ```
        
        *   `width`, `height` : The width/height of the projection matrix. Typically the same as the Mesh and/or Renderer.
        *   `fov` : The field of view, in degrees.
        *   `near`, `far` : The near/far value of the view. Default value are `0.01`/`1000`.
    *   Orthographic projection
        
        ```
        mesh.setOrtho(mesh.width / mesh.height, 1);
        // mesh.setOrtho(scaleX, scaleY, near, far);
        ```
        
        *   `scaleX`, `scaleY` : The default horizontal/vertical scale in relation to the Mesh / Renderer dimensions.
        *   `near`, `far` : The near/far value of the view. Default value are `0.01`/`1000`.
4.  Creates a grid of vertices
    
    ```
    Phaser.Geom.Mesh.GenerateGridVerts({
      mesh: mesh,
      texture: textureKey,
      frame: frameName,
      width: 1,
      height: 1,
      widthSegments: 1,
      heightSegments: 1,
    
      // x: 0,
      // y: 0,
      // colors: 0xffffff,
      // alphas: 1,
      // tile: false,
      // isOrtho: false
    });
    ```
    
    *   `mesh` : The vertices of the generated grid will be added to this Mesh Game Object.
        
    *   `texture` : The texture to be used for this Grid.
        
    *   `frame` : The name or index of the frame within the Texture.
        
    *   `width` , `height` : The width/height of the grid in 3D units.
        
        ```
        {
            // ...
            width: (frameWidth/frameHeight),
            height: (frameHeight/frameHeight)
            // ...
        }
        ```
        
    *   `widthSegments`, `heightSegments` : The number of segments to split the grid horizontally/vertically in to.
        
    *   `colors` : An array of colors, one per vertex, or a single color value applied to all vertices.
        
    *   `alphas` An array of alpha values, one per vertex, or a single alpha value applied to all vertices.
        
    *   `tile` :
        
        *   `false` : Display as a single texture. Default value.
        *   `true` : Texture tile (repeat) across the grid segments.

## Model[​](#model "Direct link to Model")

1.  Load 3D model from OBJ file
    
    ```
    this.load.obj(key, url, objURL, matURL);
    ```
    
    *   `objURL` : URL to load the obj file.
    *   `matURL` : URL to load the material file.
2.  Add mesh object
    
    ```
    var mesh = this.add.mesh(x, y);
    ```
    
    or
    
    ```
    var mesh = this.make.mesh({
      x: 0,
      y: 0,
      add: true,
    });
    ```
    
3.  Add model
    
    ```
    mesh.addVerticesFromObj(
      key,
      scale,
      x,
      y,
      z,
      rotateX,
      rotateY,
      rotateZ,
      zIsUp
    );
    ```
    
    *   `key` : The key of the model data in the OBJ Cache to add to this Mesh.
    *   `scale` : An amount to scale the model data by. Default is `1`.
    *   `x`, `y`, `z` : Translate the model x/y/z position by this amount.
    *   `rotateX`, `rotateY`, `rotateZ` : Rotate the model on the x/y/z axis by this amount, in radians.
    *   `zIsUp` :
        *   `true` : Z axis is up.
        *   `false` : Y axis is up.

## Plane[​](#plane "Direct link to Plane")

The Plane Game Object takes the Mesh Game Object and extends it, allowing for fast and easy creation of Planes. A Plane is a one-sided grid of cells, where you specify the number of cells in each dimension. The Plane can have a texture that is either repeated (tiled) across each cell, or applied to the full Plane.

The Plane can then be manipulated in 3D space, with rotation across all 3 axis.

This allows you to create effects not possible with regular Sprites, such as perspective distortion. You can also adjust the vertices on a per-vertex basis. Plane data becomes part of the WebGL batch, just like standard Sprites, so doesn't introduce any additional shader overhead. Because the Plane just generates vertices into the WebGL batch, like any other Sprite, you can use all of the common Game Object components on a Plane too, such as a custom pipeline, mask, blend mode or texture.

### Add plane object[​](#add-plane-object "Direct link to Add plane object")

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
  key: "",
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

  add: true,
});
```

### Custom class[​](#custom-class "Direct link to Custom class")

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
    

### Animation[​](#animation "Direct link to Animation")

Animations in Phaser can either belong to the global Animation Manager, or specifically to this Plane.

#### Play animation[​](#play-animation "Direct link to Play animation")

*   Play the given animation on this Plane.
    
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
                timeScale;
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

#### Stop[​](#stop "Direct link to Stop")

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
    

#### Properties[​](#properties "Direct link to Properties")

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
    

### Interactive[​](#interactive "Direct link to Interactive")

To test if pointer is on any face of this mesh game object.

```
plane.setInteractive();
```

### Checkerboard[​](#checkerboard "Direct link to Checkerboard")

Creates a checkerboard style texture, based on the given colors and alpha values and applies it to this Plane, replacing any current texture it may have.

*   Create
    
    ```
    plane.createCheckerboard(color1, color2, alpha1, alpha2, height);
    ```
    
*   Remove
    
    ```
    plane.removeCheckerboard();
    ```
    

### Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = plane.createBitmapMask();
```

## Custom mesh class[​](#custom-mesh-class "Direct link to Custom mesh class")

*   Define class
    
    ```
    class MyMesh extends Phaser.GameObjects.mesh {
      constructor(
        scene,
        x,
        y,
        texture,
        frame,
        vertices,
        uvs,
        indicies,
        containsZ,
        normals,
        colors,
        alphas
      ) {
        super(
          scene,
          x,
          y,
          texture,
          frame,
          vertices,
          uvs,
          indicies,
          containsZ,
          normals,
          colors,
          alphas
        );
        // ...
        this.add.existing(this);
      }
      // ...
    
      // preUpdate(time, delta) {
      //     super.preUpdate(time, delta);
      // }
    }
    ```
    
    *   `this.add.existing(gameObject)` : Adds an existing Game Object to this Scene.
        *   If the Game Object renders, it will be added to the Display List.
        *   If it has a `preUpdate` method, it will be added to the Update List.
*   Create instance
    
    ```
    var mesh = new MyMesh(scene, x, y, texture, frame);
    ```
    

## Control[​](#control "Direct link to Control")

### View[​](#view "Direct link to View")

*   Translates the view position of this Mesh on the x/y/z axis by the given amount.
    
    ```
    mesh.panX(x);
    mesh.panY(y);
    mesh.panZ(z);
    ```
    

### Model[​](#model-1 "Direct link to Model")

*   Position
    
    ```
    mesh.modelPosition.x = x;
    mesh.modelPosition.y = y;
    mesh.modelPosition.z = z;
    ```
    
    *   `x`, `y`, `z` : Offset position.
        *   `z+` : Near
        *   `z-` : Far
        *   `x-` : Left
        *   `x+` : Right
        *   `y+` : Up
        *   `y-` : Down
*   Rotation
    
    ```
    mesh.modelRotation.x = radiansX;
    mesh.modelRotation.y = radiansY;
    mesh.modelRotation.z = radiansZ;
    ```
    
    or
    
    ```
    mesh.rotateX = degreesX;
    mesh.rotateY = degreesY;
    mesh.rotateZ = degreesZ;
    ```
    
    *   `radiansX`, `radiansY`, `radiansZ` : Rotation angle in radians.
    *   `degreesX`, `degreesY`, `degreesZ` : Rotation angle in degrees.
*   Scale
    
    ```
    mesh.modelScale.x = scaleX;
    mesh.modelScale.y = scaleY;
    mesh.modelScale.z = scaleZ;
    ```
    
    *   `scaleX`, `scaleY`, `scaleZ` : Scale value, `1` is origin size.

## Backward facing Faces[​](#backward-facing-faces "Direct link to Backward facing Faces")

*   Hide backward facing Faces. Default behavior.
    
    ```
    mesh.hideCCW = true;
    ```
    
*   Show backward facing Faces
    
    ```
    mesh.hideCCW = false;
    ```
    

## Faces[​](#faces "Direct link to Faces")

Meshes are composed of triangle faces.

```
var faces = mesh.faces;
```

### Contains[​](#contains "Direct link to Contains")

*   Has any face which contains point
    
    ```
    var isHit = mesh.hasFaceAt(worldX, worldY);
    // var isHit = mesh.hasFaceAt(worldX, worldY, camera);
    ```
    
*   Get face contains point
    
    ```
    var face = mesh.getFaceAt(worldX, worldY);
    // var face = mesh.getFaceAt(worldX, worldY, camera);
    ```
    

### Properties[​](#properties-1 "Direct link to Properties")

*   Alpha
    
    *   Get
        
        ```
        var alpha = face.alpha;
        ```
        
    *   Set
        
        ```
        face.alpha = alpha;
        ```
        
*   Angle
    
    *   Rotate
        
        ```
        Phaser.Geom.Mesh.RotateFace(face, radians);
        ```
        
*   Center position
    
    *   Get
        
        ```
        var x = face.x;
        var y = face.y;
        ```
        
        *   `x` : 0(left) ~ 1(right)
        *   `y` : 1(top) ~ 0(bottom)
    *   Set
        
        ```
        face.x = x;
        face.y = y;
        ```
        
        or
        
        ```
        face.translate(x, y);
        ```
        
        *   `x` : 0(left) ~ 1(right)
        *   `y` : 1(top) ~ 0(bottom)

## Vertices[​](#vertices "Direct link to Vertices")

Each face has 3 vertices.

```
var vertices = mesh.vertices;
```

*   `vertices` : Array of vertex.

### Properties[​](#properties-2 "Direct link to Properties")

*   Alpha
    
    *   Get
        
        ```
        var alpha = vertex.alpha;
        ```
        
    *   Set
        
        ```
        vertex.alpha = alpha;
        ```
        
*   Tint
    
    *   Get
        
        ```
        var color = vertex.color;
        ```
        
    *   Set
        
        ```
        vertex.color = color;
        ```
        

#### Update properties[​](#update-properties "Direct link to Update properties")

*   Start updating
    
    ```
    mesh.ignoreDirtyCache = true;
    ```
    
*   Stop updating
    
    ```
    mesh.ignoreDirtyCache = false;
    ```
    

## Interactive[​](#interactive-1 "Direct link to Interactive")

To test if pointer is at any face of this mesh game object.

```
mesh.setInteractive();
```

## Debug[​](#debug "Direct link to Debug")

1.  Set debug [Graphics](/phaser/concepts/gameobjects/graphics)
    
    ```
    var debugGraphics = this.add.graphics();
    mesh.setDebug(debugGraphics);
    ```
    
2.  Update [Graphics](/phaser/concepts/gameobjects/graphics) in `this.update()` method.
    
    ```
    debugGraphics.clear();
    debugGraphics.lineStyle(1, 0x00ff00);
    ```
    

## Create mask[​](#create-mask-1 "Direct link to Create mask")

```
var mask = mesh.createBitmapMask();
```

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
