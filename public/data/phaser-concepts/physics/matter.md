# Matter Physics

Matter Physics is an open-source third party physics library and Phaser has its own custom version of it bundled. The reason for including Matter is that it provides a more advanced 'full body' physics system. If you need to move beyond rectangles and circles, with more complex physics shapes, and features such as constraints, joints and behaviours, then Matter is the system to use.

Matter physics must be enabled before it can be used. This can be done via the Game Configuration or on a per-Scene basis. Once enabled, you can then add physics-enabled Game Objects to your game. This will allow you to control the Sprite using the built-in physics functions, such as velocity, acceleration, gravity, etc.

By default a Game Object is not enabled for physics. This is because not all Game Objects need to be. For example, a background image or game logo likely doesn't need to be affected by physics, but a player character does. Therefore, you must enable physics on the Game Objects that you specifically want to be affected by it. We will cover this in detail in later chapters.

Arcade Physics and Matter Physics are two separate systems. An Arcade Physics sprite, for example, cannot collide with a Matter Physics sprite. You cannot add the same Sprite to both systems, you need to pick one or the other. However, although it's unusual to do so, both systems can actually run in parallel in the same Scene. This means that you can have a Sprite that uses Arcade Physics and another that uses Matter Physics, and they will both work at the same time, although they will not interact together.

## Matter world[​](#matter-world "Direct link to Matter world")

The Matter Physics World provides a more advanced and realistic simulation of physics interactions compared to the Arcade Physics. Built on the Matter.js library it allows more complex physics behavior such as rigid body dynamics, constraints, and advanced collision detection.

### World configuration[​](#world-configuration "Direct link to World configuration")

The Matter Physics `config` object defines the behavior of the Matter Physics system globally.

*   Basic configuration object

```
const config = {
  // ...
  physics: {
    default: "matter",
  },
  // ...
};

const game = new Phaser.Game(config);
```

*   Full configuration

```
var config = {
  // ...
  physics: {
    default: "matter",
    matter: {
      //    enabled: true,
      //    positionIterations: 6,
      //    velocityIterations: 4,
      //    constraintIterations: 2,
      //    enableSleeping: false,
      //    plugins: {
      //        attractors: false,
      //        wrap: false,
      //    },
      //    gravity: {
      //        x: 0,
      //        y: 0,
      //    }
      //    setBounds: {
      //        x: 0,
      //        y: 0,
      //        width: scene.sys.scale.width,
      //        height: scene.sys.scale.height,
      //        thickness: 64,
      //        left: true,
      //        right: true,
      //        top: true,
      //        bottom: true,
      //    },
      //    timing: {
      //        timestamp: 0,
      //        timeScale: 1,
      //    },
      //    correction: 1,
      //    getDelta: (function() { return 1000 / 60; }),
      //    autoUpdate: true,
      //    debug: false,
      //    debug: {
      //        showAxes: false,
      //        showAngleIndicator: false,
      //        angleColor: 0xe81153,
      //        showBroadphase: false,
      //        broadphaseColor: 0xffb400,
      //        showBounds: false,
      //        boundsColor: 0xffffff,
      //        showVelocity: false,
      //        velocityColor: 0x00aeef,
      //        showCollisions: false,
      //        collisionColor: 0xf5950c,
      //        showSeparations: false,
      //        separationColor: 0xffa500,
      //        showBody: true,
      //        showStaticBody: true,
      //        showInternalEdges: false,
      //        renderFill: false,
      //        renderLine: true,
      //        fillColor: 0x106909,
      //        fillOpacity: 1,
      //        lineColor: 0x28de19,
      //        lineOpacity: 1,
      //        lineThickness: 1,
      //        staticFillColor: 0x0d177b,
      //        staticLineColor: 0x1327e4,
      //        showSleeping: false,
      //        staticBodySleepOpacity: 0.7,
      //        sleepFillColor: 0x464646,
      //        sleepLineColor: 0x999a99,
      //        showSensors: true,
      //        sensorFillColor: 0x0d177b,
      //        sensorLineColor: 0x1327e4,
      //        showPositions: true,
      //        positionSize: 4,
      //        positionColor: 0xe042da,
      //        showJoint: true,
      //        jointColor: 0xe0e042,
      //        jointLineOpacity: 1,
      //        jointLineThickness: 2,
      //        pinSize: 4,
      //        pinColor: 0x42e0e0,
      //        springColor: 0xe042e0,
      //        anchorColor: 0xefefef,
      //        anchorSize: 4,
      //        showConvexHulls: false,
      //        hullColor: 0xd703d0
      //    }
    },
  },
  // ...
};
var game = new Phaser.Game(config);
```

### Control[​](#control "Direct link to Control")

#### Pause[​](#pause "Direct link to Pause")

```
this.matter.world.pause();
```

#### Resume[​](#resume "Direct link to Resume")

```
this.matter.world.resume();
```

#### Drag object[​](#drag-object "Direct link to Drag object")

```
this.matter.add.mouseSpring();
// this.matter.add.mouseSpring(options);
```

*   `options`
    
    ```
    {
        length: 0.01,
        stiffness: 0.1,
        damping: 0,
        angularStiffness: 1,
        collisionFilter: {
            category: 0x0001,
            mask: 0xFFFFFFFF,
            group: 0
        }
    }
    ```
    
    *   `collisionFilter` : Drag filter, see [collision](#game-object-collision).

### World bounds[​](#world-bounds "Direct link to World bounds")

#### Enable[​](#enable "Direct link to Enable")

*   World :
    
    *   Set bounds
        
        ```
        ```js
        this.matter.world.setBounds(x, y, width, height);
        // this.matter.world.setBounds(x, y, width, height, thickness, left, right, top, bottom);
        ```
        ```
        
        *   `thickness` : The thickness of each wall, in pixels.
        *   `left`, `right`, `top`, `bottom` : If true will create the left/right/top/bottom bounds wall.

### Gravity[​](#gravity "Direct link to Gravity")

*   Set
    
    ```
    this.matter.world.setGravity(x, y);
    // this.matter.world.setGravity(x, y, scale);
    ```
    
*   Disable
    
    ```
    this.matter.world.disableGravity();
    ```
    

### Constraint[​](#constraint "Direct link to Constraint")

#### Constraint of 2 game objects[​](#constraint-of-2-game-objects "Direct link to Constraint of 2 game objects")

```
var constraint = this.matter.add.constraint(gameObjectA, gameObjectB);
// var constraint = this.matter.add.constraint(gameObjectA, gameObjectB, length, stiffness, options);
```

*   `gameObjectA`, `gameObjectB` : Matter game object, or matter body object.
    
*   `length` : The target resting length of the constraint.
    
    *   `undefined` : Current distance between gameObjectA and gameObjectB. (Default value)
*   `stiffness` : The stiffness of the constraint.
    
    *   `1` : Very stiff. (Default value)
    *   `0.2` : Acts as a soft spring.
*   `options` :
    
    ```
    {
        pointA: {
            x: 0,
            y: 0,
        },
        pointB: {
            x: 0,
            y: 0,
        },
        damping: 0,
        angularStiffness: 0,
        // render: {
        //     visible: true
        // }
    }
    ```
    
    *   `pointA`, `pointB` : Offset position of `gameObjectA`, `gameObjectB`.

Alias:

```
var constraint = this.matter.add.spring(
  gameObjectA,
  gameObjectB,
  length,
  stiffness,
  options
);
var constraint = this.matter.add.joint(
  gameObjectA,
  gameObjectB,
  length,
  stiffness,
  options
);
```

#### Constraint to world position[​](#constraint-to-world-position "Direct link to Constraint to world position")

```
var constraint = this.matter.add.worldConstraint(
  gameObjectB,
  length,
  stiffness,
  options
);
```

*   `gameObjectB` : Matter game object, or matter body object.
    
*   `length` : The target resting length of the constraint.
    
    *   `undefined` : Current distance between gameObjectA and gameObjectB. (Default value)
*   `stiffness` : The stiffness of the constraint.
    
    *   `1` : Very stiff. (Default value)
    *   `0.2` : Acts as a soft spring.
*   `options` :
    
    ```
    {
        pointA: {
            x: 0,
            y: 0,
        },
        pointB: {
            x: 0,
            y: 0,
        },
        damping: 0,
        angularStiffness: 0,
        // render: {
        //     visible: true
        // }
    }
    ```
    
    *   `pointA` : World position.
    *   `pointB` : Offset position of `gameObjectB`.

#### Chain game objects[​](#chain-game-objects "Direct link to Chain game objects")

```
var composite = this.matter.add.chain(
  composite,
  xOffsetA,
  yOffsetA,
  xOffsetB,
  yOffsetB,
  options
);
```

*   `composite` : [Image composite](#image-composite)
    
*   `xOffsetA`, `yOffsetA` : Offset position of gameObjectA, in scale.
    
    *   xOffset = (Offset distance / width)
    *   yOffset = (Offset distance / height)
*   `xOffsetB`, `yOffsetB` : Offset position of gameObjectB, in scale.
    
*   `options` :
    
    ```
    {
        length: undefined,
        stiffness: 1,
        damping: 0,
        angularStiffness: 0,
        // render: {
        //     visible: true
        // }
    }
    ```
    
    *   `length` : The target resting length of the constraint.
        *   `undefined` : Current distance between gameObjectA and gameObjectB. (Default value)
    *   `stiffness` : The stiffness of the constraint.
        *   `1` : Very stiff. (Default value)
        *   `0.2` : Acts as a soft spring.
*   `composite`
    
    *   `composite.bodies` : An array of bodies.
    *   `composite.constraints` : An array of constraints

#### Remove constraint[​](#remove-constraint "Direct link to Remove constraint")

```
this.matter.world.removeConstraint(constraint);
```

## Matter Game Object[​](#matter-game-object "Direct link to Matter Game Object")

Game Objects are the building blocks of your game. Common Matter Game Objects include: Sprites, Images and TileBody.

### Usage[​](#usage "Direct link to Usage")

#### Add Game Objects[​](#add-game-objects "Direct link to Add Game Objects")

[Enable physics world](#world-configuration).

##### Image object[​](#image-object "Direct link to Image object")

```
var image = this.matter.add.image(x, y, key, frame);
// var image = this.matter.add.image(x, y, key, frame, config);
```

*   `config` : [Config object](#game-object-configuration)

##### Sprite object[​](#sprite-object "Direct link to Sprite object")

```
var image = this.matter.add.sprite(x, y, key, frame);
// var image = this.matter.add.sprite(x, y, key, frame, config);
```

*   `config` : [Config object](#game-object-configuration)

##### Any game object[​](#any-game-object "Direct link to Any game object")

```
var gameObject = this.matter.add.gameObject(gameObject);
// var gameObject = this.matter.add.gameObject(gameObject, config);
```

*   `config` : [Config object](#game-object-configuration)

##### Image composite[​](#image-composite "Direct link to Image composite")

Create a new composite containing Matter Image objects created in a grid arrangement.

```
var composite = this.matter.add.imageStack(key, frame, x, y, columns, rows);
// var composite = this.matter.add.imageStack(key, frame, x, y, columns, rows, columnGap, rowGap, options);
```

*   `key`, `frame` : Texture key and frame name.
*   `x`, `y` : Top-left position of these game objects.
*   `columns`, `rows` : The number of columns/rows in the grid.
*   `columnGap`, `rowGap` : The distance between each column/row.
*   `config` : [Config object](#game-object-configuration)
*   `composite` : Composite matter object.
    *   `composite.bodies` : An array of bodies.

##### Game Object configuration[​](#game-object-configuration "Direct link to Game Object configuration")

```
{
    label: 'Body',
    shape: 'rectangle',
    chamfer: null,

    isStatic: false,
    isSensor: false,
    isSleeping: false,
    ignoreGravity: false,
    ignorePointer: false,

    sleepThreshold: 60,
    density: 0.001,
    restitution: 0,
    friction: 0.1,
    frictionStatic: 0.5,
    frictionAir: 0.01,

    force: { x: 0, y: 0 },
    angle: 0,
    torque: 0,

    collisionFilter: {
        group: 0,
        category: 0x0001,
        mask: 0xFFFFFFFF,
    },

    // parts: [],

    // plugin: {
    //     attractors: [
    //         (function(bodyA, bodyB) { return {x, y}}),
    //     ]
    // },

    slop: 0.05,

    timeScale: 1,
}
```

*   `label` : An arbitrary `String` name to help the user identify and manage bodies.
    
*   `shape` :
    
    *   A string : `'rectangle'`, `'circle'`, `'trapezoid'`, `'polygon'`, `'fromVertices'`, `'fromPhysicsEditor'`
        
    *   An object :
        
        *   Rectangle shape
            
            ```
              ```js
              {
                  type: 'rectangle',
                  // width: gameObject.width
                  // height: gameObject.height
              }
              ```
            ```
            
        *   Circle shape
            
            ```
              ```js
              {
                  type: 'circle',
                  // radius: (Math.max(gameObject.width, gameObject.height) / 2),
                  // maxSides: 25
              }
              ```
            ```
            
        *   Trapezoid shape
            
            ```
              ```js
              {
                  type: 'trapezoid',
                  // slope: 0.5,
              }
              ```
            ```
            
        *   Polygon shape
            
            ```
              ```js
              {
                  type: 'polygon',
                  // radius: (Math.max(gameObject.width, gameObject.height) / 2),
                  // sides: 5,
              }
              ```
            ```
            
        *   Vertices
            
            ```
              ```js
              {
                  type: 'fromVertices',
                  verts: points,
                  // flagInternal: false,
                  // removeCollinear: 0.01,
                  // minimumArea: 10,
              }
              ```
            ```
            
            *   `points` :
                *   A string : `'x0 y0 x1 y1 ...'`
                *   An array of points : `[{x:x0, y:y0}, {x:x1, y:y1}, ...]`
*   `chamfer` :
    
    *   `null`
    *   A number
    *   `{radius: value}`
    *   `{radius: [topLeft, topRight, bottomRight, bottomLeft]}`
*   `isStatic` : A flag that indicates whether a body is considered static. A static body can never change position or angle and is completely fixed.
    
*   `isSensor` : A flag that indicates whether a body is a sensor. Sensor triggers collision events, but doesn't react with colliding body physically.
    
*   `isSleeping` : A flag that indicates whether the body is considered sleeping. A sleeping body acts similar to a static body, except it is only temporary and can be awoken.
    
*   `sleepThreshold` : The number of updates in which this body must have _near-zero velocity_ before it is set as sleeping.
    
*   `density` : Density of the body, that is its mass per unit area.
    
*   `restitution` : The restitution/bounce/elasticity of the body. The value is always positive and is in the range `(0, 1)`.
    
    *   `0` : Collisions may be perfectly inelastic and no bouncing may occur.
    *   `0.8` : The body may bounce back with approximately 80% of its kinetic energy.
*   `friction` : Friction of the body. The value is always positive and is in the range `(0, 1)`.
    
    *   `0` : The body may slide indefinitely.
    *   `1` : The body may come to a stop almost instantly after a force is applied.
*   `frictionStatic` : The static friction of the body (in the Coulomb friction model).
    
    *   `0` : The body will never 'stick' when it is nearly stationary and only dynamic `friction` is used.
    *   `10` : The higher the value, the more force it will take to initially get the body moving when nearly stationary.
*   `frictionAir` : The air friction of the body (air resistance).
    
    *   `0` : The body will never slow as it moves through space.
    *   The higher the value, the faster a body slows when moving through space.
*   `force` : The force to apply in the current step.
    
*   `angle` : Angle of the body, in radians.
    
*   `torque` : the torque (turning force) to apply in the current step.
    
*   `collisionFilter` : An `Object` that specifies the collision filtering properties of this body.
    
    *   `collisionFilter.group`
    *   `collisionFilter.category` : A bit field that specifies the collision category this body belongs to.
    *   `collisionFilter.mask` : A bit mask that specifies the collision categories this body may collide with.
*   `slop` : A tolerance on how far a body is allowed to 'sink' or rotate into other bodies.
    
    *   The default should generally suffice, although very large bodies may require larger values for stable stacking.

###### Game Object collision[​](#game-object-collision "Direct link to Game Object collision")

Collisions between two bodies will obey the following rules:

*   (grpupA > 0) && (groupB > 0) :
    *   Collision = (groupA == groupB)
*   (grpupA == 0) || (groupB == 0) :
    *   Collision = ((categoryA & maskB) !== 0) && ((categoryB & maskA) !== 0)

#### Movement[​](#movement "Direct link to Movement")

##### Velocity[​](#velocity "Direct link to Velocity")

```
gameObject.setVelocity(x, y);
```

```
gameObject.setVelocityX(x);
```

```
gameObject.setVelocityY(x);
```

##### Acceleration[​](#acceleration "Direct link to Acceleration")

###### Force[​](#force "Direct link to Force")

*   Applies a force to a body.
    
    ```
    gameObject.applyForce(force);
    ```
    
    *   `force` : `{x, y}`
*   Applies a force to a body from a given position.
    
    ```
    gameObject.applyForceFrom(position, force); // position, force: {x, y}
    ```
    
    *   `position` : `{x, y}`
    *   `force` : `{x, y}`
*   Apply thrust to the forward position of the body.
    
    ```
    gameObject.thrust(speed);
    ```
    
    *   `speed` : A number.
*   Apply thrust to the left position of the body.
    
    ```
    gameObject.thrustLeft(speed);
    ```
    
    *   `speed` : A number.
*   Apply thrust to the right position of the body.
    
    ```
    gameObject.thrustRight(speed);
    ```
    
    *   `speed` : A number.
*   Apply thrust to the back position of the body.
    
    ```
    gameObject.thrustBack(speed);
    ```
    
    *   `speed` : A number.
*   Apply thrust to the back position of the body.
    
    ```
    gameObject.thrustBack(speed);
    ```
    
    *   `speed` : A number.

###### Gravity[​](#gravity-1 "Direct link to Gravity")

*   Ignore world gravity
    
    ```
    gameObject.setIgnoreGravity(ignore);
    ```
    
    *   `ignore` : Set to true to ignore the effect of world gravity

###### Friction[​](#friction "Direct link to Friction")

```
gameObject.setFriction(value, air, fstatic);
```

```
gameObject.setFrictionAir(v);
```

```
gameObject.setFrictionStatic(v);
```

#### Rotation[​](#rotation "Direct link to Rotation")

##### Fixed rotation[​](#fixed-rotation "Direct link to Fixed rotation")

```
gameObject.setFixedRotation();
```

##### Angular velocity[​](#angular-velocity "Direct link to Angular velocity")

```
gameObject.setAngularVelocity(v);
```

#### Collision[​](#collision "Direct link to Collision")

##### Enable[​](#enable-1 "Direct link to Enable")

*   Get
    
    ```
    var isSensor = gameObject.isSensor();
    ```
    
*   Set
    
    ```
    gameObject.setSensor(value);
    ```
    
    *   `value` : Set `true` to enable sensor.

##### Collision group[​](#collision-group "Direct link to Collision group")

*   Collision grpup
    
    ```
    gameObject.setCollisionGroup(value);
    ```
    
*   Collision category
    
    1.  Get new collision category
        
        ```
        var category = this.matter.world.nextCategory();
        ```
        
        *   `category` : An one-shot number `(1, 2, 4, 8, ...., 2147483648 (1<<31))`
    2.  Set collision category of game object
        
        ```
        gameObject.setCollisionCategory(category);
        ```
        
    3.  Set category mask
        
        ```
        gameObject.setCollidesWith([categoryA, categoryB, ...]);
        // gameObject.setCollidesWith(categoryA);
        ```
        

##### Collision event[​](#collision-event "Direct link to Collision event")

```
this.matter.world.on("collisionstart", function (event, bodyA, bodyB) {
  // var pairs = event.pairs;
});
```

*   `event` :
    *   `event.pairs` : An array of collision pairs
        *   `event.pairs[i].bodyA`, `event.pairs[i].bodyB` : Matter body object.
            *   `body.gameObject` : Game object of matter body.
*   `bodyA`, `bodyB` : Equal to `event.pairs[0].bodyA`, `event.pairs[0].bodyB`.

##### Collision bound[​](#collision-bound "Direct link to Collision bound")

*   Rectangle
    
    ```
    gameObject.setRectangle(width, height, options);
    ```
    
*   Circle
    
    ```
    gameObject.setCircle(radius, options);
    ```
    
*   Polygon
    
    ```
    gameObject.setPolygon(radius, sides, options);
    ```
    
*   Trapezoid
    
    ```
    gameObject.setTrapezoid(width, height, slope, options);
    ```
    
*   Any
    
    ```
    gameObject.setBody(config, options);
    ```
    
    *   `config` :
        
        *   Rectangle shape
            
            ```
              ```js
              {
                  type: 'rectangle',
                  // width: gameObject.width
                  // height: gameObject.height
              }
              ```
            ```
            
        *   Circle shape
            
            ```
              ```js
              {
                  type: 'circle',
                  // radius: (Math.max(gameObject.width, gameObject.height) / 2),
                  // maxSides: 25
              }
              ```
            ```
            
        *   Trapezoid shape
            
            ```
              ```js
              {
                  type: 'trapezoid',
                  // slope: 0.5,
              }
              ```
            ```
            
        *   Polygon shape
            
            ```
              ```js
              {
                  type: 'polygon',
                  // radius: (Math.max(gameObject.width, gameObject.height) / 2),
                  // sides: 5,
              }
              ```
            ```
            

##### Bounce[​](#bounce "Direct link to Bounce")

```
gameObject.setBounce(v);
```

*   restitution

#### Mass[​](#mass "Direct link to Mass")

```
gameObject.setMass(v);
```

```
gameObject.setDensity(v);
```

#### Sleep[​](#sleep "Direct link to Sleep")

##### Enable[​](#enable-2 "Direct link to Enable")

```
var config = {
  // ...
  physics: {
    matter: {
      // ...
      enableSleeping: true,
      // ...
    },
  },
};
```

##### Sleep threshold[​](#sleep-threshold "Direct link to Sleep threshold")

```
gameObject.setSleepThreshold(value);
```

##### Sleep events[​](#sleep-events "Direct link to Sleep events")

*   Sleeping start
    
    ```
    this.matter.world.on("sleepstart", function (event, body) {});
    ```
    
*   Sleeping end
    
    ```
    this.matter.world.on("sleepend", function (event, body) {});
    ```
    

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
