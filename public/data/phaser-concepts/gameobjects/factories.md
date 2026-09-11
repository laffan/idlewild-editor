# Game Object Factories

## Game Object Factory[​](#game-object-factory "Direct link to Game Object Factory")

The role of the Game Object Factory is to create Game Objects for you and add them to the Scene, making them immediately ready for use.

The Factory itself is a very small class, providing just a few properties and hooks. Its power comes from the fact that all Game Objects register themselves with it, dynamically extending the class with new methods. You can even create your own Game Objects that include a factory function, allowing you to extend the Factory to suit your own needs.

Every Scene has an instance of the `GameObjectFactory` class. By default, this is mapped to the Scene's `add` property. For example, here is how to create a Sprite via the Game Object Factory:

```
const sprite = this.add.sprite(x, y, key);
```

Internally, there is no actual `sprite` method in the Game Object Factory itself. If you were to open the class file in an editor, you won't find it. This is because each Game Object is responsible for its own factory function. Here is the one for the Sprite:

```
GameObjectFactory.register('sprite', function (x, y, texture, frame)
{
    return this.displayList.add(new Sprite(this.scene, x, y, texture, frame));
});
```

This code can be found in the `src/gameobjects/sprite/SpriteFactory.js` file within the Phaser repository. Nearly all Game Objects have similar `Factory.js` files, which are responsible for registering themselves with the Factory.

You can see the code is calling the static `GameObjectFactory.register` function and passing it the name of its own factory function, `sprite`, and a callback. The `register` function will take this callback and add it to the Factory, under the `sprite` property.

And it is this callback that is invoked whenever you call `this.add.sprite` in your game code. In this case, it's responsible for creating the Sprite instance and adding it to the display list, but any actual logic can take place here.

The callback is invoked using the Game Object Factory as the context, meaning that `this` within the callback is a reference to the Factory itself. This is why you can see it accessing the `this.displayList` property. This is a property available in the Game Object Factory class, which is a reference to the Scene Display List.

It's important to understand that while each Scene has its own instance of the Game Object Factory, registration of Game Objects with the Factory is global. This means that once a Game Object has been registered, its factory function is available to use from any Scene in your game.

At the end of the day, the Factory is all about convenience. It allows you to create Game Objects without having to worry about the internal details of how they are created. It also allows you to extend the Factory with your own Game Objects, or even override the existing ones, allowing you to customize the Factory to suit your own needs.

### How to bypass the Game Object Factory[​](#how-to-bypass-the-game-object-factory "Direct link to How to bypass the Game Object Factory")

If you wish to create a Game Object without using the Factory, you can do so by calling the Game Object constructor directly. For example, to create a Sprite you would do this:

```
const sprite = new Phaser.GameObjects.Sprite(scene, x, y, key);

sprite.addToDisplayList();
```

### Removing a Factory Function[​](#removing-a-factory-function "Direct link to Removing a Factory Function")

If the Game Object Factory already has a function registered with a given name, it will simply skip any further registations for the same name. Therefore, if you wish to replace one of the internal Phaser Game Objects with your own, you will need to remove the existing entry first before adding yours.

You can do this by calling the `remove` method:

```
Phaser.GameObjects.GameObjectFactory.remove('sprite');
```

This will remove the `sprite` method from the Factory, allowing you to then add your own with the same name. This process is immediate.

### Adding Custom Game Objects to the Game Object Factory[​](#adding-custom-game-objects-to-the-game-object-factory "Direct link to Adding Custom Game Objects to the Game Object Factory")

You can extend the Game Object Factory by adding your own Game Objects to it. This is done by calling the static `register` method on the Factory itself. This method takes two arguments: The name of the Game Object, and a callback function that will create an instance of it.

Here is a simple class for our custom Game Object:

```
class Bomb extends Phaser.GameObjects.Sprite
{
    constructor (scene, x, y)
    {
        super(scene, x, y, 'bomb');

        this.setScale(0.5);
    }

    preUpdate (time, delta)
    {
        super.preUpdate(time, delta);

        this.rotation += 0.01;
    }
}
```

This is a very simple Game Object that extends the Sprite class. It's a bomb that spins around on the screen, as managed by the rotation in the `preUpdate`. We will register this with the Game Object Factory using the `bomb` key. We'll do this in our Scene `init` method:

```
class Example extends Phaser.Scene
{
    init ()
    {
        Phaser.GameObjects.GameObjectFactory.register('bomb', function (x, y)
        {
            return this.displayList.add(new Bomb(this.scene, x, y));
        });
    }
}
```

The `init` method is called first in a Scene. This means we can safely register our custom Game Object here, and it will be available for use in the Scene `create` method:

```
create ()
{
    this.add.bomb(200, 200);
    this.add.bomb(400, 300);
    this.add.bomb(600, 400);
}
```

You can see the full example here: \[file: gameobjects/custom-factory.js\]

When coding your register functions you have access to the following properties:

Property

Description

`this.scene`

A reference to the Scene that owns the Game Object Factory.

`this.systems`

A reference to the Scene Systems.

`this.events`

A reference to the Scene Event Emitter.

`this.displayList`

A reference to the Scene Display List.

`this.updateList`

A reference to the Scene Update List.

In the example above we registered the Game Object in the Scene `init` method. However, it's also very common to register it in the Game Object file itself in order to keep things tidy and together.

Here is a variation of the Bomb Game Object that registers itself with the Factory:

```
export class Bomb extends Phaser.GameObjects.Sprite
{
    constructor (scene, x, y)
    {
        super(scene, x, y, 'bomb');

        this.setScale(0.5);
    }

    preUpdate (time, delta)
    {
        super.preUpdate(time, delta);

        this.rotation += 0.01;
    }
}

Phaser.GameObjects.GameObjectFactory.register('bomb', function (x, y)
{
    return this.displayList.add(new Bomb(this.scene, x, y));
});
```

We can then import this into our Scene:

```
import { Bomb } from './Bomb.js';
```

And call the `this.add.bomb` method as before.

## Game Object Creator[​](#game-object-creator "Direct link to Game Object Creator")

The role of the Game Object Creator is to create Game Objects based on configuration objects. You can also elect to have them automatically added them to the Scene, or not. This makes Creator functions very useful for creating Game Objects in advance, so you can avoid object instantiation during time-critical parts of your game, such as when it is running.

The main differernce between the Game Object Creator and the Game Object Factory is that all Creator functions take configuration objects. Where-as the Factory functions take fixed arguments. Which one you use is up to you. The Creator is more flexible and has some powerful features when parsing the config objects, but the Factory functions are easier to understand, remember and parse from languages like TypeScript.

The Creator itself is a very small class, providing just a few properties and hooks. Its power comes from the fact that all Game Objects register themselves with it, dynamically extending the class with new methods. You can even create your own Game Objects that include a creator function, allowing you to extend the Creator to suit your own needs.

Every Scene has an instance of the `GameObjectCreator` class. By default, this is mapped to the Scene's `make` property. For example, here is how to create a Sprite via the Game Object Creator:

```
const sprite = this.make.sprite({
    x: 400,
    y: 300,
    key: 'playerAtlas',
    frame: 'idle'
});
```

The above example makes some assumptions, such as the texture key and frame name, but you should take it as an example of a simple configuration object, rather than something you can copy and paste.

Internally, there is no actual `sprite` method in the Game Object Creator itself. If you were to open the class file in an editor, you won't find it. This is because each Game Object is responsible for its own creator function. The Sprite creator code can be found in the `src/gameobjects/sprite/SpriteCreator.js` file within the Phaser repository. Nearly all Game Objects have similar `Creator.js` files, which are responsible for registering themselves with the Creator.

All Creator functions call the static `GameObjectCreator.register` function, and pass it the name of its own creator function, `sprite`, and a callback. The `register` function will take this callback and add it to the Creator, under the `sprite` property.

And it is this callback that is invoked whenever you call `this.make.sprite` in your game code. In this case, it's responsible for creating the Sprite instance from the config object and adding it to the display list, but any actual logic can take place here.

The callback is invoked using the Game Object Creator as the context, meaning that `this` within the callback is a reference to the Creator itself.

It's important to understand that while each Scene has its own instance of the Game Object Creator, registration of Game Objects with the Creator is global. This means that once a Game Object has been registered, its creator function is available to use from any Scene in your game.

At the end of the day, the Creator is all about convenience. It allows you to create Game Objects without having to worry about the internal details of how they are created. It also allows you to extend the Creator with your own Game Objects, or even override the existing ones, allowing you to customize the Creator to suit your own needs.

### How to set Configuration Properties[​](#how-to-set-configuration-properties "Direct link to How to set Configuration Properties")

As we've seen above, you pass in configuration objects to the Creator functions in order to make the Game Objects. These config objects are parsed by the Creator and the values are used to set the properties of the Game Object being created, such as its position, scale, or rotation.

However, the way in which these properties are parsed is where the real power of the Creator comes in. Most properties are set through a Phaser function called `GetAdvancedValue`, which allows the properties to expressed in 5 different ways.

For brevity we'll focus just on creating a Sprite and settings its x/y coordinates. However, you can actually use this approach on nearly all Game Object properties (see the table below).

#### 1\. Explicit Value[​](#1-explicit-value "Direct link to 1. Explicit Value")

The first and most obvious way is to simply provide a fixed value:

```
const sprite = this.make.sprite({
    x: 400
});
```

The Sprite will have an x position of 400.

#### 2\. Random Array Value[​](#2-random-array-value "Direct link to 2. Random Array Value")

You can pass in an array of values, in which case a random element from the array will be selected and used:

```
const sprite = this.make.sprite({
    x: [ 400, 500, 600 ]
});
```

The Sprite x position will be randomly picked from the given array. So, its x coordinate could be 400, 500 or 600. You can pass in as many values as you like, and the Creator will pick a random one from the array each time.

#### 3\. Random Integer Between Min and Max[​](#3-random-integer-between-min-and-max "Direct link to 3. Random Integer Between Min and Max")

You can pass in an object with a `randInt` property. This should be a 2 element array, where the first element is the minimum value and the second is the maximum. A random integer between the two will be selected and used:

```
const sprite = this.make.sprite({
    x: { randInt: [ 100, 600 ]}
});
```

The Sprite x position will be a random integer between 100 and 600.

#### 4\. Random Float Between Min and Max[​](#4-random-float-between-min-and-max "Direct link to 4. Random Float Between Min and Max")

You can pass in an object with a `randFloat` property. This should be a 2 element array, where the first element is the minimum value and the second is the maximum. A random float between the two will be selected and used:

```
const sprite = this.make.sprite({
    x: { randFloat: [ 100, 600 ]}
});
```

The Sprite x position will be a random float between 100 and 600.

#### 5\. Callback Value[​](#5-callback-value "Direct link to 5. Callback Value")

Finally, you can pass in a callback function. This should return a value, which will be used as the property value:

```
const sprite = this.make.sprite({
    x: function (key)
    {
        return Math.random() * 800;
    }
});
```

The Sprite x position will be a random float between 0 and 800. The callback is sent one parameter, the key of the property being set. In the example above, `key` would be `x`.

### Game Object Configuration Properties[​](#game-object-configuration-properties "Direct link to Game Object Configuration Properties")

The following table lists all of the properties you can set on any Game Object. Most Game Objects have additional properties beyond this list, however, the following are common to all Game Objects.

All property values can be expressed via any of the 5 methods outlined above.

Property

Data Type

`x`

`number`

`y`

`number`

`depth`

`number`

`scaleX`

`number`

`scaleY`

`number`

`rotation`

`number`

`angle`

`number`

`flipX`

`boolean`

`flipY`

`boolean`

`visible`

`boolean`

`alpha`

`number`

`blendMode`

`number`

`scrollFactorX`

`number`

`scrollFactorY`

`number`

`originX`

`number`

`originY`

`number`

There are also 3 special properties that act as combinations of the above:

Property

Data Type

`scale`

`number`

`origin`

`number`

`scrollFactor`

`number`

So, rather than specifying `scaleX` and `scaleY` separately, you can just specify `scale` and it will set both values. The same is true for `origin` and `scrollFactor`.

Internally in Phaser, setting all of the common properties is handled by the `BuildGameObject` function, which you can find in the `src/gameobjects/BuildGameObject.js` file. If you are developing your own Creator function, then you can use this function to handle the common properties for you.

### Animation Configuration[​](#animation-configuration "Direct link to Animation Configuration")

If you're creating a Game Object that supports animation, such as a Sprite, then you can also specify the animation details in the config object. For example, to create a Sprite and play an animation on it:

```
const sprite = this.make.sprite({
    x: 400,
    y: 300,
    key: 'playerAtlas',
    anims: 'idle'
});
```

The `anims` property is a special property that is parsed by the Sprite Creator function. It tells the Creator that you wish to play an animation on the Sprite. The value of the `anims` property can be either a string, or an object.

In the example above, we're telling it to play the 'idle' animation, as this is the animation key we have defined.

The Creator function does not _create_ animations, it just plays them. So you have to assume that the animation has already been defined in your game, prior to this call. If it hasn't, the Creator funtion won't find the animation and will skip setting it.

Rather than pass a string, you can also pass an object, which allows you to specify more details about the animation:

```
const sprite = this.make.sprite({
    x: 400,
    y: 300,
    key: 'playerAtlas',
    anims: {
        key: 'idle',
        yoyo: true,
        repeat: -1
    }
});
```

Internally in Phaser, this is handled by the `BuildGameObjectAnimation` function, which you can find in the `src/gameobjects/BuildGameObjectAnimation.js` file.

### Skipping the Display List[​](#skipping-the-display-list "Direct link to Skipping the Display List")

When you call a `make` function there is a second parameter you can pass, after the configuration object, which is `addToScene`. This is a boolean value that controls if the Game Object is automatically added to the Scene Display List, or not.

By default, this is `true`, however you can override in one of two ways. First, by simply passing `false` as the second parameter:

```

const config = {
    x: 400,
    y: 300,
    key: 'playerAtlas',
    frame: 'idle'
};

const sprite = this.make.sprite(config, false);
```

Or, by setting the `add` property in the configuration object itself to `false`:

```
const sprite = this.make.sprite({
    x: 400,
    y: 300,
    key: 'playerAtlas',
    frame: 'idle',
    add: false
});
```

In both cases, the Sprite will be created, but not added to the Scene Display List. This allows you to pre-generate a batch of Sprites in advance, but leave them in a dormant state until you need them.

Also, some Game Objects never need to be added to the Display List. For example, if you create a Graphics Game Object specifically for use as a mask, then you won't need to actually display it, so this allows you to create it without adding it to the Display List.

### Removing a Creator Function[​](#removing-a-creator-function "Direct link to Removing a Creator Function")

If the Game Object Creator already has a function registered with a given name, it will simply skip any further registations for the same name. Therefore, if you wish to replace one of the internal Phaser Game Objects with your own, you will need to remove the existing entry first before adding yours.

You can do this by calling the `remove` method:

```
Phaser.GameObjects.GameObjectCreator.remove('sprite');
```

This will remove the `sprite` method from the Creator, allowing you to then add your own with the same name. This process is immediate.
