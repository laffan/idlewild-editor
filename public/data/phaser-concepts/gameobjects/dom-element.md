# Dom Element

DOM Element Game Objects are a way to control and manipulate HTML Elements over the top of your game.

In order for DOM Elements to display you have to enable them by adding the following to your game configuration object:

```
dom {
  createContainer: true
}
```

You must also have a `parent` container for Phaser. This is specified by the `parent` property in the game config. When these two things are added, Phaser will automatically create a DOM Container div that is positioned over the top of the game canvas. This div is sized to match the canvas, and if the canvas size changes, as a result of settings within the Scale Manager, the dom container is resized accordingly. Without providing a `parent`, the DOM Container _will not_ be created.

You can create a DOM Element by either passing in `DOMStrings`, or by passing in a reference to an existing Element that you wish to be placed under the control of Phaser. For example:

```
this.add.dom(x, y, 'div', 'background-color: lime; width: 220px; height: 100px; font: 48px Arial', 'Phaser');
```

The above code will insert a div element into the DOM Container at the given x/y coordinate. The DOMString in the 4th argument sets the initial CSS style of the div and the final argument is the inner text. In this case, it will create a lime colored div that is 220px by 100px in size with the text Phaser in it, in an Arial font.

You should nearly always, without exception, use explicitly sized HTML Elements, in order to fully control alignment and positioning of the elements next to regular game content.

Rather than specify the CSS and HTML directly you can use the `load.html` File Loader to load it into the cache and then use the `createFromCache` method instead. You can also use `createFromHTML` and various other methods available in this class to help construct your elements.

Once the element has been created you can then control it like you would any other Game Object. You can set its position, scale, rotation, alpha and other properties. It will move as the main Scene Camera moves and be clipped at the edge of the canvas. It's important to remember some limitations of DOM Elements: The obvious one is that they appear above or below your game canvas. You cannot blend them into the display list, meaning you cannot have a DOM Element, then a Sprite, then another DOM Element behind it.

They also cannot be enabled for input. To do that, you have to use the `addListener` method to add native event listeners directly. The final limitation is to do with cameras. The DOM Container is sized to match the game canvas entirely and clipped accordingly. DOM Elements respect camera scrolling and scrollFactor settings, but if you change the size of the camera so it no longer matches the size of the canvas, they won't be clipped accordingly.

DOM Game Objects can be added to a Phaser Container, however you should only nest them **one level deep**. Any further down the chain and they will ignore all root container properties.

Also, all DOM Elements are inserted into the same DOM Container, regardless of which Scene they are created in.

Note that you should only have DOM Elements in a Scene with a _single_ Camera. If you require multiple cameras, use parallel scenes to achieve this.

DOM Elements are a powerful way to align native HTML with your Phaser Game Objects. For example, you can insert a login form for a multiplayer game directly into your title screen. Or a text input box for a highscore table. Or a banner ad from a 3rd party service. Or perhaps you'd like to use them for high resolution text display and UI. The choice is up to you, just remember that you're dealing with standard HTML and CSS floating over the top of your game, and should treat it accordingly.

## Configuration[​](#configuration "Direct link to Configuration")

*   Set `parent` to divId
*   Set `dom.createContainer` to `true`.

```
var config = {
    // ...
    parent: divId,
    // fullscreenTarget: divId, // For fullscreen
    dom: {
        createContainer: true
    },
    input: {
        mouse: {
            target: divId
        },
        touch: {
            target: divId
        },
    },
    // ...
}
var game = new Phaser.Game(config);
```

## Add DOM element object[​](#add-dom-element-object "Direct link to Add DOM element object")

### Add html string[​](#add-html-string "Direct link to Add html string")

1.  Load html string in preload stage
    
    ```
    this.load.html(key, url);
    ```
    
    Reference: [load html](/phaser/concepts/loader#html)
    
2.  Add DOM element object with html string from cache
    
    ```
    var domElement = this.add.dom(x, y).createFromCache(key);  // elementType = 'div'
    // var domElement = this.add.dom(x, y).createFromCache(key, elementType);
    ```
    
    *   Add DOM element object with html string
    
    ```
    var domElement = this.add.dom(x, y).createFromHTML(htmlString);  // elementType = 'div'
    // var domElement = this.add.dom(x, y).createFromHTML(htmlString, elementType);
    ```
    
    *   `elementType` : The tag name of the element into which all of the html will be inserted. Defaults to a plain div tag.

### Create element[​](#create-element "Direct link to Create element")

```
this.add.dom(x, y).createElement(tagName);
// this.add.dom(x, y).createElement(tagName, style, innerText);
```

*   `tagName` : A string that specifies the type of element to be created. For example, `'div'`
*   `style` : Either a DOMString that holds the CSS styles to be applied to the created element, or an object the styles will be readyfrom. Optional.
*   `innerText` : A DOMString that holds the text that will be set as the innerText of the created element. Optional.

### Add existing DOM[​](#add-existing-dom "Direct link to Add existing DOM")

1.  Create DOM element
    
    ```
    var el = document.createElement('div');
    // el.style = '...';
    // el.innerText = '...';
    ```
    
2.  Add to scene
    
    ```
    var domElement = this.add.dom(x, y, el);
    // var domElement = this.add.dom(x, y, el, style, innerText);
    ```
    

## Custom class[​](#custom-class "Direct link to Custom class")

```
class MyDOMElement extends Phaser.GameObjects.DOMElement {
    constructor(scene, x, y, element, style, innerText) {
        super(scene, x, y, element, style, innerText);
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

Example

```
var domElement = new MyDOMElement(scene, x, y, element);
```

## Event of DOM element[​](#event-of-dom-element "Direct link to Event of DOM element")

*   Add listener
    
    ```
    domElement.addListener(eventName);
    ```
    
    *   `eventName` : Event name
        *   Single string. ex. `'click'`
        *   Event name joined with `' '`
*   Add event handler
    
    ```
    var callback = function(event) {
        // event.target.name
    };
    domElement.on(eventName, callback, scope);
    // domElement.once(eventName, callback, scope);
    ```
    
    Reference: [event emitter](/phaser/concepts/events#the-event-emitter)
    
*   Remove listener
    
    ```
    domElement.removeListener(eventName);
    ```
    
    *   `eventName` : Event name
        *   Single string. ex. `'click'`
        *   Event name joined with `' '`

## Get child[​](#get-child "Direct link to Get child")

*   Get child by name
    
    ```
    var child = domElement.getChildByName(name)
    ```
    
*   Get child by id
    
    ```
    var child = domElement.getChildByID(id)
    ```
    
*   Get child by property
    
    ```
    var child = domElement.getChildByProperty(property, value)
    ```
    

## Set inner html string[​](#set-inner-html-string "Direct link to Set inner html string")

```
this.setHTML(html);
```

or

```
this.setText(html);
```

## DOM Element[​](#dom-element "Direct link to DOM Element")

Each DOM element object has 1 DOM element.

*   Set
    
    ```
    domElement.setElement(el);
    // domElement.setElement(el, style, innerText);
    ```
    
*   Get
    
    ```
    var el = domElement.node;
    ```
    

## Depth[​](#depth "Direct link to Depth")

```
domElement.setDepth(value);
```

## Set size[​](#set-size "Direct link to Set size")

```
var style = domElement.node.style;
style.width = width + 'px';
style.height = height + 'px';
domElement.updateSize();
```

## Skew[​](#skew "Direct link to Skew")

```
domElement.setSkew(x, y);
```

or

```
domElement.skewX = x;
domElement.skewY = y;
```

## Rotate 3d[​](#rotate-3d "Direct link to Rotate 3d")

The rotate3d() CSS function defines a transformation that rotates an element around a fixed axis in 3D space, without deforming it.

```
domElement.rotate3d.set(x, y, z, a);
```

or

```
domElement.rotate3d.x = x;
domElement.rotate3d.y = y;
domElement.rotate3d.z = z;
domElement.rotate3d.w = a;
```

[Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/rotate3d)

## Interactive with other game objects[​](#interactive-with-other-game-objects "Direct link to Interactive with other game objects")

1.  DOM game object always put above game canvas, i.e. DOM game object will render above any other kind of game object.
2.  DOM game object will receive touch event even if it is not the first touched game object.
3.  P3's `'pointerdown'`, `'pointerup'` events will be fired above/under DOM game object.
4.  P3's `'pointermove'` event won't be fired above/under DOM game object, except
    *   Setting DOM game object to be invisilbe.
    *   Assign input.mouse.target parameter of game config.
5.  DOM game object only can be displayed by main camera. i.e. dom game object can't add to other camera.

## Other properties[​](#other-properties "Direct link to Other properties")

See [game object](/phaser/concepts/gameobjects)

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
