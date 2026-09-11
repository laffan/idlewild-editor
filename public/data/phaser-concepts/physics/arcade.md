# Arcade Physics

Arcade Physics is, as its name implies, meant for more 'arcade' or 'retro' style games, although is not limited just to those. It's a lightweight physics system that can only handle two different types of physics shapes: rectangles and circles. It's not meant for complex physics simulations, but rather for simple things like platformers, top-down games, or puzzle games. It's very fast and easy to use, with lots of helper functions, but due to its nature it does have its limitations.

Arcade Physics must be enabled before it can be used. This can be done via the Game Configuration or on a per-Scene basis. Once enabled, you can then add physics-enabled Game Objects to your game. This will allow you to control the Sprite using the built-in physics functions, such as velocity, acceleration, gravity, etc.

By default a Game Object is not enabled for physics. This is because not all Game Objects need to be. For example, a background image or game logo likely doesn't need to be affected by physics, but a player character does. Therefore, you must enable physics on the Game Objects that you specifically want to be affected by it. We will cover this in detail in later chapters.

Arcade Physics and Matter Physics are two separate systems. An Arcade Physics sprite, for example, cannot collide with a Matter Physics sprite. You cannot add the same Sprite to both systems, you need to pick one or the other. However, although it's unusual to do so, both systems can actually run in parallel in the same Scene. This means that you can have a Sprite that uses Arcade Physics and another that uses Matter Physics, and they will both work at the same time, although they will not interact together.

## Arcade World[​](#arcade-world "Direct link to Arcade World")

The Arcade Physics World is the environment where all physics-based interactions occur within the Arcade Physics system. It manages the simulation of object movement, collisions, and responses to various forces. The Arcade Physics World tracks all the objects within it (referred to as "bodies"), handles their physical interactions, and updates their positions and velocities over time.

### Configuration[​](#configuration "Direct link to Configuration")

The Arcade Physics `config` object defines the behavior of the Arcade Physics system globally.

*   Basic configuration object

```
const config = {
    // ...
    physics: {
        default: 'arcade'
    },
    // ...
};

const game = new Phaser.Game(config);
```

*   Full configuration

```
const config = {
  // ...
  physics: {
    default: "arcade",
    arcade: {
      //    x: 0,
      //    y: 0,
      //    width: scene.sys.scale.width,
      //    height: scene.sys.scale.height,
      //    gravity: {
      //        x: 0,
      //        y: 0
      //    },
      //    checkCollision: {
      //        up: true,
      //        down: true,
      //        left: true,
      //        right: true
      //    },
      //    customUpdate: false,
      //    fixedStep: true,
      //    fps: 60,
      //    timeScale: 1,     // 2.0 = half speed, 0.5 = double speed
      //    customUpdate: false,
      //    overlapBias: 4,
      //    tileBias: 16,
      //    forceX: false,
      //    isPaused: false,
      //    debug: false,
      //    debugShowBody: true,
      //    debugShowStaticBody: true,
      //    debugShowVelocity: true,
      //    debugBodyColor: 0xff00ff,
      //    debugStaticBodyColor: 0x0000ff,
      //    debugVelocityColor: 0x00ff00,
      //    maxEntries: 16,
      //    useTree: true   // set false if amount of dynamic bodies > 5000
    },
  },
  // ...
};
const game = new Phaser.Game(config);
```

### Update[​](#update "Direct link to Update")

*   Default updating : World updating every tick
    
*   Custom updating :
    
    1.  Set `customUpdate` of arcade config to `false`.
        
        *   Enable world updating : `this.physics.enableUpdate()`
        *   Disable world updating : `this.physics.disableUpdate()`
    2.  Run world updating manually
        
        ```
        this.physics.world.update(time, delta);
        ```
        
    3.  Enable/disable world updating
        
        *   Enable : `this.physics.enableUpdate()`
        *   Disable : `this.physics.disableUpdate()`

#### Step[​](#step "Direct link to Step")

*   Advances the simulation by a single step.
    
    ```
    this.physics.world.singleStep();
    ```
    
*   Advances the simulation by a time increment.
    
    ```
    this.physics.world.step(delta);
    ```
    

### Control[​](#control "Direct link to Control")

#### Pause[​](#pause "Direct link to Pause")

```
this.physics.pause();
```

#### Resume[​](#resume "Direct link to Resume")

```
this.physics.resume();
```

#### Duration per frame[​](#duration-per-frame "Direct link to Duration per frame")

*   Time scale
    
    ```
    this.physics.world.timeScale = timeScale;
    ```
    
    *   1.0 = normal speed
    *   2.0 = half speed
    *   0.5 = double speed
*   Frames per second (FPS)
    
    ```
    this.physics.world.setFPS(framerate);
    ```
    

#### Tile filter options[​](#tile-filter-options "Direct link to Tile filter options")

```
var option = this.physics.world.tileFilterOptions;
```

*   `option`
    
    ```
    {
        isColliding: true,
        isNotEmpty: true,
        hasInterestingFace: true
    }
    ```
    

### Body[​](#body "Direct link to Body")

#### Enable[​](#enable "Direct link to Enable")

```
this.physics.world.enable(gameObject);
// this.physics.world.enable(gameObject, bodyType);
```

*   `gameObject` : A game object, or array of game objects, or game objects in a `Group`.
*   `bodyType` :
    *   `0` : Dynamic body. Default value.
    *   `1` : Static body.

Or

```
this.physics.add.existing(gameObject, bodyType);
```

See [arcade-body](#get-physics-body)

#### Disable[​](#disable "Direct link to Disable")

```
this.physics.world.disable(gameObject);
```

*   `gameObject` : A game object, or array of game objects, or game objects in a `Group`.

#### Add/remove body[​](#addremove-body "Direct link to Add/remove body")

*   Add body to the local search trees.
    
    ```
    this.physics.world.add(body);
    ```
    
*   Remove body from the local search trees.
    
    ```
    this.physics.world.disableBody(body);
    ```
    

### Collision[​](#collision "Direct link to Collision")

#### Set bound[​](#set-bound "Direct link to Set bound")

See bound in [body object](#body-collision-bounds), or [game object](#game-object-collision-bounds).

#### Collider & callback[​](#collider--callback "Direct link to Collider & callback")

*   Add collider
    
    *   Push out
        
        ```
        this.physics.add.collider(objectsA, objectsB);
        ```
        
    *   Performs a collision check and separation between the two physics enabled objects given.
        
        ```
        var collider = this.physics.add.collider(
          objectsA,
          objectsB,
          collideCallback
        );
        // var collider = this.physics.add.collider(objectsA, objectsB, collideCallback, processCallback, callbackContext);
        ```
        
    *   If you don't require separation then use `overlap` instead.
        
        ```
        var collider = this.physics.add.overlap(
          objectsA,
          objectsB,
          collideCallback
        );
        // var collider = this.physics.add.overlap(objectsA, objectsB, collideCallback, processCallback, callbackContext);
        ```
        
    *   Parameters
        
        *   `objectsA`, `objectsB` :
            
            *   A game object
            *   An array contains Game objects (Add or remove game objects)
            *   Physics group/Group (Add or remove game objects)
            *   An array contains Physics group/Group
        *   `collideCallback` :
            
            ```
            var collideCallback = function (gameObject1, gameObject2) {
              // ...
            };
            ```
            
        *   `processCallback` : Fired when gameObject1 intersects gameObject2, optional.
            
            ```
            var processCallback = function (gameObject1, gameObject2) {
              return true; // return false will discard remaining collision checking
            };
            ```
            
*   Remove collider
    
    ```
    this.physics.world.removeCollider(collider);
    ```
    
*   Deactivate collider
    
    ```
    collider.active = false; // Set true to activate again
    ```
    
*   Name of collider (unused by engine)
    
    ```
    collider.name = name;
    ```
    

#### Testing without colliders[​](#testing-without-colliders "Direct link to Testing without colliders")

*   Test overlapping
    
    ```
    var isOverlapping = this.physics.world.overlap(object1, object2);
    ```
    
    or
    
    ```
    var isOverlapping = this.physics.world.overlap(
      object1,
      object2,
      collideCallback
    );
    // var isOverlapping = this.physics.world.overlap(object1, object2, collideCallback, processCallback, callbackContext);
    ```
    
*   Test colliding, also push out
    
    ```
    var isCollided = this.physics.world.collide(object1, object2);
    ```
    
    or
    
    ```
    var isCollided = this.physics.world.collide(
      object1,
      object2,
      collideCallback
    );
    // var isCollided = this.physics.world.collide(object1, object2, collideCallback, processCallback, callbackContext);
    ```
    
*   A body overlaps with a Tile and has its `onOverlap` property set to `true`.
    
    ```
    this.physics.world.on("tileoverlap", function (gameObject, tile, body) {
      /* ... */
    });
    ```
    
*   A body overlaps with a Tile and has its `onCollide` property set to `true`.
    
    ```
    this.physics.world.on("tilecollide", function (gameObject, tile, body) {
      /* ... */
    });
    ```
    

### Arcade world bounds[​](#arcade-world-bounds "Direct link to Arcade world bounds")

#### Enable[​](#enable-1 "Direct link to Enable")

*   [Body](#arcade-body) : Set `body.setCollideWorldBounds()` to enable worldBounds property.
    
*   World :
    
    *   Set bounds [rectangle](/phaser/concepts/geometry#rectangle) and enable bounds
        
        ```
        this.physics.world.setBounds(x, y, width, height);
        // this.physics.world.setBounds(x, y, width, height, checkLeft, checkRight, checkUp, checkDown);
        ```
        
    *   Set bounds [rectangle](/phaser/concepts/geometry#rectangle)
        
        ```
        this.physics.world.bounds.setTo(x, y, width, height);
        ```
        
        or
        
        ```
        this.physics.world.bounds.x = x;
        this.physics.world.bounds.y = y;
        this.physics.world.bounds.width = width;
        this.physics.world.bounds.height = height;
        ```
        
    *   Enable bounds
        
        ```
        this.physics.world.setBoundsCollision();
        // this.physics.world.setBoundsCollision(left, right, up, down);
        ```
        
        or
        
        ```
        this.physics.world.checkCollision.left = left;
        this.physics.world.checkCollision.right = right;
        this.physics.world.checkCollision.up = up;
        this.physics.world.checkCollision.down = down;
        ```
        
    *   Get bounds [rectangle](/phaser/concepts/geometry#rectangle)
        
        ```
        var top = this.physics.world.bounds.top;
        var bottom = this.physics.world.bounds.bottom;
        var left = this.physics.world.bounds.left;
        var right = this.physics.world.bounds.right;
        ```
        

### Bodies inside an area[​](#bodies-inside-an-area "Direct link to Bodies inside an area")

*   Overlap a rectangle area
    
    ```
    var bodies = this.physics.overlapRect(
      x,
      y,
      width,
      height,
      includeDynamic,
      includeStatic
    );
    ```
    
    *   `includeDynamic` : Set `true` to search Dynamic Bodies
    *   `includeStatic` : Set `true` to search Static Bodies
*   Overlap a circle area
    
    ```
    var bodies = this.physics.overlapCirc(
      x,
      y,
      radius,
      includeDynamic,
      includeStatic
    );
    ```
    
    *   `includeDynamic` : Set `true` to search Dynamic Bodies
    *   `includeStatic` : Set `true` to search Static Bodies

### Wrap[​](#wrap "Direct link to Wrap")

```
this.physics.world.wrap(gameObject, padding);
```

*   gameObject:
    *   game object
    *   group
    *   array of game objects

### Move to[​](#move-to "Direct link to Move to")

*   Move to position with a steady velocity
    
    ```
    this.physics.moveTo(gameObject, x, y, speed, maxTime);
    ```
    
*   Move to object with a steady velocity
    
    ```
    this.physics.moveToObject(gameObject, destination, speed, maxTime);
    ```
    

### Accelerate to[​](#accelerate-to "Direct link to Accelerate to")

*   Accelerate to position
    
    ```
    this.physics.accelerateTo(
      gameObject,
      x,
      y,
      acceleration,
      xSpeedMax,
      ySpeedMax
    );
    ```
    
*   Accelerate to object
    
    ```
    this.physics.accelerateToObject(
      gameObject,
      destination,
      acceleration,
      xSpeedMax,
      ySpeedMax
    );
    ```
    

### Gravity[​](#gravity "Direct link to Gravity")

*   Set
    
    ```
    this.physics.world.gravity.x = gx;
    this.physics.world.gravity.y = gy;
    ```
    
*   Get
    
    ```
    var gx = this.physics.world.gravity.x;
    var gy = this.physics.world.gravity.y;
    ```
    

Total Gravity = world.gravity + body.gravity

### Bodies[​](#bodies "Direct link to Bodies")

#### Closest/furthest[​](#closestfurthest "Direct link to Closest/furthest")

*   Closest
    
    ```
    var body = this.physics.closest(point); // point: {x,y}
    // var body = this.physics.closest(point, targets);
    ```
    
    *   `targets` : Array of Arcade Physics Game Object, Body or Static Body.
*   Furthest
    
    ```
    var body = this.physics.furthest(point); // point: {x,y}
    // var body = this.physics.furthest(point, targets);
    ```
    
    *   `targets` : Array of Arcade Physics Game Object, Body or Static Body.

### Debug[​](#debug "Direct link to Debug")

#### Draw body & velocity[​](#draw-body--velocity "Direct link to Draw body & velocity")

*   Bounds of dynamic Body
    
    *   Enable drawing body
        
        ```
        this.physics.world.defaults.debugShowBody = true;
        ```
        
    *   Color
        
        ```
        this.physics.world.defaults.bodyDebugColor = 0xff00ff;
        ```
        
*   Bounds of static Body
    
    *   Enable drawing body
        
        ```
        this.physics.world.defaults.debugShowStaticBody = true;
        ```
        
    *   Color
        
        ```
        this.physics.world.defaults.staticBodyDebugColor = 0x0000ff;
        ```
        
*   Direction and magnitude of velocity
    
    *   Enable drawing body
        
        ```
        this.physics.world.defaults.debugShowVelocity = true;
        ```
        
    *   Color
        
        ```
        this.physics.world.defaults.velocityDebugColor = 0x00ff00;
        ```
        

#### Graphics[​](#graphics "Direct link to Graphics")

Draw debug body & velocity on a [Graphics object](/phaser/concepts/gameobjects/graphics).

```
var graphics = this.physics.world.debugGraphic;
```

*   Set visible
    
    ```
    this.physics.world.debugGraphic.setVisible();
    ```
    
*   Set invisible
    
    ```
    this.physics.world.debugGraphic.setVisible(false);
    ```
    

### Events[​](#events "Direct link to Events")

*   World step
    
    ```
    this.physics.world.on("worldstep", function (delta) {
      /* ... */
    });
    ```
    
    *   `delta` : The delta time amount of this step, in seconds.
*   Pause world
    
    ```
    this.physics.world.on("pause", function () {
      /* ... */
    });
    ```
    
*   Resume world
    
    ```
    this.physics.world.on("resume", function () {
      /* ... */
    });
    ```
    
*   Two bodies overlap and at least one of them has their `onOverlap` property set to `true`.
    
    ```
    this.physics.world.on(
      "overlap",
      function (gameObject1, gameObject2, body1, body2) {
        /* ... */
      }
    );
    ```
    
*   Two bodies overlap and at least one of them has their `onCollide` property set to `true`.
    
    ```
    this.physics.world.on(
      "collide",
      function (gameObject1, gameObject2, body1, body2) {
        /* ... */
      }
    );
    ```
    
*   A body overlaps with a Tile and has its `onOverlap` property set to `true`.
    
    ```
    this.physics.world.on("tileoverlap", function (gameObject, tile, body) {
      /* ... */
    });
    ```
    
*   A body overlaps with a Tile and has its `onCollide` property set to `true`.
    
    ```
    this.physics.world.on("tilecollide", function (gameObject, tile, body) {
      /* ... */
    });
    ```
    
*   World bounds
    
    ```
    this.physics.world.on(
      "worldbounds",
      function (body, blockedUp, blockedDown, blockedLeft, blockedRight) {
        /* ... */
      }
    );
    ```
    

### Update loop[​](#update-loop "Direct link to Update loop")

1.  scene.sys.events: update
    1.  Update position & angle of each body
    2.  Process each collider
    3.  Update final position of each body
    4.  Emit `worldstep` event
2.  scene.sys.events: postupdate
    1.  Draw debug graphics

```
graph TB

SceneEventUpdate>"scene.sys.events: update<br><br>Update arcade world<br>gameObject.preUpdate()"]
SceneUpdate["scene.update()"]
SceneEventPostUpdate>"scene.sys.events: postupdate<br><br>Post update arcade world"]
Render

SceneEventUpdate --> SceneUpdate
SceneUpdate --> SceneEventPostUpdate
SceneEventPostUpdate --> Render
```

## Arcade Body[​](#arcade-body "Direct link to Arcade Body")

An Arcade Physics Body is associated with a game object and manages its physics properties and behaviors.

### Usage[​](#usage "Direct link to Usage")

#### Get physics body[​](#get-physics-body "Direct link to Get physics body")

1.  [Enable physics world](#configuration)
    
2.  Add existing game object(s) to physics world
    
    *   Add a game object
        
        ```
        var gameObject = this.physics.add.existing(gameObject, bodyType);
        ```
        
        *   `bodyType` :
            *   `0` : Dynamic body
            *   `1` : Static body
    *   Add game objects
        
        ```
        this.physics.world.enable(gameObjects, bodyType);
        ```
        
        *   `gameObjects` : An array of game objects, or a group object
        *   `bodyType` :
            *   `0` : Dynamic body
            *   `1` : Static body
3.  Get physics body
    
    ```
    var body = gameObject.body;
    ```
    

#### Enable and disable[​](#enable-and-disable "Direct link to Enable and disable")

Whether this Body is updated by the physics simulation.

*   Enable (default)
    
    ```
    body.setEnable();
    ```
    
    or
    
    ```
    body.enable = true;
    ```
    
*   Disable
    
    ```
    body.setEnable(false);
    ```
    
    or
    
    ```
    body.enable = false;
    ```
    

#### Direct control[​](#direct-control "Direct link to Direct control")

Enable `directControl` when game object is controlled by tween or dragging. Default behavior is disable.

*   Enable
    
    ```
    body.setDirectControl(); // default argument is true
    // body.setDirectControl(true);
    ```
    
    or
    
    ```
    body.directControl = true;
    ```
    
*   Disable
    
    ```
    body.setDirectControl(false);
    ```
    
    or
    
    ```
    body.directControl = false;
    ```
    

#### Immovable[​](#immovable "Direct link to Immovable")

Whether this Body can be moved by collisions with another Body.

*   Enable
    
    ```
    body.setImmovable();
    // body.immovable = true;
    ```
    
*   Disable (defalut)
    
    ```
    body.setImmovable(false);
    // body.immovable = false;
    ```
    
*   Get
    
    ```
    var immovable = body.immovable;
    ```
    

#### Pushable[​](#pushable "Direct link to Pushable")

Sets if this Body can be pushed by another Body.

*   Enable (default value of dynamic body)
    
    ```
    body.pushable = true;
    ```
    
*   Disable, reflect back all of the velocity it is given to the colliding body.
    
    ```
    body.pushable = false;
    ```
    
*   Get
    
    ```
    var pushable = body.pushable;
    ```
    

#### Moveable[​](#moveable "Direct link to Moveable")

Whether the Body's position and rotation are affected by its velocity, acceleration, drag, and gravity.

*   Enable (default)
    
    ```
    body.moves = true;
    ```
    
*   Disable
    
    ```
    body.moves = false;
    ```
    
*   Get
    
    ```
    var moves = body.moves;
    ```
    

#### Destroy[​](#destroy "Direct link to Destroy")

Physics body will be destroyed automatically when game object is destroyed.

#### Movement[​](#movement "Direct link to Movement")

##### Velocity[​](#velocity "Direct link to Velocity")

*   Set
    
    ```
    body.setVelocity(x, y);
    ```
    
    or
    
    ```
    body.setVelocityX(x);
    body.setVelocityY(x);
    ```
    
*   Get
    
    ```
    var vx = body.velocity.x;
    var vy = body.velocity.y;
    ```
    

##### Max speed[​](#max-speed "Direct link to Max speed")

*   Set
    
    ```
    body.setMaxSpeed(speed);
    ```
    
*   Get
    
    ```
    var speed = body.maxSpeed;
    ```
    

##### Max velocity[​](#max-velocity "Direct link to Max velocity")

*   Set
    
    ```
    body.setMaxVelocity(x, y);
    ```
    
    or
    
    ```
    body.setMaxVelocityX(x);
    body.setMaxVelocityY(y);
    ```
    
*   Get
    
    ```
    var vx = body.maxVelocity.x;
    var vy = body.maxVelocity.y;
    ```
    

##### Acceleration[​](#acceleration "Direct link to Acceleration")

*   Set
    
    ```
    body.setAcceleration(x, y);
    ```
    
    or
    
    ```
    body.setAccelerationX(x);
    body.setAccelerationY(y);
    ```
    
*   Get
    
    ```
    var ax = body.acceleration.x;
    var ay = body.acceleration.y;
    ```
    

##### Gravity[​](#gravity-1 "Direct link to Gravity")

*   Set
    
    ```
    body.setGravity(x, y);
    ```
    
    or
    
    ```
    body.setGravityX(x);
    body.setGravityY(y);
    ```
    
*   Get
    
    ```
    var gx = body.gravity.x;
    var gy = body.gravity.y;
    ```
    
*   Enables (default)
    
    ```
    body.setAllowGravity();
    ```
    
*   Disable
    
    ```
    body.setAllowGravity(false);
    ```
    

##### Drag[​](#drag "Direct link to Drag")

Reduces speed per second.

*   Set
    
    ```
    body.setDrag(x, y);
    ```
    
    or
    
    ```
    body.setDragX(x);
    body.setDragY(y);
    ```
    
*   Get
    
    ```
    var dx = body.drag.x;
    var dy = body.drag.y;
    ```
    
*   Enables (default)
    
    ```
    body.setAllowDrag();
    ```
    
*   Disable
    
    ```
    body.setAllowDrag(false);
    ```
    
*   Enable Damping (default: disable)
    
    ```
    body.setDamping(true);
    // body.useDamping = true;
    ```
    

##### Slide factor[​](#slide-factor "Direct link to Slide factor")

The Slide Factor controls how much velocity is preserved when this Body is pushed by another Body.

```
body.slideFactor.set(x, y);
```

*   `x`, `y` :
    *   `1` : Take on all velocity given in the push. Default value.
    *   `0` : Allow this Body to be pushed but then remain completely still after the push ends, such as you see in a game like _Sokoban_.
    *   Other value between `0` ~ `1` : Keep `x`/`y` of the original velocity when the push ends.
        *   Combine this with the `setDrag()` method to create deceleration.

##### Reset position[​](#reset-position "Direct link to Reset position")

```
body.reset(x, y);
```

##### Stop[​](#stop "Direct link to Stop")

Sets acceleration, velocity, and speed to zero.

```
body.stop();
```

###### Friction[​](#friction "Direct link to Friction")

If this Body is `immovable` and in motion, this the proportion of this Body's movement received by the riding body on each axis.

*   Set
    
    ```
    body.setFriction(x, y);
    ```
    
    or
    
    ```
    body.setFrictionX(x);
    body.setFrictionY(y);
    ```
    
*   Get
    
    ```
    var fx = body.friction.x;
    var fy = body.friction.y;
    ```
    

##### Speed[​](#speed "Direct link to Speed")

*   The absolute (non-negative) change in this Body's horizontal/vertical position from the previous step.
    
    ```
    var dx = body.deltaAbsX();
    var dy = body.deltaAbsY();
    ```
    

#### Rotation[​](#rotation "Direct link to Rotation")

##### Allow rotation[​](#allow-rotation "Direct link to Allow rotation")

Whether this Body's rotation is affected by its angular acceleration and velocity.

*   Enable (default)
    
    ```
    body.setAllowRotation();
    ```
    
*   Disable
    
    ```
    body.setAllowRotation(false);
    ```
    
*   Get
    
    ```
    var allowRotation = body.allowRotation;
    ```
    

##### Angular velocity[​](#angular-velocity "Direct link to Angular velocity")

*   Set
    
    ```
    body.setAngularVelocity(v);
    ```
    
*   Get
    
    ```
    var av = body.angularVelocity;
    ```
    

##### Angular acceleration[​](#angular-acceleration "Direct link to Angular acceleration")

*   Set
    
    ```
    body.setAngularAcceleration(v);
    ```
    
*   Get
    
    ```
    var aa = body.angularAcceleration;
    ```
    

##### Angular drag[​](#angular-drag "Direct link to Angular drag")

Reduces angular speed per second.

*   Set
    
    ```
    body.setAngularDrag(v);
    ```
    
*   Get
    
    ```
    var ad = body.angularDrag;
    ```
    

#### Collision[​](#collision-1 "Direct link to Collision")

##### Collision category[​](#collision-category "Direct link to Collision category")

By default all bodies collide with all other bodies. Collision categories define how different physics bodies interact with each other during collisions. It specifies which objects should collide and which should not. Collision categories are typically set using a bitmask, where each category is represented by a unique power of two. A body can collide with multiple collision categories.

*   Collision category
    *   Get
        
        ```
        var collisionCategory = body.collisionCategory;
        ```
        
    *   Set
        
        ```
        body.setCollisionCategory(category);
        ```
        
        *   `category` :
            *   `(1 << 0)`
            *   `(1 << 1)`
            *   `(1 << 2)`
            *   ...
            *   `(1 << 31)`
    *   Reset collision category, to default behavior (all bodies collide with all others)
        
        ```
        body.resetCollisionCategory();
        ```
        
        *   Set `collisionCategory` to `1`.
        *   Set `collisionMask` to `1`
*   Collision mask
    *   Get
        
        ```
        var collisionMask = body.collisionMask;
        ```
        
    *   Set
        
        ```
        body.setCollidesWith(categories);
        ```
        
        *   `categories` : A single category value, or an array of them.
    *   Add
        
        ```
        body.addCollidesWith(category):
        ```
        
        *   `category` : A single category value.
    *   Remove
        
        ```
        body.removeCollidesWith(category);
        ```
        
        *   `category` : A single category value.

##### Body collision bounds[​](#body-collision-bounds "Direct link to Body collision bounds")

Collision bounds define the area used for collision detection.

*   Rectangle
    
    ```
    body.setSize(width, height, center);
    ```
    
    *   `center` : `false` to set body's offset to (0, 0).
        *   Not work in [Graphics](/phaser/concepts/gameobjects/graphics) object.
*   Circle
    
    ```
    body.setCircle(radius, offsetX, offsetY);
    ```
    

##### Collision Offset[​](#collision-offset "Direct link to Collision Offset")

Adjusts the position of a physics body's collision bounds relative to the sprite. Used when the sprite visual does not align with the collision area.

```
body.setOffset(x, y);
```

##### Push out[​](#push-out "Direct link to Push out")

Performs a collision check and separation between two physics enabled objects.

```
this.physics.add.collider(objectsA, objectsB);
```

*   `objectsA`, `objectsB` :
    *   A game object
    *   Game objects in array (Add or remove game objects)
    *   Physics group (Add or remove game objects)
    *   Group (Add or remove game objects)

##### Callbacks[​](#callbacks "Direct link to Callbacks")

Callbacks are functions that are called when collisions or overlaps occur between two objects every step.

```
var collider = this.physics.add.collider(objectsA, objectsB, collideCallback, processCallback, callbackContext);
```

*   `collideCallback` : The callback to invoke when the two objects collide.
*   `processCallback` : The callback to invoke when the two objects collide. Must return a boolean.
*   `callbackContext` : The scope in which to call the callbacks.

##### Point inside[​](#point-inside "Direct link to Point inside")

The `hitTest` function checks if a specific point in the game world is colliding with any physics bodies. It returns `true` if a collision has occurred and `false` otherwise.

```
var hit = body.hitTest(x, y);
```

##### Is colliding[​](#is-colliding "Direct link to Is colliding")

*   Is colliding this tick and which direction
    
    ```
    var isColliding = body.touching;
    ```
    
    *   `isColliding` :
        
        ```
        {
            none: true,
            up: true,
            down: true,
            left: true,
            right: true
        }
        ```
        
*   The colliding body's touching value during the previous step.
    
    ```
    var wasColliding = body.wasTouching;
    ```
    
    *   `wasColliding` :
        
        ```
        {
            none: true,
            up: true,
            down: true,
            left: true,
            right: true
        }
        ```
        

##### Bounce[​](#bounce "Direct link to Bounce")

Defines how the body rebounds after colliding with another object. The bounce value is usually between 0 and 1. 0 stops the body from bouncing and makes it come to a stop upon collision. 1 makes the body will bounce back with the same velocity it had before the collision. A value greater than 1 makes increases the body's velocity after the collision.

*   Set
    
    ```
    body.setBounce(x, y);
    ```
    
    or
    
    ```
    body.setBounceX(x); // horizontal bounce
    body.setBounceY(y); // vertical bounce
    ```
    
*   Get
    
    ```
    var bx = body.bounce.x;
    var by = body.bounce.y;
    ```
    

##### Body world bounds[​](#body-world-bounds "Direct link to Body world bounds")

*   [Default world bounds](#arcade-world-bounds)
    
*   Custom world bounds :
    
    ```
    body.setBoundsRectangle(bounds);
    ```
    
    *   `bounds` : A [rectangle object](https://newdocs.phaser.io/docs/latest/Phaser.Geom.Rectangle).
*   Enable
    
    ```
    body.setCollideWorldBounds();
    ```
    
*   Disable (default)
    
    ```
    body.setCollideWorldBounds(false);
    ```
    
*   Get world bounds [rectangle](/phaser/concepts/geometry#rectangle)
    
    ```
    var top = body.world.bounds.top;
    var bottom = body.world.bounds.bottom;
    var left = body.world.bounds.left;
    var right = body.world.bounds.right;
    ```
    

##### Blocked[​](#blocked "Direct link to Blocked")

Check whether this Body is colliding with a tile or the world boundary.

*   Blocked when moving down
    
    ```
    var onFloor = body.onFloor();
    // var onFloor = body.blocked.down
    ```
    
*   Blocked when moving up
    
    ```
    var onCeiling = body.onCeiling();
    // var onCeiling = body.blocked.up
    ```
    
*   Blocked when moving left or right
    
    ```
    var onWall = body.onWall();
    // var onLeftWall = body.blocked.left
    // var onRightWall = body.blocked.right
    ```
    
*   State
    
    ```
    var blocked = body.blocked;
    ```
    
    *   `blocked` :
        
        ```
        {
            none: true,
            up: false,
            down: false,
            left: false,
            right: false
        }
        ```
        

#### Mass[​](#mass "Direct link to Mass")

The Body's inertia, relative to a default unit (1). With bounce, this affects the exchange of momentum (velocities) during collisions.

*   Set
    
    ```
    body.setMass(m);
    ```
    
*   Get
    
    ```
    var m = body.mass;
    ```
    

#### Static body[​](#static-body "Direct link to Static body")

A Static Arcade Physics Body never moves, and isn't automatically synchronized with its parent Game Object. Any changeg made to the parent's origin, position, or scale after creating or adding the body, requires manual update to the Static Body. A Static Body can collide with other Bodies, but is never moved by collisions.

##### Sync[​](#sync "Direct link to Sync")

Syncs the Bodies _position_ and _size_ with its parent Game Object.

```
body.updateFromGameObject();
```

#### Debug[​](#debug-1 "Direct link to Debug")

Draws a graphical representation of the StaticBody for visual debugging purposes.

*   Bounds of Body
    
    *   Enable drawing body
        
        ```
        body.debugShowBody = true;
        ```
        
    *   Color
        
        ```
        body.debugBodyColor = 0xff00ff;
        ```
        
*   Direction and magnitude of velocity
    
    *   Enable drawing body
        
        ```
        body.debugShowVelocity = true;
        ```
        

## Arcade Game Object[​](#arcade-game-object "Direct link to Arcade Game Object")

Game Objects are the building blocks of your game. Common Arcade Game Objects include: Sprites, Images, and Groups.

### Usage[​](#usage-1 "Direct link to Usage")

#### Adding Game Objects[​](#adding-game-objects "Direct link to Adding Game Objects")

##### Image object[​](#image-object "Direct link to Image object")

*   Static object, extends from [Image object](https://newdocs.phaser.io/docs/latest/Phaser.Physics.Arcade.Image)
    
    ```
    var image = this.physics.add.staticImage(x, y, key);
    ```
    
*   Dynamic object, extends from [Image object](https://newdocs.phaser.io/docs/latest/Phaser.Physics.Arcade.Image)
    
    ```
    var image = this.physics.add.image(x, y, key);
    ```
    

##### Sprite object[​](#sprite-object "Direct link to Sprite object")

*   Static object, extends from [Sprite object](https://newdocs.phaser.io/docs/latest/Phaser.Physics.Arcade.Sprite)
    
    ```
    var image = this.physics.add.staticSprite(x, y, key, frame);
    ```
    
*   Dynamic object, extends from [Sprite object](https://newdocs.phaser.io/docs/latest/Phaser.Physics.Arcade.Sprite)
    
    ```
    var image = this.physics.add.sprite(x, y, key, frame);
    ```
    

##### Group object[​](#group-object "Direct link to Group object")

*   Static sprite objects, extends from [Group object](https://newdocs.phaser.io/docs/latest/Phaser.Physics.Arcade.Group)
    
    ```
    var group = this.physics.add.staticGroup(children, config);
    // var group = this.physics.add.staticGroup(config);
    ```
    
*   Dynamic sprite objects, extends from [Group object](https://newdocs.phaser.io/docs/latest/Phaser.Physics.Arcade.Group)
    
    ```
    var group = this.physics.add.group(children, config);
    // var group = this.physics.add.staticGroup(config);
    ```
    
    *   `config`
        
        ```
        var config = {
          classType: ArcadeSprite,
          enable: true,
          collideWorldBounds: false,
          customBoundsRectangle: null,
          accelerationX: 0,
          accelerationY: 0,
          allowDrag: true,
          allowGravity: true,
          allowRotation: true,
          useDamping: false,
          bounceX: 0,
          bounceY: 0,
          dragX: 0,
          dragY: 0,
          gravityX: 0,
          gravityY: 0,
          frictionX: 0,
          frictionY: 0,
          maxSpeed: -1,
          velocityX: 0,
          velocityY: 0,
          maxVelocityX: 10000,
          maxVelocityY: 10000,
          angularVelocity: 0,
          angularAcceleration: 0,
          angularDrag: 0,
          mass: 0,
          immovable: false,
        
          maxSize: -1,
          runChildUpdate: false,
        };
        ```
        

##### Enable body[​](#enable-body "Direct link to Enable body")

*   Enable body
    
    ```
    gameObject.enableBody();
    // gameObject.enableBody(false, 0, 0, enableGameObject, showGameObject);
    ```
    
    *   Enable and reset position
        
        ```
        gameObject.enableBody(true, x, y);
        // gameObject.enableBody(true, x, y, enableGameObject, showGameObject);
        ```
        
    *   `enableGameObject` : Also activate this Game Object.
        
    *   `showGameObject` : Also show this Game Object.
        
*   Disable body
    
    ```
    gameObject.disableBody();
    // gameObject.disableBody(disableGameObject, hideGameObject);
    ```
    
    *   `disableGameObject` : Also deactivate this Game Object.
    *   `hideGameObject` : Also hide this Game Object.

#### Movement[​](#movement-1 "Direct link to Movement")

##### Velocity[​](#velocity-1 "Direct link to Velocity")

*   Set
    
    ```
    gameObject.setVelocity(x, y);
    ```
    
    or
    
    ```
    gameObject.setVelocityX(x);
    gameObject.setVelocityY(y);
    ```
    
*   Get
    
    ```
    var vx = gameObject.body.velocity.x;
    var vy = gameObject.body.velocity.y;
    ```
    

###### Max velocity[​](#max-velocity-1 "Direct link to Max velocity")

*   Set
    
    ```
    gameObject.setMaxVelocity(x, y);
    ```
    
*   Get
    
    ```
    var vx = gameObject.body.maxVelocity.x;
    var vy = gameObject.body.maxVelocity.y;
    ```
    

##### Acceleration[​](#acceleration-1 "Direct link to Acceleration")

*   Set
    
    ```
    gameObject.setAcceleration(x, y);
    ```
    
    or
    
    ```
    gameObject.setAccelerationX(x);
    gameObject.setAccelerationY(y);
    ```
    
*   Get
    
    ```
    var ax = gameObject.body.acceleration.x;
    var ay = gameObject.body.acceleration.y;
    ```
    

###### Gravity[​](#gravity-2 "Direct link to Gravity")

*   Set
    
    ```
    gameObject.setGravity(x, y);
    ```
    
    or
    
    ```
    gameObject.setGravityX(x);
    gameObject.setGravityY(y);
    ```
    
*   Get
    
    ```
    var gx = gameObject.body.gravity.x;
    var gy = gameObject.body.gravity.y;
    ```
    

##### Drag[​](#drag-1 "Direct link to Drag")

*   Set
    
    ```
    gameObject.setDrag(x, y);
    ```
    
    or
    
    ```
    gameObject.setDragX(x);
    gameObject.setDragY(y);
    ```
    
*   Get
    
    ```
    var dx = gameObject.body.drag.x;
    var dy = gameObject.body.drag.y;
    ```
    
*   Enable damping
    
    ```
    gameObject.setDamping(value);
    ```
    

##### Immovable[​](#immovable-1 "Direct link to Immovable")

*   Enable
    
    ```
    gameObject.setImmovable();
    ```
    
*   Disable
    
    ```
    gameObject.setImmovable(false);
    ```
    
*   Get
    
    ```
    var immovable = gameObject.body.immovable;
    ```
    

##### Pushable[​](#pushable-1 "Direct link to Pushable")

*   Enable
    
    ```
    gameObject.setPushable();
    ```
    
*   Disable
    
    ```
    gameObject.setPushable(false);
    ```
    
*   Get
    
    ```
    var pushable = gameObject.body.pushable;
    ```
    

###### Slide factor[​](#slide-factor-1 "Direct link to Slide factor")

The Slide Factor controls how much velocity is preserved when this Body is pushed by another Body.

```
gameObject.setSlideFactor(x, y);
```

*   `x`, `y` :
    *   `1` : Take on all velocity given in the push. Default value.
    *   `0` : Allow this Body to be pushed but then remain completely still after the push ends, such as you see in a game like _Sokoban_.
    *   Other value between `0` ~ `1` : Keep `x`/`y` of the original velocity when the push ends.
        *   Combine this with the `setDrag()` method to create deceleration.

###### Friction[​](#friction-1 "Direct link to Friction")

If this Body is `immovable` and in motion, this the proportion of this Body's movement received by the riding body on each axis.

*   Set
    
    ```
    gameObject.setFriction(x, y);
    ```
    
    or
    
    ```
    gameObject.setFrictionX(x);
    gameObject.setFrictionY(y);
    ```
    
*   Get
    
    ```
    var fx = gameObject.body.friction.x;
    var fy = gameObject.body.friction.y;
    ```
    

##### Direct control[​](#direct-control-1 "Direct link to Direct control")

Enable `directControl` when game object is controlled by tween or dragging. Default behavior is disable.

*   Enable
    
    ```
    gameObject.setDirectControl();
    // gameObject.setDirectControl(true);
    ```
    
*   Disable
    
    ```
    gameObject.setDirectControl(false);
    ```
    

!!! note "Use case" Enable `setDirectControl` when game object is controlled by tween or dragging.

#### Rotation[​](#rotation-1 "Direct link to Rotation")

##### Allow rotation[​](#allow-rotation-1 "Direct link to Allow rotation")

Whether this Body's rotation is affected by its angular acceleration and velocity.

*   Enable (default)
    
    ```
    body.setAllowRotation();
    ```
    
*   Disable
    
    ```
    body.setAllowRotation(false);
    ```
    
*   Get
    
    ```
    var allowRotation = gameObject.body.allowRotation;
    ```
    

##### Angular velocity[​](#angular-velocity-1 "Direct link to Angular velocity")

*   Set
    
    ```
    gameObject.setAngularVelocity(v);
    ```
    
*   Get
    
    ```
    var av = gameObject.body.angularVelocity;
    ```
    

##### Angular acceleration[​](#angular-acceleration-1 "Direct link to Angular acceleration")

*   Set
    
    ```
    gameObject.setAngularAcceleration(v);
    ```
    
*   Get
    
    ```
    var aa = gameObject.body.angularAcceleration;
    ```
    

##### Angular drag[​](#angular-drag-1 "Direct link to Angular drag")

*   Set
    
    ```
    gameObject.setAngularDrag(v);
    ```
    
*   Get
    
    ```
    var ad = gameObject.body.angularDrag;
    ```
    

#### Collision[​](#collision-2 "Direct link to Collision")

##### Collision category[​](#collision-category-1 "Direct link to Collision category")

By default all bodies collide with all other bodies. Collision categories define how different physics bodies interact with each other during collisions. It specifies which objects should collide and which should not. Collision categories are typically set using a bitmask, where each category is represented by a unique power of two. A body can collide with multiple collision categories.

*   Collision category
    *   Get
        
        ```
        var collisionCategory = gameObject.body.collisionCategory;
        ```
        
    *   Set
        
        ```
        gameObject.setCollisionCategory(category);
        ```
        
        *   `category` :
            *   `(1 << 0)`
            *   `(1 << 1)`
            *   `(1 << 2)`
            *   ...
            *   `(1 << 31)`
    *   Reset collision category, to default behavior (all bodies collide with all others)
        
        ```
        gameObject.resetCollisionCategory();
        ```
        
        *   Set `collisionCategory` to `1`.
        *   Set `collisionMask` to `1`
*   Collision mask
    *   Get
        
        ```
        var collisionMask = gameObject.body.collisionMask;
        ```
        
    *   Set
        
        ```
        gameObject.setCollidesWith(categories);
        ```
        
        *   `categories` : A single category value, or an array of them.
    *   Add
        
        ```
        gameObject.addCollidesWith(category):
        ```
        
        *   `category` : A single category value.
    *   Remove
        
        ```
        gameObject.removeCollidesWith(category);
        ```
        
        *   `category` : A single category value.

##### Game Object collision bounds[​](#game-object-collision-bounds "Direct link to Game Object collision bounds")

Collision bounds define the area used for collision detection.

*   Rectangle
    
    ```
    gameObject.setBodySize(width, height, center);
    ```
    
    *   `center` : `false` to set body's offset to (0, 0)
*   Circle
    
    ```
    gameObject.setCircle(radius, offsetX, offsetY);
    ```
    

###### Offset[​](#offset "Direct link to Offset")

```
gameObject.setOffset(x, y);
```

##### Push out[​](#push-out-1 "Direct link to Push out")

Performs a collision check and separation between two physics enabled objects.

```
this.physics.add.collider(objectsA, objectsB);
```

*   `objectsA`, `objectsB` :
    *   A game object
    *   Game objects in array (Add or remove game objects)
    *   Physics group (Add or remove game objects)
    *   Group (Add or remove game objects)

##### Callbacks[​](#callbacks-1 "Direct link to Callbacks")

Callbacks are functions that are called when collisions or overlaps occur between two objects every step.

```
var collider = this.physics.add.collider(objectsA, objectsB, collideCallback, processCallback, callbackContext);
```

*   `collideCallback` : The callback to invoke when the two objects collide.
*   `processCallback` : The callback to invoke when the two objects collide. Must return a boolean.
*   `callbackContext` : The scope in which to call the callbacks.

#### Point inside[​](#point-inside-1 "Direct link to Point inside")

The `hitTest` function checks if a specific point in the game world is colliding with any physics bodies. It returns `true` if a collision has occurred and `false` otherwise.

```
var hit = gameObject.hitTest(x, y);
```

##### Bounce[​](#bounce-1 "Direct link to Bounce")

*   Set
    
    ```
    gameObject.setBounce(x, y);
    ```
    
    or
    
    ```
    gameObject.setBounceX(x);
    gameObject.setBounceY(y);
    ```
    
*   Get
    
    ```
    var bx = gameObject.body.bounce.x;
    var by = gameObject.body.bounce.y;
    ```
    
*   Enable bounce when colliding with the world boundary
    
    ```
    gameObject.setCollideWorldBounds();
    ```
    
*   Disable bounce when colliding with the world boundary
    
    ```
    gameObject.setCollideWorldBounds(false);
    ```
    

#### Mass[​](#mass-1 "Direct link to Mass")

The Body's inertia, relative to a default unit (1). With bounce, this affects the exchange of momentum (velocities) during collisions.

*   Set
    
    ```
    gameObject.setMass(m);
    ```
    
*   Get
    
    ```
    var m = gameObject.body.mass;
    ```
    

#### Static game object[​](#static-game-object "Direct link to Static game object")

##### Sync[​](#sync-1 "Direct link to Sync")

Syncs the Bodies position and size in static game object.

```
gameObject.refreshBody();
```

#### Methods of group[​](#methods-of-group "Direct link to Methods of group")

```
group.setVelocity(x, y, step);
```

```
group.setVelocityX(value, step);
```

```
group.setVelocityY(value, step);
```

```
group.refresh(); // call this method when position of game objects were changed in static object group
```

#### Debug[​](#debug-2 "Direct link to Debug")

Draws a graphical representation of the Game Object for visual debugging purposes.

```
gameObject.setDebug(showBody, showVelocity, bodyColor);
```

```
gameObject.setDebugBodyColor(bodyColor);
```

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
