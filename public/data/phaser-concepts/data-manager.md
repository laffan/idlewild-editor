# Data Manager

The Data Manager is a component that allows you to store, query and get key/value paired information. This information is isolated to the parent of the Data Manager.

By default in Phaser 3 there is one instance of the Data Manager that belongs to the Game, which is known as the 'registry'. In addition to this, every Scene has a Data Manager instance. And finally, all Game Objects are able to have a Data Manager instance as well. Plus, should you need to, you can create your own instances and manage those.

## Data Manager Parents[​](#data-manager-parents "Direct link to Data Manager Parents")

A Data Manager needs to be bound to a parent. There are four types of parent that a Data Manager can belong to: The Game, a Scene, a Game Object or a custom object.

### Game Object Data Manager[​](#game-object-data-manager "Direct link to Game Object Data Manager")

All Game Objects have a property called `data`. This is `null` by default, but is set to hold an instance of the `DataManager` class if the method `setDataEnabled` is called on the Game Object:

```
const sprite = this.add.sprite();

sprite.setDataEnabled();
```

Alternatively, if any of the following data related methods: `setData`, `incData`, `toggleData` or `getData` are called, they will also trigger the creation of a Data Manager belonging to the Game Object. Those methods are covered in more detail further in this section.

Once the Data Manager exists it can act as a store for any data you would like to bind to that specific Game Object.

### Scene Data Manager Plugin[​](#scene-data-manager-plugin "Direct link to Scene Data Manager Plugin")

Every Scene has its own instance of the Data Manager Plugin. This is accessed via the `data` property from within a Scene, for example:

```
class MyScene extends Phaser.Scene
{
    constructor ()
    {
        super('myScene');
    }

    create ()
    {
        this.data.set('lives', 3);
    }
}
```

The Data Manager Plugin is exactly the same as the Data Manager, including all of the same features and methods, but is constructed to function as a Scene Plugin.

### Game Data Manager[​](#game-data-manager "Direct link to Game Data Manager")

The Game instance also has a Data Manager, which is accessed via the `registry` property from within a Scene:

```
class MyScene extends Phaser.Scene
{
    constructor ()
    {
        super('myScene');
    }

    create ()
    {
        this.registry.set('lives', 3);
    }
}
```

Unlike the Scene's Data Manager, this one is owned by the Game instance itself. It is created automatically by during the boot process and is then available in all Scenes via the `registry` property.

This means that any data set into the registry in one Scene is instantly available in all other Scenes in your game. It also means you can use it as a place to store global data, such as highscores, level data, settings and more.

### Custom Data Manager Instances[​](#custom-data-manager-instances "Direct link to Custom Data Manager Instances")

You can create your own instances of a Data Manager. A Data Manager must always have a parent and an Event Emitter it can use. While the parent is typically a Game Object or Scene, it can be any custom object you wish to bind to.

Here's an example of a class that can function as your own Data Manager:

```
class CustomDataManager extends Phaser.Data.DataManager
{
    constructor ()
    {
        super(this, new Phaser.Events.EventEmitter());
    }
}

const myData = new CustomDataManager();
```

The first parameter is the parent of the Data Manager, in this case the class itself. The second parameter is the Event Emitter instance it will use. You can use any Event Emitter you like, but it must have an instance of one.

## Data Manager Methods[​](#data-manager-methods "Direct link to Data Manager Methods")

Once a Data Manager has been created or referenced, you're ready to store data within it.

### Set Data[​](#set-data "Direct link to Set Data")

The first thing you'll want to do is set some data. You can do this using the `set` method:

```
//  In the Registry
this.registry.set('playerName', 'Vasquez');

//  From within a Scene
this.data.set('playerName', 'Vasquez');

//  On a Game Object instance
sprite.setData('playerName', 'Vasquez');
//  or:
sprite.data.set('playerName', 'Vasquez');
```

The `set` method takes two arguments: A key and a value. The _key_ is a unique string that acts as the identifier for this value, i.e. `playerName`. As with most things in JavaScript, the key is case-sensitive, so `playerName` is not the same as `PlayerName`. It must also be a valid string. Keep this in mind when setting and getting data.

The second argument is the _value_ and this can be anything you like: a string, an integer, an array, an object, or even a reference to another class or function.

If the data is successfully set, a `SET_DATA` event will be emitted.

Or, if the key already existed in the Data Manager then its previous value will be overwritten with the new one and a `CHANGE_DATA` event will be emitted instead. Please see the Events section for more details.

#### Setting Multiple Values[​](#setting-multiple-values "Direct link to Setting Multiple Values")

You can set multiple values in one call by passing an object to the `set` method:

```
//  In the Registry
this.registry.set({ playerName: 'Hicks', weapon: 'M41A Pulse Rifle', score: 0 });

//  From within a Scene
this.data.set({ playerName: 'Hicks', weapon: 'M41A Pulse Rifle', score: 0 });

//  On a Game Object instance
sprite.setData({ playerName: 'Hicks', weapon: 'M41A Pulse Rifle', score: 0 });
//  or:
sprite.data.set({ playerName: 'Hicks', weapon: 'M41A Pulse Rifle', score: 0 });
```

In this case 3 new values will be set into the Data Manager, with the keys `playerName`, `weapon` and `score`. A `SET_DATA` event will be emitted for each one. If, for example, two of the values were new and one was updating a previous value, then you'd get 2 `SET_DATA` events and 1 `CHANGE_DATA` event.

The object passed to the `set` method is only recursed one-level deep. If you pass a nested object, such as:

```
this.data.set({ playerName: 'Hicks', weapon: { name: 'M41A Pulse Rifle', ammo: 10 }, score: 0 });
```

Then the `weapon` object will be set as the value of the `weapon` entry itself, not the individual properties within it.

#### Merge an existing Object into the Data Manager[​](#merge-an-existing-object-into-the-data-manager "Direct link to Merge an existing Object into the Data Manager")

You can populate the Data Manager with key/value pairs from an existing object by using the `merge` method:

```
const weapon = { name: 'M41A Pulse Rifle', ammo: 10 };

//  In the Registry
this.registry.merge(weapon, true);

//  From within a Scene
this.data.merge(weapon, true);

//  On a Game Object instance
sprite.data.merge(weapon, true);
```

The first argument is the object to merge into the Data Manager. The second argument is the boolean `overwrite`. If `true` it will overwrite any existing values in the Data Manager with the values from the object. If `false` it will skip any keys that already exist in the Data Manager.

If the key didn't exist in the Data Manager, it will be created and a `SET_DATA` event will be emitted. If the key did exist and `overwrite` was `true`, it will be updated and a `CHANGE_DATA` event will be emitted.

All of the same rules apply as with the `set` method, in that the object is only recursed one-level deep, keys are case-sensitive, etc.

#### Using Objects as Values[​](#using-objects-as-values "Direct link to Using Objects as Values")

While you can use objects as values, you should be careful when doing so. For example:

```
const weapon = { name: 'M41A Pulse Rifle', ammo: 10 };

this.data.set({ playerName: 'Hicks', weapon });
```

In the above, the `weapon` value is a _reference_ to the object itself. The Data Manager will not make a copy of it. This means that if you later directly update the `weapon` object, the value stored in the Data Manager will also be updated. For example:

```
weapon.ammo = 20;
```

However, doing so will not emit any events and you will lose the benefits of using the Data Manager in the first place.

### Get Data[​](#get-data "Direct link to Get Data")

Once you've stored some data you can retrieve it again using the `get` method:

```
//  In the Registry
this.registry.get('playerName');

//  From within a Scene
this.data.get('playerName');

//  On a Game Object instance
sprite.getData('playerName');
//  or:
sprite.data.get('playerName');
```

If the key exists in the Data Manager then the value will be returned. If the key doesn't exist, `undefined` will be returned instead.

To get several values at once, pass an array of keys:

```
//  In the Registry
this.registry.get([ 'playerName', 'score' ]);

//  From within a Scene
this.data.get([ 'playerName', 'score' ]);

//  On a Game Object instance
sprite.getData([ 'playerName', 'score' ]);
//  or:
sprite.data.get([ 'playerName', 'score' ]);
```

If you pass an array in, then an array of values will be returned, in the same order as the keys given. If a key doesn't exist, `undefined` will be returned in its place.

This is especially useful for destructuring:

```
const { playerName, score } = this.data.get([ 'playerName', 'score' ]);
```

### Data Values[​](#data-values "Direct link to Data Values")

When you get data, what you're getting in most cases is a _copy_ of that data. For example, if the data is a string, number or boolean, then calling `get` will return that value. If you then manipulate the value, the Data Manager will not be aware of this change. For example:

```
const score = this.data.get('score');

score += 10;
```

In this case the `score` value is a copy of the value stored in the Data Manager. Although you modified it by adding 10 to it, the Data Manager will not be aware of this change. If you then call `get` again, the value returned will be the original value, not the updated one.

To avoid this situation, use the `values` property of the Data Manager:

```
const score = this.data.values.score;

score += 10;
```

Any value set in the Data Manager is available via the `values` property.

Here, `score` is a reference to a special value stored in the Data Manager. This time, if you add 10 to it, the Data Manager will be aware of this change and will emit the `CHANGE_DATA` event, too. If you call `get` again, the value returned will be the updated one.

You can also modify the values directly, such as:

```
this.data.values.score += 10;
```

Again, this is a 'safe' way to modify the values in the Data Manager, as it will emit the `CHANGE_DATA` event and the value will be updated.

### Increment Data[​](#increment-data "Direct link to Increment Data")

The `inc` method will increment a value by the given amount. If the value doesn't already exist in the Data Manager, it will be created and given the value of the amount:

```
//  In the Registry
this.registry.inc('score', 10);

//  From within a Scene
this.data.inc('score', 10);

//  On a Game Object instance
sprite.incData('score', 10);
//  or:
sprite.data.inc('score', 10);
```

In this case, if the `score` value didn't already exist, it will be created and given the value of 10. If it did exist, it will be incremented by 10. As with other forms of setting data, the relevant events will also be emitted, depending on if the value was created or updated.

To reduce a value, simply pass a negative amount:

```
this.data.inc('score', -10);
```

Note that the `inc` feature only works if the value is a standard JavaScript number data type. If you try to increment a string, it will append the value onto the end of the string. I.e. a value of `"10"` will become `"1010"`. If you try and increment a boolean, it will be converted to a number first, i.e. `true` becomes `1` and `false` becomes `0`. Adding numeric values to objects by mistake will actually destroy the original object and replace it with the string `[object Object]` with your number appended to it! So be sure to only call `inc` on number data types.

Fundamentally, there's no difference between calling the `inc` method and just modifying the value via the `values` property, except that the `inc` method call is chainable.

### Toggle Data[​](#toggle-data "Direct link to Toggle Data")

The `toggle` method will toggle a boolean value between `true` and `false`:

```
//  In the Registry
this.registry.toggle('musicEnabled');

//  From within a Scene
this.data.toggle('musicEnabled');

//  On a Game Object instance
sprite.toggleData('musicEnabled');
//  or:
sprite.data.toggle('musicEnabled');
```

If the value doesn't already exist in the Data Manager, it will be created and given the value of `true`. If it did exist, it will be toggled to the opposite boolean value. As with other forms of setting data, the relevant events will also be emitted, depending on if the value was created or updated.

### Freezing Data[​](#freezing-data "Direct link to Freezing Data")

The Data Manager has the ability to be 'frozen'. If you enable this, then no further data can be added or removed from the Data Manager, and values already stored within it cannot be modified. This is useful if you wish to lock-down a Data Manager and make it read-only.

To freeze, or un-freeze a Data Manager, call the chainable `setFreeze` method:

```
//  In the Registry
this.registry.setFreeze(true);

//  From within a Scene
this.data.setFreeze(true);

//  On a Game Object instance
sprite.data.setFreeze(true);
```

Or, you can modify the `freeze` property directly:

```
//  In the Registry
this.registry.freeze = true;

//  From within a Scene
this.data.freeze = true;

//  On a Game Object instance
sprite.data.freeze = true;
```

Changing the frozen state of the Data Manager is immediate. For example, if you are adding an object containing several new values, and in the `SET_DATA` event listener you call `setFreeze(true)`, then the remaining values will never be added.

### Removing Data[​](#removing-data "Direct link to Removing Data")

You can remove a single item of data from the Data Manager using the `remove` method:

```
//  In the Registry
this.registry.remove('playerName');

//  From within a Scene
this.data.remove('playerName');

//  On a Game Object instance
sprite.data.remove('playerName');
```

If the key exists in the Data Manager it will be removed and a `REMOVE_DATA` event will be emitted. If the key doesn't exist, nothing happens.

You can remove multiple values at once by passing an array of strings to the `remove` method:

```
//  In the Registry
this.registry.remove([ 'playerName', 'score' ]);

//  From within a Scene
this.data.remove([ 'playerName', 'score' ]);

//  On a Game Object instance
sprite.data.remove([ 'playerName', 'score' ]);
```

The Data Manager also provides the `pop` method. This works in the same way as `remove`, except it returns the value that was removed:

```
//  In the Registry
const playerName = this.registry.pop('playerName');

//  From within a Scene
const playerName = this.data.pop('playerName');

//  On a Game Object instance
const playerName = sprite.data.pop('playerName');
```

If the key doesn't exist in the Data Manager, `undefined` is returned.

Each key successfully removed, regardless of the method used to remove it, will emit a `REMOVE_DATA` event.

As with setting data, if the Data Manager has been frozen, no values will be removed.

### Reset the Data Manager[​](#reset-the-data-manager "Direct link to Reset the Data Manager")

You can reset the Data Manager, removing all data it contains, by calling the `reset` method:

```
//  In the Registry
this.registry.reset();

//  From within a Scene
this.data.reset();

//  On a Game Object instance
sprite.data.reset();
```

This will remove all data from the Data Manager and reset its frozen status to false. No events are emitted by this method. It's just a fast way to clear out a Data Manager entirely, should you wish to do so.

### Querying the Data Manager[​](#querying-the-data-manager "Direct link to Querying the Data Manager")

There are several methods available for querying the Data Manager.

#### has[​](#has "Direct link to has")

The first, and most simple, is the `has` method. This checks to see if the Data Manager has a key matching the given string:

```
//  In the Registry
this.registry.has('playerName');

//  From within a Scene
this.data.has('playerName');

//  On a Game Object instance
sprite.data.has('playerName');
```

If the key exists in the Data Manager it will return `true`, otherwise it will return `false`. As with all uses of keys in JavaScript, please remember this is highly case-sensitive.

#### count[​](#count "Direct link to count")

To return the total number of entries currently being stored in the Data Manager, use the `count` property:

```
//  In the Registry
this.registry.count;

//  From within a Scene
this.data.count;

//  On a Game Object instance
sprite.data.count;
```

This is a numeric value that represents the total number of entries in the Data Manager.

#### getAll[​](#getall "Direct link to getAll")

To return everything within the Data Manager, use the `getAll` method:

```
//  In the Registry
this.registry.getAll();

//  From within a Scene
this.data.getAll();

//  On a Game Object instance
sprite.data.getAll();
```

This will return a new object containing all of the data stored in the Data Manager. For example:

```
{
    playerName: 'Hicks',
    weapon: 'M41A Pulse Rifle',
    score: 0
}
```

If the Data Manager is empty, an empty object is returned.

When using `getAll` you should treat the returned object as read-only. If you modify it directly, the Data Manager will not be aware of the changes.

#### each[​](#each "Direct link to each")

The `each` method allows you to pass all entries in the Data Manager to a given callback. You pass the callback as the first argument, an optional context as the second and then any further arguments:

```
//  In the Registry
this.registry.each((parent, key, value) => {
    console.log(key, value);
});

//  From within a Scene
this.data.each((parent, key, value) => {
    console.log(key, value);
});

//  On a Game Object instance
sprite.data.each((parent, key, value) => {
    console.log(key, value);
});
```

The callback will be sent three arguments: The parent of the Data Manager, the key and the value. If you specified additional arguments, they will be sent after these three.

The Data Manager does not use, or expect a return value from the callback, so if you wish to modify a value sent to your callback, you must do so via the normal Data Manager methods.

#### query[​](#query "Direct link to query")

The `query` method allows you to search the Data Manager for keys that match the given Regular Expression. It will then return an object containing any matching key/value pairs.

For example, let's assume we have populated the Data Manager with a number of different weapons:

```
this.data.set({
    'M41A Pulse Rifle': 10,
    'M56 Smartgun': 20,
    'M240 Flamethrower': 30,
    'M42A Scope Rifle': 40,
    'M83 SADAR': 50,
    'M92 Grenade Launcher': 60
});
```

We can then use the `query` method to return all weapons that contain the word 'Rifle':

```
const rifles = this.data.query(/Rifle/);
```

The returned object will contain all matching key/value pairs:

```
{
    'M41A Pulse Rifle': 10,
    'M42A Scope Rifle': 40
}
```

If no matches are found, an empty object is returned.

The `query` method accepts any valid regular expression.

#### The `list` and `values` properties[​](#the-list-and-values-properties "Direct link to the-list-and-values-properties")

The `list` property is an array containing all of the keys in the Data Manager:

```
//  In the Registry
this.registry.list;

//  From within a Scene
this.data.list;

//  On a Game Object instance
sprite.data.list;
```

The `values` property is an array containing all of the values in the Data Manager:

```
//  In the Registry
this.registry.values;

//  From within a Scene
this.data.values;

//  On a Game Object instance
sprite.data.values;
```

These objects should be treated as read-only and never modified directly. However, they are made public so that you can use them from any of the regular JavaScript methods, such as destructuring, `map`, `forEach` and so on.

## Data Manager Events[​](#data-manager-events "Direct link to Data Manager Events")

When the Data Manager is created it has to be given an Event Emitter to use. This means there are a few different ways to listen to the Data Manager events, depending on where you are setting the data. Here are the different ways you can listen for Data Manager events.

The Game Data Manager (the Registry) will emit events from itself:

```
//  From within a Scene:
this.registry.events.on('setdata', (parent, key, value) => {
    console.log('Registry set:', key, value);
});
```

A Scene Data Manager will emit events via the Scene Systems, which is mapped to the `events` property from within a Scene:

```
//  From within a Scene:
this.events.on('setdata', (parent, key, value) => {
    console.log('Scene data set:', key, value);
});
```

A Game Object Data Manager will emit events via the Game Object itself:

```
sprite.on('setdata', (parent, key, value) => {
    console.log('Sprite data set:', key, value);
});
```

Finally, if you have created your own instance of the Data Manager, then you would have provided an Event Emitter when you did this. It's this emitter you should listen tgo events from.

## Destroying the Data Manager[​](#destroying-the-data-manager "Direct link to Destroying the Data Manager")

If the Data Manager belongs to a Game (i.e. the Registry), a Scene, or a Game Object, then it is automatically destroyed when the parent object is destroyed. However, if you created your own Data Manager instance, then you are responsible for destroying it when it is no longer needed.

To do this, call the `destroy` method:

```
myData.destroy();
```

This will emit a `DESTROY` event, remove all listeners and clear-up any references it holds to other objects.

Note that if a Scene is shutdown, rather than destroyed, then the Data Manager will persist and retain all data within it. If you want to clear the data from the Data Manager when the Scene is shutdown, then you should listen for the shutdown event and call `reset` on its Data Manager:

```
class MyScene extends Phaser.Scene
{
    constructor ()
    {
        super('myScene');
    }

    create ()
    {
        this.data.set('lives', 3);

        this.events.once('shutdown', this.shutdown, this);
    }

    shutdown ()
    {
        this.data.reset();
    }
}
```

### Using JSON[​](#using-json "Direct link to Using JSON")

You can take the contents of the Data Manager and convert it to JSON via:

```
const json = JSON.stringify(data.list);
```

Where `data` is a reference to the Data Manager, which could belong to the Game or a Game Object.

You can also do the opposite:

```
data.reset().merge(JSON.parse(json));
```

Where `json` is your well-formed JSON data.
