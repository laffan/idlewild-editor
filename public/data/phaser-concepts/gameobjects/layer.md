# Layer

A Layer is a special type of Game Object that acts as a Display List. You can add any type of Game Object to a Layer, just as you would to a Scene. Layers can be used to visually group together 'layers' of Game Objects:

```
const spaceman = this.add.sprite(150, 300, 'spaceman');
const bunny = this.add.sprite(400, 300, 'bunny');
const elephant = this.add.sprite(650, 300, 'elephant');

const layer = this.add.layer();

layer.add([ spaceman, bunny, elephant ]);
```

The 3 sprites in the example above will now be managed by the Layer they were added to. Therefore, if you then set `layer.setVisible(false)` they would all vanish from the display.

You can also control the depth of the Game Objects within the Layer. For example, calling the `setDepth` method of a child of a Layer will allow you to adjust the depth of that child within the Layer itself, rather than the whole Scene. The Layer, too, can have its depth set as well.

The Layer class also offers many different methods for manipulating the list, such as the methods `moveUp`, `moveDown`, `sendToBack`, `bringToTop` and so on. These allow you to change the display list position of the Layers children, causing it to adjust the order in which they are rendered. Using `setDepth` on a child allows you to override this.

Layers can have Post FX Pipelines set, which allows you to easily enable a post pipeline across a whole range of children, which, depending on the effect, can often be far more efficient that doing so on a per-child basis.

Layers have no position or size within the Scene. This means you cannot enable a Layer for physics or input, or change the position, rotation or scale of a Layer. They also have no scroll factor, texture, tint, origin, crop or bounds.

If you need those kind of features then you should use a Container instead. Containers can be added to Layers, but Layers cannot be added to Containers.

However, you can set the Alpha, Blend Mode, Depth, Mask and Visible state of a Layer. These settings will impact all children being rendered by the Layer.

## Add layer[​](#add-layer "Direct link to Add layer")

```
var layer = this.add.layer();
// var layer = this.add.layer(children);
```

*   `children` : Array of game objects added to this layer.

## Custom class[​](#custom-class "Direct link to Custom class")

```
class MyLayer extends Phaser.GameObjects.Layer {
    constructor(scene, children) {
        super(scene, children);
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

Example

```
var layer = new MyLayer(scene, children);
```

## Add child[​](#add-child "Direct link to Add child")

*   Add child
    
    ```
    layer.add(gameObject);
    // layer.add(gameObjects);
    ```
    
    *   `gameObject` : A game object, or an array of game objects.
*   Add child at
    
    ```
    layer.addAt(gameObject, index);
    ```
    
*   Replace child
    
    ```
    layer.replace(oldGameObject, newGameObject);
    ```
    

## Remove child[​](#remove-child "Direct link to Remove child")

*   Remove child
    
    ```
    var removed = layer.remove(gameObject);
    ```
    
*   Remove child at
    
    ```
    var removed = layer.removeAt(index);
    ```
    
*   Remove children between indexes
    
    ```
    var removed = layer.removeBetween(startIndex, endIndex);
    ```
    
*   Remove all children
    
    ```
    layer.removeAll();
    ```
    

Removed game object won't be added to display list of scene, use

```
gameObject.addToDisplayList();
```

to add it back to scene's display list.

## Get child[​](#get-child "Direct link to Get child")

*   Get child at
    
    ```
    var gameObject = layer.getAt(index);
    ```
    
*   Get first child by name
    
    ```
    var gameObject = layer.getByName(name);
    ```
    
*   Get first child by property
    
    ```
    var gameObject = layer.getFirst(property, value);
    // var gameObject = layer.getFirst(property, value, startIndex, endIndex);
    ```
    
*   Get random child
    
    ```
    var gameObject = layer.getRandom();
    // var gameObject = layer.getRandom(startIndex, length);
    ```
    
*   Get all children
    
    ```
    var gameObjects = layer.getAll();
    ```
    
*   Get index of child
    
    ```
    var index = layer.getIndex(gameObject);
    ```
    
*   Get child count
    
    ```
    var count = layer.count(property, value);
    ```
    
*   Get total children count
    
    ```
    var count = layer.length;
    ```
    
*   Has child
    
    ```
    var hasChild = layer.exists(gameObject);
    ```
    

### Iterate[​](#iterate "Direct link to Iterate")

*   Get first child (set iterator index to 0)
    
    ```
    var gameObject = layer.first;
    ```
    
*   Get last child (set iterator index to last)
    
    ```
    var gameObject = layer.last;
    ```
    
*   Get next child (increase iterator index, until last)
    
    ```
    var gameObject = layer.next;
    ```
    
*   Get previous child (decrease iterator index, until 0)
    
    ```
    var gameObject = layer.previous;
    ```
    

## Move child[​](#move-child "Direct link to Move child")

*   Swap
    
    ```
    layer.swap(gameObject1, gameObject2);
    ```
    
*   Move to
    
    ```
    layer.moveTo(gameObject, index);
    ```
    
*   Bring to top
    
    ```
    layer.bringToTop(gameObject);
    ```
    
*   Send to back
    
    ```
    layer.sendToBack(gameObject);
    ```
    
*   Move up
    
    ```
    layer.moveUp(gameObject);
    ```
    
*   Move down
    
    ```
    layer.moveDown(gameObject);
    ```
    
*   Move child1 above child2
    
    ```
    layer.moveAbove(child1, child2);
    ```
    
*   Move child1 below child2
    
    ```
    layer.moveBelow(child1, child2);
    ```
    
*   Sort
    
    ```
    layer.sort(property);
    ```
    
    or
    
    ```
    layer.sort('', function(gameObject1, gameObject2) { 
        return 1; // 0, or -1
    });
    ```
    
*   Reverse
    
    ```
    layer.reverse();
    ```
    
*   Shuffle
    
    ```
    layer.shuffle();
    ```
    

!!! note Sort by depth Children game objects also sort by depth.

## For each child[​](#for-each-child "Direct link to For each child")

```
layer.each(function(gameObject) {

}, scope);
```

## Set property[​](#set-property "Direct link to Set property")

```
layer.setAll(property, value);
// layer.setAll(property, value, startIndex, endIndex);
```

## Events[​](#events "Direct link to Events")

*   On add game object
    
    ```
    layer.events.on('addedtoscene', function(gameObject, scene) {
    
    })
    ```
    
*   On remove game object
    
    ```
    layer.events.on('removedfromscene', function(gameObject, scene) {
    
    })
    ```
    

`layer.events` references to `this.events`.

## Other properties[​](#other-properties "Direct link to Other properties")

See [game object](/phaser/concepts/gameobjects)

## Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = layer.createBitmapMask();
```

See [mask](/phaser/concepts/display#masks)

## Shader effects[​](#shader-effects "Direct link to Shader effects")

Support [postFX effects](/phaser/concepts/gameobjects/shader)

!!! note No preFX effect support

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
