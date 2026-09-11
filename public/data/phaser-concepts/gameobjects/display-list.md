# Display List

Phaser uses a Display List to manage the order of Game Objects within the World. Every Scene has its own Display List. When you add a Game Object to a Scene, it is automatically added to the Display List. The Display List is a special type of container that allows you to control the order in which the Game Objects are rendered. By default, Game Objects are rendered in the order in which they were added to the Display List.

The Display List is also responsible for managing the position of Game Objects within the World. When you add a Game Object to the Display List, it is automatically positioned at the bottom of the list. This means that it will be rendered first, and therefore appear behind all other Game Objects.

You can change the position of a Game Object within the Display List by using its helper functions such as `sendToBack`, `moveDown`, `bringToTop` and `moveUp`. These allow you to move a Game Object around the Display List, thus influencing the order which things are rendered or checked for input events, as objects "on the top" get input priority.

In Phaser 2 it was possible to add a Game Object as a child of another Game Object. They were, in effect, self-contained Display Lists. This is no longer the case in Phaser 3. The only Game Object in Phaser 3 that can have children is the [Container](/phaser/concepts/gameobjects#parent-containers) Game Object.

## Accessing the Display List in a Scene[​](#accessing-the-display-list-in-a-scene "Direct link to Accessing the Display List in a Scene")

Each Scene has a property called `children`, which is a reference to that Scene's Display List. This `children` property allows you to change each game object's rendering order.

```
let displayList = this.children;
```

*   `this` : Refers to the current scene.
*   `children` : Represents the Display List object of the scene.

## Display List methods[​](#display-list-methods "Direct link to Display List methods")

Whenever you create a game object (e.g., sprites, images, text), Phaser automatically adds it to the scene's Display List. However, you can also manually add objects to the Display List if needed. The order in which objects are rendered depends on their order in the Display List. Objects added later are rendered above those added earlier unless you modify their depth or re-arrange them using various Display List methods.

### Adding Game Objects to the Display List[​](#adding-game-objects-to-the-display-list "Direct link to Adding Game Objects to the Display List")

*   Create a new Game Object and adding it using the Scene Game Object Factory.
    
    ```
    let player = this.add.sprite(400, 300, "player");
    ```
    
*   Adding an existing Game Object
    
    ```
    const player = new Phaser.GameObjects.Sprite(this, x, y, "player");
    player.addToDisplayList();
    ```
    
    Or
    
    ```
    const player = new Phaser.GameObjects.Sprite(this, x, y, "player");
    this.children.add(player);
    ```
    
    *   `this` : Refers to the current Scene

### Removing Game Objects from the Display List[​](#removing-game-objects-from-the-display-list "Direct link to Removing Game Objects from the Display List")

*   Use `destroy()` to remove a Game Object from your game if you don't ever plan to use it again. `destroy()` also removes it from the Display List, Update List, Input Manager and Physics Manager. As long as no reference to the Game Object exists within your own code it should become free for garbage collection by the browser.
    
    ```
    let player = this.add.sprite(400, 300, "player");
    player.destroy();
    ```
    
*   Removing an existing Game Object from the Scene's Display List.
    
    ```
    let player = this.add.sprite(400, 300, "player");
    player.removeFromDisplayList();
    ```
    
    Or
    
    ```
    let player = this.add.sprite(400, 300, "player");
    this.children.remove(player);
    ```
    

### Sorting Game Objects[​](#sorting-game-objects "Direct link to Sorting Game Objects")

*   Move a Game Object to the top of the Display List.
    
    ```
    this.children.bringToTop(gameObject); // gameObject renders above all other objects
    ```
    
*   Move a Game Object to the bottom of the Display List.
    
    ```
    this.children.sendToBack(gameObject); // gameObject renders below all other objects
    ```
    
*   Sorting by Depth
    
    By default Game Objects are created with a depth of 0. A Game Object with a higher depth value will always render in front of one with a lower value.
    
    *   Get Game Object depth
        
        ```
        const depth = gameObject.depth; // Returns the depth of this Game Object within the Scene.
        ```
        
    *   Set Game Object depth
        
        ```
        gameObject.setDepth(depth);
        ```
        
    *   Example
        
        ```
        player.setDepth(2); // Set a higher depth for the player to render above other objects
        background.setDepth(0); // Set a lower depth for the background
        this.children.depthSort(); // Sort all game objects based on their depth values
        ```
        
*   Moving Game Objects up or down
    
    *   Move a Game Object up one position
        
        ```
        this.children.moveUp(gameObject);
        ```
        
    *   Move a Game Object down one position
        
        ```
        this.children.moveDown(gameObject);
        ```
        

### Retrieving a Game Object from the Display List[​](#retrieving-a-game-object-from-the-display-list "Direct link to Retrieving a Game Object from the Display List")

```
let gameObject = this.children.getAt(index);
```

*   `index` : The position of the game object in the Display List (starting at 0).

Example:

```
let firstObject = this.children.getAt(0); // Retrieves the first object in the Display List
```
