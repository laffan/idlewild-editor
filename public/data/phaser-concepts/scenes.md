# Scenes

Phaser uses the concept of Scenes to allow you to divide your game up into logical sections. A Scene can be as large, or as small, as you like. Typical uses for a Scene would be a Loading Screen, a Main Menu, a Game Level, a Boss Fight, an in-game Item Shop, a High Score Table, etc. You can have as many Scenes in your game as you like. When you are starting out, you'll probably only have one or two, but as your game grows in complexity, you'll find yourself adding more.

It's important to understand that you do not have to have one Scene per file. You can, if you like, but it's not a requirement. You can have all of your Scenes in a single file, or you can have one file per Scene. It's entirely up to you.

Internally, there is a Scene Manager. This Manager is what you interact with when you add, remove or switch between Scenes. It's also responsible for updating and rendering the Scenes. You have full control over the order in which the Scenes are rendered in your game. For example, it's a common practise to have a Scene dedicated entirely to handling the UI for your game, that is rendered above all other Scenes.

We will look at the life-cycle of a Scene in more detail later, but for now it's worth understanding that you can pause, resume and sleep a Scene at will, and that you can easily run multiple Scenes at the same time.

## What is a Scene?[​](#what-is-a-scene "Direct link to What is a Scene?")

In Phaser 2 there was the concept of a Game World and States. A State allowed you a view into the Game World and only one State could ever be running at once. The State had access to all kinds of systems, such as a Camera, Tweens and the Game Object Factory. When you used a command like `this.add` from within a State, you were talking to the global Game Object Factory. Once you were done with a State you moved to the next one. States were often split up into logical sections, such as a Preloader State, a Main Menu State and so on.

In Phaser 3 we changed our approach to this entirely. The first change was that States were renamed to Scenes. This was to avoid ambiguity with 'state machines', which are commonly used in games. The global State Manager was also replaced with a Scene Manager. The two terms are conceptually interchangeable, but Scene is the correct term to use and expect to see in Phaser 3. If you find any reference to States in code or a tutorial you've found online, it's for Phaser 2 and likely won't work in Phaser 3. The changes were not just in the naming of the classes though, they run much deeper than this.

Rather than Phaser managing one 'Game World' there is now no World object at all. Instead of Scenes just having references to all of the systems that the Phaser.Game instance owns, they now own them themselves. You can think of Scenes as being almost entirely self-contained Game Worlds in their own right. They manage their own input, tweens, game objects, display list, cameras and more. A Tween created in Scene A is completely separate to one created in Scene B.

Scenes now control everything using their own instances of plugins. In fact the only thing that the Game itself is responsible for is passing on global DOM based events to the Scenes, such as when to update (from RequestAnimationFrame) or core input events from the Input Manager. The handling of these events are done by the Scenes themselves though.

### What does Game still control?[​](#what-does-game-still-control "Direct link to What does Game still control?")

There are a few systems which are inherently global in their nature and therefore belong to the Game instance. These are:

*   The Renderer. There is only one instance of either the Canvas or WebGL Renderer per Game, and it's a property of the Game object.
*   The Animation Manager. Animations in Phaser 3 are global and no longer bound to a specific Game Object. You can create many different animations, which are all stored in the Animation Manager, and then any Game Object, in any Scene, can use them without duplicating lots of data and wasting memory.
*   The Cache. When files are loaded by a Scene they are placed into a global cache. So if Scene A loads an XML file, that XML data can be retrieved by any Scene as the cache is global.
*   The Registry. Every Scene has its own instance of the DataManager, but the Game also has one which you can reference from a Scene via the property `registry`. This allows for easy cross-Scene data exchange (as we'll see later in this guide)
*   The Input Manager. The Input Manager does very little in Phaser 3. It just monitors and processes DOM-level input events, such as those raised from pointers, gamepads or the keyboard. Every Scene has its own Input Plugin, which is what does all of the real work with the events, and is what you interface with when calling `this.input` from a Scene.
*   The Scene Manager. Responsible for creating, managing and updating all of the Scenes in your game.
*   The Device Inspector. Allows you to poll for features supported by the browser and hardware your game is running on. The Device class is actual a singleton and only runs once per browser, so isn't directly bound to your Game instance (i.e. if you had 2 game instances running on the same page, they would share the global Device inspector)
*   The Sound Manager. Like rendering, sounds are managed by a global system in Phaser 3. You can create Sound objects, markers, and so on from your Scenes, but there is only one manager running at once to avoid resource allocation issues.
*   The TimeStep. This plugin manages the Request Animation Frame loop and updates the core Game, causing it to step. You rarely need to interact with this directly.

Everything else, such as Tweens, Physics, Game Objects and Input handling are all managed through Scene level plugins. The Game is now only used for the timestep and the systems that are truly global, which wouldn't have made sense to duplicate per Scene.

### What happens when you create a Scene[​](#what-happens-when-you-create-a-scene "Direct link to What happens when you create a Scene")

There are lots of different ways to create a Scene but the fundamental approach is the same in all of them. A Scene consists of a Scene Configuration object and a bunch of functions. Here we'll create an example Scene using an ES6 approach:

```
class MyScene extends Phaser.Scene {

    constructor ()
    {
        super('MyFirstScene');
    }

    preload ()
    {
        this.load.image('logo', 'assets/sprites/logo.png');
    }

    create ()
    {
        this.add.image(400, 300, 'logo');
    }

}
```

We extend the `Phaser.Scene` object and give it a unique key (in this case `MyFirstScene`) in the constructor. There are two methods: `preload` and `create`. The first loads an image, the second displays it. You don't _have_ to have a `preload` method, the only requirement to be a valid Scene is a `create` method as this is the global entry-point of all Scenes in Phaser 3.

Here is the exact same thing using ES5:

```
var MyScene = new Phaser.Scene('MyFirstScene');

MyScene.preload = function ()
{
    this.load.image('logo', 'assets/sprites/logo.png');
}

MyScene.create = function ()
{
    this.add.image(400, 300, 'logo');
}
```

### Game configuration[​](#game-configuration "Direct link to Game configuration")

Creating the Scene on its own isn't enough though, it also needs to be added to the Game. You can do this when the Game is created, using the game config like this:

```
var config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    scene: MyScene
};

var game = new Phaser.Game(config);
```

The Scene has been passed in via the `scene` property. This can also be an array of Scenes if you have more than one. This is exactly the same regardless of ES5 or ES6.

If you've looked at any of the Phaser 3 examples you'll probably have seen a completely different method of creating a Scene that looks more like this:

```
var config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    scene: {
        preload: preload,
        create: create
    }
};

var game = new Phaser.Game(config);

function preload ()
{
    this.load.image('logo', 'assets/sprites/logo.png');
}

function create ()
{
    this.add.image(400, 300, 'logo');
}
```

So hang on a minute, in the ES6 and ES5 Scenes we passed an instance of them in the game config, but in the above code we're passing an actual object with just a couple of properties (`preload` and `create`) instead.

The reason this works is that, internally, the Scene Manager does a lot to determine what's being given to it.

First it looks at the `scene` property of the game config. If it's an array it then iterates through it, processing each entry in turn, otherwise it just processes the first entry found. It inspects each item given to it to see what type it is, i.e. a class, an object or a prototype function, and then turns them into full Scene objects, adding them into the Scene Manager.

Ultimately, it doesn't matter which approach you use to define your Scene, once the Scene Manager is done with them they're all treated the same internally anyway. And it's when they get turned into full Scenes that they gain several important additions such as the Scene Settings and Systems, plus the ability to communicate with each other.

#### Scene Settings[​](#scene-settings "Direct link to Scene Settings")

When your Scene is created it extracts any settings you may have defined in its config. If there aren't any, it just uses the defaults. Settings are defined in a configuration object passed to the Scene constructor. Here's an example of setting the Scenes name and physics engine from the config:

```
class Level1Scene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'Level1',
            physics: {
                arcade: {
                    debug: true,
                    gravity: { y: 200 }
                }
            }
        });
    }

}
```

The Settings object can also be used to load files. You should really only use this for loading small files as no progress feedback is ever given to the user. Use the following syntax:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            files: [
                { type: 'image', key: 'bar', url: 'loaderBar.png' },
                { type: 'image', key: 'bg', url: 'background.png' }
            ]
        });
    }

}
```

The assets are loaded _before_ your Scene Preload method is called.

It's perfect for loading a very small number of graphics, i.e. a background and progress bar image, that your Preloader Scene can then display while loading all the rest of the game assets. Or you could use it to load your internal game config, which could be parsed before loading the rest of the assets.

#### Scene Systems[​](#scene-systems "Direct link to Scene Systems")

When the Scene Manager creates your scene it installs a Scene Systems object into it. This is placed on the property `sys`, meaning you should never replace or overwrite the property `sys` in your game code, or very bad things will happen :)

The Scene Systems class is the heart of your Scene. It controls all of the Scene plugins, emits events, lets you to modify the Scene (such as sending it to sleep, waking it up, etc) and allows all of the plugins to communicate with the each other.

It will automatically install 7 **Core Plugins** into your Scenes:

*   An Event Emitter
*   The 2D Camera Manager
*   The Game Object Creator
*   The Game Object Factory
*   The Scene Plugin
*   The Display List
*   The Update List

As you can see from the list above, each Scene has its own Display List, factories and Camera system. So when you issue a command like `this.add.image` you're interfacing directly with the Scene based Game Object Factory, and adding the resulting image to the Scene level display list.

These plugins are non-optional, as they all rely on each other being present. So every Scene has them. However, you can control which are exposed as _properties_ on the Scene objects via the Injection Map.

There are also 7 **Default Plugins**. These are installed into your Scenes unless you specify otherwise via the Scene config:

*   The 3D Camera Manager
*   The Clock
*   The Data Manager Plugin
*   The Input Plugin
*   The Loader Plugin
*   The Tween Manager
*   The Lights Plugin

The plugins above are all optional. As with the Core Plugins you can control which ones are exposed via properties using the Injection Map.

#### Configuring Plugins[​](#configuring-plugins "Direct link to Configuring Plugins")

Remember that the Core Plugins cannot be removed. To remove all of the Default Plugins you simply have to pass an empty plugins array in your scene config:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            plugins: []
        });
    }

}
```

If you now try and use `this.load` in your Scene, it will fail, because the Loader Plugin has been excluded from this Scene.

If you want just the Loader and Tween plugin, but none of the others, you can specify just those:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            plugins: [ 'Loader', 'TweenManager' ]
        });
    }

}
```

If you're not sure which plugins you will need when you create your Scene you can install them via the Scene Systems. This must be done in an `init` method:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            plugins: []
        });
    }

    init ()
    {
        this.sys.install('TweenManager');
    }

}
```

The call to `install` tells it to install the Default Plugin `TweenManager`, allowing you to add tweens in this Scene.

#### Scene Injection Map[​](#scene-injection-map "Direct link to Scene Injection Map")

In Phaser 2 the State Manager would create no less than 19 properties within your State, all linked to global game systems. For example it would take your State and then add the `physics` property to it, which mapped to the Physics manager, `scale` mapped to the Scale Manager, and so on.

This was a double-edged sword. It made Phaser incredibly easy to use. There was no convoluted access required to a system, you literally just typed it out and there it was. However, you had no choice over the quantity or name of the properties that were injected. If you really wanted to use a local property called `world` you couldn't without literally breaking your game. If you accidentally overwrote one of the 19 default properties, it would also break your game. Experienced devs learned to deal with this but we thought there was a better way for Phaser 3.

To that end, we created a Scene Injection Map. This object controls which plugins are mapped to properties within your Scene, and controls exactly what those properties are called.

By default all of the following properties are installed into a Scene:

'anims' = Animation Manager (Global) 'cache' = Cache (Global) 'game' = Phaser.Game instance (Global) 'registry' = Game Data Manager (Global) 'sound' = Sound Manager (Global) 'textures' = Texture Manager (Global)

'add' = Game Object Factory (Local, Core) 'cameras' = 2D Camera Manager (Local, Core) 'children' = Display List (Local, Core) 'events' = Event Emitter (Local, Core) 'make' = Game Object Creator (Local, Core) 'scene' = Scene Manager Plugin (Local, Core)

The following properties are installed into a Scene only if the respective plugin is available:

'cameras3d' = 3D Camera Manager (Local, Optional) 'data' = Scene Data Manager (Local, Optional) 'impact' = Impact Physics (Local, Optional) 'input' = Input Plugin (Local, Optional) 'lights' = Lights Manager Plugin (Local, Optional) 'load' = Loader Plugin (Local, Optional) 'matter' = Matter JS Physics (Local, Optional) 'physics' = Arcade Physics (Local, Optional) 'time' = Time / Clock Plugin (Local, Optional) 'tweens' = Tween Manager (Local, Optional)

If you prefer you can choose not to have any properties added to your Scene at all:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            map: {}
        });
    }

}
```

Or you can change the name of the property that is injected using the `map` object. Here we will replace the English properties with Spanish equivalents:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            map: {
                add: 'agregar',
                anims: 'animaciones',
                cameras: 'camaras',
                events: 'eventos',
                load: 'cargar',
                sound: 'sonido'
            }
        });
    }

    preload ()
    {
        this.cargar.image('face', 'assets/bw-face.png');
    }

    create ()
    {
        this.agregar.image(400, 300, 'face');
    }

}
```

If your IDE supports it, you can even use UTF8, such as this Simplified Chinese version:

```
class BootScene extends Phaser.Scene {

    constructor ()
    {
        super({
            key: 'boot',
            map: {
                add: '加',
                load: '加载'
            }
        });
    }

    preload ()
    {
        this.加载.image('face', 'assets/pics/bw-face.png');
    }

    create ()
    {
        this.加.image(400, 300, 'face');
    }

}
```

## Scene Callbacks[​](#scene-callbacks "Direct link to Scene Callbacks")

The scene callback methods are `init()`, `preload()`, `create()`, and `update()`. The archetypal callback pattern is

```
// Configure this scene cycle
function init(data) {}

// Queue assets for downloading
function preload() {}

// Create game objects with loaded assets
function create(data) {}

// Work on game objects at each game step
function update(time, delta) {}
```

`init()` is less often used.

You can create game objects in any method, but if you've queued assets in `preload()` then you won't be able to use those assets before `create()`.

If you don't use `preload()` then the pattern is simply:

```
// Create game objects
function create(data) {}

// Work on game objects at each game step
function update(time, delta) {}
```

Either `init()` or `create()` can be used.

Within the scene callbacks, [this](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this) is the scene. If you don't much like using `this`, you can assign it to a variable:

```
let scene;

function init() {
  if (scene) throw new Error("Only one scene can use the `scene` variable");

  scene = this;

  scene.events.once("destroy", () => {
    scene = null;
  });
  scene.events.once("shutdown", () => {
    scene = null;
  });
}
```

Or you can destructure it within a callback:

```
function create() {
  const { add, cameras, events } = this;

  add.sprite(/*…*/);
}
```

## Scene creation[​](#scene-creation "Direct link to Scene creation")

Scenes can be created from a class or a config object. They're added to the game through the [Scene Manager](https://newdocs.phaser.io/docs/latest/Phaser.Scenes.SceneManager). This can be done through the game config, the `add()` methods, or (rarely) [load.scene()](https://newdocs.phaser.io/docs/latest/Phaser.Loader.LoaderPlugin-scene).

*   If a config object is given, a new `Phaser.Scene` is instantiated and some of the config values are copied onto it.
*   If a class is given, it's instantiated.
*   The scene is booted.
*   The scene is started, if you indicated so.

Every scene in the Scene Manager's list is an object (instance) that's been booted, and lasts until it's removed (destroyed).

### Scene creation basics[​](#scene-creation-basics "Direct link to Scene creation basics")

#### Using an ES6 class[​](#using-an-es6-class "Direct link to Using an ES6 class")

```
class MyScene extends Phaser.Scene {
  constructor(config) {
    super(config);
  }

  init(data) {}
  preload() {}
  create(data) {}
  update(time, delta) {}
}
```

*   `data` : Parameters passed from [adding new scene](#add-a-scene-from-a-config-object), or [starting scene](#start)

#### Using a Class[​](#using-a-class "Direct link to Using a Class")

```
var MyScene = new Phaser.Class({
  Extends: Phaser.Scene,

  initialize: function MyScene(config) {
    Phaser.Scene.call(this, config);
  },

  init: function (data) {},
  preload: function () {},
  create: function (data) {},
  update: function (time, delta) {},
});
```

*   `data` : Parameters passed from [adding new scene](#add-a-scene-from-a-config-object), or [starting scene](#start)

```
var MyGame = {};

MyGame.Boot = function () {};

MyGame.Boot.prototype.constructor = MyGame.Boot;

MyGame.Boot.prototype = {
  init: function (data) {},
  preload: function () {},
  create: function (data) {},
  update: function (time, delta) {},
};
```

*   `data` : Parameters passed from [adding new scene](#add-a-scene-from-a-config-object), or [starting scene](#start)

#### Overriding default callbacks[​](#overriding-default-callbacks "Direct link to Overriding default callbacks")

```
var demo = new Phaser.Scene("Demo");

demo.init = function (data) {};
demo.preload = function () {};
demo.create = function (data) {};
demo.update = function (time, delta) {};
```

*   `data` : Parameters passed from [adding new scene](#add-a-scene-from-a-config-object), or [starting scene](#start)

### Creating a single-scene game[​](#creating-a-single-scene-game "Direct link to Creating a single-scene game")

It's simplest to use the game config. When only one scene is given, it is started automatically.

#### A scene config in the game config[​](#a-scene-config-in-the-game-config "Direct link to A scene config in the game config")

```
const sceneConfig = {
  create: function () {
    /*…*/
  },
};

new Phaser.Game({
  scene: sceneConfig,
});
```

#### A scene class in the game config[​](#a-scene-class-in-the-game-config "Direct link to A scene class in the game config")

```
class Scene extends Phaser.Scene {
  create() {
    /*…*/
  }
}

new Phaser.Game({
  scene: Scene,
});
```

#### A scene instance in the game config[​](#a-scene-instance-in-the-game-config "Direct link to A scene instance in the game config")

```
class Scene extends Phaser.Scene {
  create() {
    /*…*/
  }
}

new Phaser.Game({
  scene: new Scene(),
});
```

You may also use `scene.add()`, although there's no great advantage in this case. `autoStart` (the third argument) means start the scene at the time that's added.

#### Add a scene from a config object[​](#add-a-scene-from-a-config-object "Direct link to Add a scene from a config object")

```
const sceneConfig = {
  create: function () {
    /*…*/
  },
};

new Phaser.Game({
  callbacks: {
    preBoot: (game) => {
      game.scene.add("default", sceneConfig, true);
    },
  },
});
```

#### Add a scene from a scene class[​](#add-a-scene-from-a-scene-class "Direct link to Add a scene from a scene class")

```
class Scene extends Phaser.Scene {
  create() {
    /*…*/
  }
}

new Phaser.Game({
  callbacks: {
    preBoot: (game) => {
      game.scene.add("default", Scene, true);
    },
  },
});
```

#### Add a scene from a scene instance[​](#add-a-scene-from-a-scene-instance "Direct link to Add a scene from a scene instance")

```
class Scene extends Phaser.Scene {
  create() {
    /*…*/
  }
}

new Phaser.Game({
  callbacks: {
    preBoot: (game) => {
      game.scene.add("default", new Scene(), true);
    },
  },
});
```

Beware that with `scene.add()`, it's possible provide conflicting scene keys:

```
// OOPS
game.scene.add("yin", new Scene("yang"), true);
```

In this case the scene is instantiated with the key 'yang' and then the Scene Manager changes the key to 'yin'.

### Creating a multi-scene game[​](#creating-a-multi-scene-game "Direct link to Creating a multi-scene game")

In a multi-scene game, each scene needs a unique key.

Again, it's easiest to add scenes in the game config. The first scene plus any additional scenes with `{ active: true }` are started automatically.

#### Multiple scene configs in the game config[​](#multiple-scene-configs-in-the-game-config "Direct link to Multiple scene configs in the game config")

```
const bootSceneConfig = { key: 'boot', /*…*/ };
const playSceneConfig = { key: 'play', /*…*/ };
const uiSceneConfig = { key: 'ui', active: true };

new Phaser.Game({
  // 'boot' and 'ui' will be started
  scene: [ bootSceneConfig, playSceneConfig, uiSceneConfig ]
};
```

#### Multiple scene instances in the game config[​](#multiple-scene-instances-in-the-game-config "Direct link to Multiple scene instances in the game config")

```
// Scene classes:
class BootScene {
  /*…*/
}
class PlayScene {
  /*…*/
}
class UIScene {
  /*…*/
}

new Phaser.Game({
  // 'boot' and 'ui' will be started
  scene: [
    new BootScene("boot"),
    new PlayScene("play"),
    new UIScene({ key: "ui", active: true }),
  ],
});
```

You can [configure scenes](#scene-configuration-object) in their constructors instead if you like.

#### Multiple scenes from a base config[​](#multiple-scenes-from-a-base-config "Direct link to Multiple scenes from a base config")

```
const levelSceneConfig = { preload, create, update };
const level1SceneConfig = { ...levelSceneConfig, key: 'level1' };
const level2SceneConfig = { ...levelSceneConfig, key: 'level2' };

new Phaser.Game({
  scene: [ level1SceneConfig, level2SceneConfig ]
};
```

#### Multiple scenes from one class[​](#multiple-scenes-from-one-class "Direct link to Multiple scenes from one class")

```
class LevelScene {/*…*/};

new Phaser.Game({
  scene: [ new LevelScene('level1'), new LevelScene('level2') ]
};
```

##### A 2-scene game[​](#a-2-scene-game "Direct link to A 2-scene game")

```
class Boot extends Phaser.Scene {
  // Load assets
  preload() {}

  // Start Play scene
  create() {}
}

class Play extends Phaser.Scene {
  // Create game objects with loaded assets
  create() {}

  // Update the scene
  update() {}
}

new Phaser.Game({
  scene: [
    // Only 'boot' will start.
    new Boot("boot"),
    new Play("play"),
  ],
});
```

### Listing scenes after game boot[​](#listing-scenes-after-game-boot "Direct link to Listing scenes after game boot")

```
new Phaser.Game({
  scene: [
    /* etc. */
  ],
  callbacks: {
    postBoot: function (game) {
      game.scene.dump();
      // Look for output in console.
    },
  },
});
```

## Scene Configuration Object[​](#scene-configuration-object "Direct link to Scene Configuration Object")

Here is an example of a scene configuration object:

```
var config = {
  key: "",
  // active: false,
  // visible: true,
  // pack: false,
  // cameras: null,
  // map: {},
  // physics: {},
  // loader: {},
  // plugins: false,
  // input: {}
};
```

*   `key` : The unique key of this Scene. Must be unique within the entire Game instance.
    
*   `active` : Does the Scene start as active or not? An active Scene updates each step.
    
*   `visible` : Does the Scene start as visible or not? A visible Scene renders each step.
    
*   `pack` : An optional [Loader Packfile](/phaser/concepts/loader#file-pack) to be loaded before the Scene begins.
    
*   `cameras` : An optional [Camera configuration object](/phaser/concepts/cameras#create-cameras-from-json).
    
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
    

*   `map` : Overwrites the default injection map for a scene.

*   `physics` : The physics configuration object for the Scene.
    
    ```
    {
        default: 'arcade', // 'arcade', or 'matter'
        arcade: {...},
        matter: {...}
    }
    ```
    
    *   `arcade` : [Arcade Physics configuration](/phaser/concepts/physics/arcade#configuration).
    *   `matter` : [Matter Physics configuration](/phaser/concepts/physics/matter#configuration).
*   `loader` : The loader configuration object for the Scene.
    
    ```
    {
        baseURL: '',
        path: '',
        enableParallel: true,
        maxParallelDownloads: 4,
        crossOrigin: undefined,
        responseType: '',
        async: true,
        user: '',
        password: '',
        timeout: 0
    }
    ```
    

*   `plugins` : The plugin configuration object for the Scene.
    
    ```
    {
        global: [
            //{key, plugin, start}
        ],
        scene: [
            // ...
        ]
    }
    ```
    
*   `input` : The input configuration object for the Scene.
    

## Scene life cycle[​](#scene-life-cycle "Direct link to Scene life cycle")

A scene is booted once and can be started any number of times (or never). It lasts until it's removed (destroyed).

A scene that hasn't been added to the manager has status `PENDING`.

A scene that has been added to the manager but never started has status `INIT`. (This means "booted" and is unrelated to the scene `init()` method.)

When a scene starts it goes through statuses `START`, `LOADING` (if assets were queued during `preload()`), `CREATING`, and `RUNNING`. Its methods `init()`, `preload()`, and `create()` are called also, if they exist. `update()` is called at each game step while the scene is in the `RUNNING` state.

A `RUNNING` scene can change to `PAUSED` and back by pause/resume or to `SLEEPING` and back by sleep/wake.

A scene that has been stopped has status `SHUTDOWN`. It can be started again.

A scene that has been removed/destroyed has status `DESTROYED`. It can't be used again.

A scene is **active** only during `START`, `LOADING`, `CREATING`, and `RUNNING`; and **visible** only during `START`, `LOADING`, `CREATING`, `RUNNING`, and `PAUSED`.

### Flowchart: Scene life cycle[​](#flowchart-scene-life-cycle "Direct link to Flowchart: Scene life cycle")

```
graph TB

subgraph Stop
SceneEventDestroy>"scene.events: destroy"]
Shutdown["Shutdown<br>Free game objects"]
end

subgraph Update
SceneUpdate["Run: Every tick<br>scene.update()"]
SceneEventPauseSleep>"scene.events: pause<br>scene.events: sleep"]
Pause["Pause: render but no update<br>Sleep: no update, no render"]
SceneEventResumeWake>"scene.events: resume<br>scene.events: wake"]
end

subgraph Create
SceneEventStart>"scene.events: start"]
SceneEventReady>"scene.events: ready"]
SceneInit["scene.init()"]
ScenePreLoad["Load assets<br>scene.preload()"]
SceneCreate["Create game objects<br>scene.create()"]
end

Start((Start)) --> SceneEventStart
SceneEventStart --> SceneEventReady
SceneEventReady --> SceneInit
SceneInit --> ScenePreLoad
ScenePreLoad --> SceneCreate
SceneCreate --> SceneUpdate
SceneUpdate --> SceneUpdate
SceneUpdate --> |"scene.scene.pause()<br>scene.scene.sleep()"|SceneEventPauseSleep
SceneEventPauseSleep --> Pause
Pause --> |"scene.scene.resume()<br>scene.scene.wake()"|SceneEventResumeWake
SceneEventResumeWake --> SceneUpdate

SceneUpdate --> |"scene.scene.stop()<br>scene.scene.restart()"|Stop
Pause --> |"scene.scene.stop()<br>scene.scene.restart()"|SceneEventDestroy
SceneEventDestroy --> Shutdown

Shutdown --> |"scene.scene.start()<br>scene.scene.launch()<br>scene.scene.restart()"|SceneEventStart
```

*   `Run` : Update and render
*   `Pause` : Render but no update
*   `Sleep` : No update, no render
*   `Stop` : Shutdown

### Changing scenes[​](#changing-scenes "Direct link to Changing scenes")

There are a lot of ways, because it depends on what you want to do, and Phaser lets you run multiple scenes at once.

#### Scene operations[​](#scene-operations "Direct link to Scene operations")

The basic operation pairs are **pause–resume**, **sleep–wake**, and **shutdown–start**.

Usually, with a typical gameplay scene, you will enter the scene with **start** and exit with **shutdown**. Gameplay starts over each time.

But to move to an intermission scene and back, you might exit the gameplay scene with **sleep** and then reenter with **wake**. It's hidden in the meantime, but then the player returns to the same state they left.

And to move to a modal scene and back, you might exit the gameplay scene with **pause** and then reenter with **resume**. In this case it's still visible but suspended.

With scenes like menu or title screens that you expect the player to revisit, you have a choice of **sleep–wake** or **shutdown–start**. The sleep–wake pattern may be more manageable. It's easier to reason about scenes that start only once.

#### Scene control methods[​](#scene-control-methods "Direct link to Scene control methods")

##### The simple methods[​](#the-simple-methods "Direct link to The simple methods")

*   `launch()` and `stop()` do start and shutdown.
*   `sleep()` and `wake()` do sleep and wake.
*   `pause()` and `resume()` do pause and resume.

##### The conditional methods[​](#the-conditional-methods "Direct link to The conditional methods")

*   `run()` may start, wake, or resume a scene
*   `switch()` may start or wake a scene

##### The "double" methods[​](#the-double-methods "Direct link to The \"double\" methods")

These affect both the target scene and the calling scene. They're convenient for moving through scenes one at a time.

*   `start()` stops the calling scene.
*   `switch()` sleeps the calling scene.

##### start()[​](#start "Direct link to start()")

`start('target')` starts the target scene and stops the calling scene. It's equivalent to `stop().launch('target')`.

If you want to start a second scene without stopping anything, use `launch('target')` instead.

```
// In scene A: stop A, start B
this.scene.start("B");

// In scene B: stop B, start C
this.scene.start("C");

// In scene C: stop C, start A again
this.scene.start("A");
```

##### switch()[​](#switch "Direct link to switch()")

`switch('target')` starts or wakes the target scene and sleeps the calling scene.

```
// In scene A: sleep A, start B
this.scene.switch("B");

// In scene B: sleep B, start C
this.scene.switch("C");

// In scene C: sleep C, *wake* A
this.scene.switch("A");
```

Here each scene is started only once, and never shut down.

A `switch()` equivalent is

```
this.scene.sleep();

if (this.scene.isSleeping('target') {
  this.scene.wake('target');
} else {
  this.scene.launch('target');
}
```

`switch()` **restarts** a paused scene, never resumes it — cf. `run()`.

##### launch()[​](#launch "Direct link to launch()")

`launch()` starts or restarts the target scene. It never resumes or wakes — cf. `run()`.

##### run()[​](#run "Direct link to run()")

`run()` resumes the target scene if paused; wakes it if sleeping; restarts it if running; and starts it otherwise.

### Problems restarting a scene[​](#problems-restarting-a-scene "Direct link to Problems restarting a scene")

Some common causes:

*   Your own state variables haven't been reset
*   You're working on an invalid object from the previous scene cycle, e.g., a game object or camera
    *   Often, a destroyed game object's method is still registered to an event emitter

#### Example: bad state after restart[​](#example-bad-state-after-restart "Direct link to Example: bad state after restart")

```
let gameOver = false;

function update() {
  if (gameOver) {
    // GAME OVER :(
  }
}
```

After restarting the scene it's _GAME OVER_ immediately, because the `gameOver` variable hasn't been reset. Rewrite as

```
let gameOver;

function init() {
  gameOver = false;
}

function update() {
  if (gameOver) {
    // GAME OVER :(
  }
}
```

In a scene class, you might introduce the same problem in the scene constructor:

```
class Scene extends Phaser.Scene {
  constructor() {
    super();

    this.gameOver = false;
  }
}
```

Rewrite it similarly:

```
class Scene extends Phaser.Scene {
  constructor() {
    super();

    this.gameOver;
  }

  init() {
    this.gameOver = false;
  }
}
```

#### Example: invalid game objects after restart[​](#example-invalid-game-objects-after-restart "Direct link to Example: invalid game objects after restart")

```
const sprites = [];

function create() {
  sprites.push(this.physics.add.sprite(/*…*/));
}

function update(time) {
  for (const sprite of sprites) {
    sprite.setVelocity(1, 1);
    // > TypeError: undefined is not an object (evaluating 'this.body.setVelocityX')
  }
}
```

Here you get an error after restarting the scene. The destroyed sprites from the last cycle are still in the `sprites` array. Rewrite as

```
function create() {
  // …

  this.events.once("shutdown", () => {
    sprites.length = 0;
  });
}
```

### Removing a scene[​](#removing-a-scene "Direct link to Removing a scene")

If you never use a scene again, you can remove it:

```
this.scene.destroy();
```

#### Replacing a scene with the same key[​](#replacing-a-scene-with-the-same-key "Direct link to Replacing a scene with the same key")

You can't reuse the key until the original scene is removed.

##### A scene removing itself[​](#a-scene-removing-itself "Direct link to A scene removing itself")

```
// After destruction, `this.scene` and `this.sys.scenePlugin` are unusable.
// So we need to use the manager directly.
const { manager } = this.scene;

this.events.once('destroy', () => {
  manager.add('key', newScene);
}

this.scene.remove();
```

##### A second scene removing the first[​](#a-second-scene-removing-the-first "Direct link to A second scene removing the first")

```
sceneToRemove.events.once('destroy', () => {
  this.scene.add('key', newScene);
}

this.scene.remove(sceneToRemove);
```

##### An alternative[​](#an-alternative "Direct link to An alternative")

Instead of juggling scene keys, you can use dynamic keys.

```
this.registry.set("levelSceneKey", "level1");

this.scene.remove(this.registry.get("levelSceneKey"));

this.registry.set("levelSceneKey", "level2");

this.scene.add(this.registry.get("levelSceneKey"), Level, true);
```

## Scene systems and plugins[​](#scene-systems-and-plugins "Direct link to Scene systems and plugins")

Scenes have their own systems, [core plugins](https://newdocs.phaser.io/docs/latest/Phaser.Plugins.DefaultPlugins.CoreScene) that are always installed and [default plugins](https://newdocs.phaser.io/docs/latest/Phaser.Plugins.DefaultPlugins.DefaultScene) that are installed unless disabled. Any extra scene plugins you've added in the game config with `{ start: true }` or any `{ mapping: … }` are also default plugins.

If you've added a scene plugin to the game config without those, the plugin isn't installed by default, and you can install it in a specific scene by adding its key to the `plugins` array:

```
new Phaser.Scene({
  plugins: [
    ...Phaser.Plugins.DefaultPlugins.DefaultScene,
    "SomeOtherPluginKey",
  ],
});
```

You can also remove default plugins this way:

```
new Phaser.Scene({
  // "DataManagerPlugin", "Loader", and "LightsPlugin" are omitted.
  plugins: ["Clock", "InputPlugin", "TweenManager"],
});
```

Physics plugins are different. They are installed in a scene if the game config's `physics.default` is `'arcade'` or `'matter'` or if the scene settings config includes `physics.arcade` or `physics.matter` config objects (even if empty).

### Table: Systems and plugins[​](#table-systems-and-plugins "Direct link to Table: Systems and plugins")

The table below is a list of systems and plugins (bolded in the table below) as well as references to some global systems.

These can be [mapped onto different property names](https://labs.phaser.io/edit.html?src=src%5Cscenes%5Cscene%20injection%20map.js) if you like.

Scene

Systems

Notes

**add**

sys.add

Core plugin

anims

sys.anims

cache

sys.cache

**cameras**

sys.cameras

Core plugin

**children**

sys.displayList

Core plugin

**data**

sys.data

Default plugin

**events**

sys.events

Core plugin. Different from `game.events`.

facebook

sys.facebook

game

sys.game

**input**

sys.input

Default plugin

**lights**

sys.lights

Default plugin

**load**

sys.load

Default plugin

**make**

sys.make

Core plugin

**matter**

sys.matterPhysics

Optional plugin

**physics**

sys.arcadePhysics

Optional plugin

plugins

sys.plugins

registry

sys.registry

renderer

sys.renderer

scale

sys.scale

**scene**

sys.scenePlugin

Core plugin

sound

sys.sound

textures

sys.textures

**time**

sys.time

Default plugin

**tweens**

sys.tweens

Default plugin

## Rendering[​](#rendering "Direct link to Rendering")

Scenes render from first to last (bottom to top). You can rearrange them with Scene Manager methods like `bringToTop()`, or `sendToBack()`, but this is unusual, except for some visual effects. Don't use these methods to "fix" visibility problems when changing scenes — you should probably be using sleep/wake or start/stop instead. Remember you can add all your scene definitions to the game config and so establish the rendering order there, even for scenes that aren't started immediately.

You can toggle a scene's visibility with `scene.setVisible()`. This doesn't change the scene's status.

## Scene Events[​](#scene-events "Direct link to Scene Events")

*   Start (Before `scene.init()`)
    
    ```
    scene.events.on("start", function () {});
    ```
    

*   Ready (After `start`)
    
    ```
    scene.events.on("ready", function () {});
    ```
    
*   Every tick
    
    *   Preupdate
        
        ```
        scene.events.on("preupdate", function (time, delta) {});
        ```
        
    *   Update
        
        ```
        scene.events.on("update", function (time, delta) {});
        ```
        
    *   Postupdate
        
        ```
        scene.events.on("postupdate", function (time, delta) {});
        ```
        
    *   Render
        
        ```
        scene.events.on("render", function () {});
        ```
        
*   State changed
    
    *   Pause (from `scene.scene.pause()`)
        
        ```
        scene.events.on("pause", function () {});
        ```
        
    *   Resume (from `scene.scene.resume()`)
        
        ```
        scene.events.on("resume", function () {});
        ```
        
    *   Sleep (from `scene.scene.sleep()`)
        
        ```
        scene.events.on("sleep", function () {});
        ```
        
    *   Wake (from `scene.scene.wake()`)
        
        ```
        scene.events.on("wake", function () {});
        ```
        
    *   Stop/shutdown (from `scene.scene.stop()`)
        
        ```
        scene.events.on("shutdown", function () {});
        ```
        
        *   **Free-up any resources that may be in use by this scene**

*   Destroy (from `scene.scene.remove()`)
    
    ```
    scene.events.on("destroy", function () {});
    ```
    

*   Resize
    
    ```
    scene.events.on("resize", function () {});
    ```
    
*   Boot
    
    ```
    scene.events.on("boot", function () {});
    ```
    
*   Game object added to scene
    
    *   Add
        
        ```
        scene.events.on("addedtoscene", function (gameObject, scene) {});
        ```
        
    *   Remove
        
        ```
        scene.events.on("removedfromscene", function (gameObject, scene) {});
        ```
        

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
