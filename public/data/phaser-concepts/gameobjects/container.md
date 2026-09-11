# Container

A Container, as the name implies, can 'contain' other types of Game Object. When a Game Object is added to a Container, the Container becomes responsible for the rendering of it. By default it will be removed from the Display List and instead added to the Containers own internal list.

The position of the Game Object automatically becomes relative to the position of the Container.

The transform point of a Container is \[0, 0\] (local space) and that cannot be changed. The children you add to the Container should be positioned with this value in mind. I.e. you should treat \[0, 0\] as being the _center_ of the Container, and position children positively and negative around it as required.

When the Container is rendered, all of its children are rendered as well, in the order in which they exist within the Container. Container children can be repositioned using methods such as MoveUp, MoveDown and SendToBack.

If you modify a transform property of the Container, such as Container.x or Container.rotation then it will automatically influence all children as well.

Containers can include other Containers for deeply nested transforms.

Containers can have masks set on them and can be used as a mask too. However, Container children cannot be masked. The masks do not 'stack up'. Only a Container on the root of the display list will use its mask.

Containers can be enabled for input. Because they do not have a texture you need to provide a shape for them to use as their hit area. Container children can also be enabled for input, independent of the Container.

If input enabling a child you should not set both the origin and a negative scale factor on the child, or the input area will become misaligned.

Containers can be given a physics body for either Arcade Physics, Impact Physics or Matter Physics. However, if Container children are enabled for physics you may get unexpected results, such as offset bodies, if the Container itself, or any of its ancestors, is positioned anywhere other than at 0 x 0. Container children with physics do not factor in the Container due to the excessive extra calculations needed. Please structure your game to work around this.

It's important to understand the impact of using Containers. They add additional processing overhead into every one of their children. The deeper you nest them, the more the cost escalates. This is especially true for input events. You also loose the ability to set the display depth of Container children in the same flexible manner as those not within them. In short, don't use them for the sake of it. You pay a small cost every time you create one, try to structure your game around avoiding that where possible.

## Add container[​](#add-container "Direct link to Add container")

```
var container = this.add.container(x, y);
// var container = this.add.container(x, y, children); // children: an array of game object
```

## Custom class[​](#custom-class "Direct link to Custom class")

*   Define class
    
    ```
    class MyContainer extends Phaser.GameObjects.Container {
        constructor(scene, x, y, children) {
            super(scene, x, y, children);
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
    var container = new MyContainer(scene, x, y, children);
    ```
    

## Destroy container[​](#destroy-container "Direct link to Destroy container")

```
container.destroy();
```

Also destroy all children game objects.

## Set properties[​](#set-properties "Direct link to Set properties")

Reference [game object](/phaser/concepts/gameobjects), to set position, angle, visible, alpha, etc...

## Set size[​](#set-size "Direct link to Set size")

```
container.setSize(width, height);
```

Default `width` and `height` is 0.

## Set scroll factor[​](#set-scroll-factor "Direct link to Set scroll factor")

```
container.setScrollFactor(x, y);
```

Apply this scrollFactor to all Container children.

```
container.setScrollFactor(x, y, true);
```

## Hit area[​](#hit-area "Direct link to Hit area")

```
container.setInteractive(new Phaser.Geom.Circle(0, 0, radius), Phaser.Geom.Circle.Contains);
// container.setInteractive(false); // disable
```

Assign hit area with a circle shape.

## Non-exclusive[​](#non-exclusive "Direct link to Non-exclusive")

```
container.setExclusive(false);
```

Allows a game object added to container many times.

## Children[​](#children "Direct link to Children")

### Add child[​](#add-child "Direct link to Add child")

```
container.add(child);  // child: a game object or an array of game objects
```

```
container.addAt(child, index);
```

### Child exists in container[​](#child-exists-in-container "Direct link to Child exists in container")

```
var hasChild = container.exists(child);
```

### Get child[​](#get-child "Direct link to Get child")

```
var firstChild = container.first;
var nextChild = container.next;
var prevChild = container.previous;
var lastChild = container.last;
```

```
var child = container.getByName(name);
```

```
var child = container.getRandom(startIndex, length);
```

```
var child = container.getFirst(property, value, startIndex, endIndex);
// value: the value to test the property against. Must pass a strict (`===`) comparison check.
```

```
var children = container.getAll(property, value, startIndex, endIndex);
// value: the value to test the property against. Must pass a strict (`===`) comparison check.
```

```
var amount = container.count(property, value, startIndex, endIndex);
// value: the value to test the property against. Must pass a strict (`===`) comparison check.
```

### Sort children[​](#sort-children "Direct link to Sort children")

Sort the contents of this Container so the items are in order based on the given property. For example: `sort('alpha')` would sort the elements based on the value of their alpha property.

```
container.sort(property);
```

```
container.sort(property, function(childA, childB){
    return 0; // 0, 1, -1
});
```

### Remove child[​](#remove-child "Direct link to Remove child")

```
container.remove(child);
// container.remove(child, true);  // remove child object and destroy it
```

```
container.removeAt(index);
// container.removeAt(index, true);  // remove child object and destroy it
```

```
container.removeBetween(startIndex, endIndex);
// container.removeBetween(startIndex, endIndex, true);  // remove children objects and destroy them
```

```
container.removeAll();
// container.removeAll(true);  // remove all children objects and destroy them
```

Removing child from container without destroying will put back into scene's display list.

### Order of child[​](#order-of-child "Direct link to Order of child")

```
container.moveTo(child, index);
```

```
container.bringToTop(child);
```

```
container.sendToBack(child);
```

```
container.moveUp(child);
```

```
container.moveDown(child);
```

```
container.moveAbove(child1, child2);  // Move child1 above child2
```

```
container.moveBelow(child1, child2);  // Move child1 below child2
```

```
container.swap(child1, child2);
```

```
container.reverse();
```

```
container.shuffle();
```

### Replace child[​](#replace-child "Direct link to Replace child")

```
container.replace(oldChild, newChild);
// container.replace(oldChild, newChild, true);  // destroy oldChild
```

### Set properties[​](#set-properties-1 "Direct link to Set properties")

```
container.setAll(property, value, startIndex, endIndex);
```

### For each child[​](#for-each-child "Direct link to For each child")

*   Iterate current children list
    
    ```
    container.iterate(callback);
    // container.iterate(callback, context);
    // container.iterate(callback, context, arg0, arg1, ...);
    ```
    
    *   `callback` :
        
        ```
        ```javascript
        function(child, arg0, arg1, ...) {
        
        }
        ```
        ```
        
*   Iterate a copy of current children list
    
    ```
    container.each(callback);
    // container.each(callback, context);
    // container.each(callback, context, arg0, arg1, ...);
    ```
    
    *   `callback` :
        
        ```
        ```javascript
        function(child, arg0, arg1, ...) {
        
        }
        ```
        ```
        

### Get world position, rotation, scale[​](#get-world-position-rotation-scale "Direct link to Get world position, rotation, scale")

```
var matrix = child.getWorldTransformMatrix();
var x = matrix.tx;
var y = matrix.ty;
var rotation = matrix.rotation;
var scaleX = matrix.scaleX;
var scaleY = matrix.scaleY;
```

## Other properties[​](#other-properties "Direct link to Other properties")

See [game object](/phaser/concepts/gameobjects)

## Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = container.createBitmapMask();
```

See [mask](/phaser/concepts/display#masks)

## Shader effects[​](#shader-effects "Direct link to Shader effects")

Support [postFX effects](/phaser/concepts/gameobjects/shader)

!!! note No preFX effect support

## Compare with [group object](/phaser/concepts/gameobjects/group)[​](#compare-with-group-object "Direct link to compare-with-group-object")

*   Container and group objects are all have a children list.
*   Container has position, angle, alpha, visible, ...etc, but group does not have.
*   Container controls properties of children (position, angle, alpha, visible, ...etc), but group won't.
*   A game object could be added to many groups, but it only could be added to one container (`exclusive` mode).

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
