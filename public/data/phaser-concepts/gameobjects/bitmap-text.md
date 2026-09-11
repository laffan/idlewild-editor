# Bitmap Text

A Bitmap Text Game Object is created from a bitmap based texture file such as a PNG file. This texture contains each character arranged in a fixed structure. The following image is an example of a Bitmap Text texture file:

![image](/assets/images/bitmapfont-example-texture-5d64115defb88f3a0da15470bc520533.png)

The texture file is nearly always accompanied by an XML or JSON based file that describes the font structure. This file contains the positions of each character in the texture, so the renderer knows how to cut them out, along with kerning data.

Because the font comes from a texture, there is no worrying about if it's installed on the users system. Or about loading it such as with Web Fonts. However, as a result of being drawn from a texture, you are more limited in what you can do with them. For example, you cannot do things like apply a stroke or fill pattern to a Bitmap Text. Also, you are limited to only the characters in the texture file, so if your game needs to support multiple languages, it has to cater for this in the font textures directly.

On the plus side, under WebGL Bitmap Texts are extremely fast to render and unlike Text Game Objects, you don't incur any speed penalty when updating their content because the underlying texture doesn't change. You can also create visually impressive fonts by preparing them in an image editor, applying fills and any other effect required. As you can see in the image above, this style would be extremely hard to achieve with a Web Font.

## Bitmap Text Creation Software[​](#bitmap-text-creation-software "Direct link to Bitmap Text Creation Software")

To create a Bitmap Text data files you need a 3rd party app. Here are four of the most common:

*   [BMFont](http://www.angelcode.com/products/bmfont/) (Windows, free)
*   [Glyph Designer](https://www.71squared.com/en/glyphdesigner) (macOS, commercial)
*   [SnowB BMF](https://snowb.org/) (web-based, free)
*   [Littera](http://kvazars.com/littera/) (Flash-based - yes, really, free)

In most use cases it is recommended to use the XML file format. For example, BMFont generates its data as XML. When it saves the files they have a `.fnt` extension, but you can simply rename them to `.xml`.

If you wish to use JSON, the formatting should be equal to the result of converting a valid XML file through the popular X2JS library. An online tool for conversion can be found on the [Code Beautify](https://codebeautify.org/xmltojson) site.

### From an image and font data[​](#from-an-image-and-font-data "Direct link to From an image and font data")

Bitmap font generators make an image and XML data file. Use `load.bitmapFont()`:

```
this.load.bitmapFont('key', 'font.png', 'font.xml');
```

To create multi-line text insert \\r, \\n or \\r\\n escape codes into the text string.

### From an atlas and font data[​](#from-an-atlas-and-font-data "Direct link to From an atlas and font data")

Load the image and XML data separately, then call `ParseFromAtlas()` to create the font.

*   [bitmap text from atlas](https://labs.phaser.io/edit.html?src=src/game%20objects/bitmaptext/static/bitmaptext-atlas.js)

### From a "retro font" image[​](#from-a-retro-font-image "Direct link to From a \"retro font\" image")

Load the image and then call `RetroFont.Parse()` with the [font data](https://newdocs.phaser.io/docs/latest/Phaser.Types.GameObjects.BitmapText.RetroFontConfig).

*   [retro text 1](https://labs.phaser.io/view.html?src=src%5Cgame%20objects%5Cbitmaptext%5Cretro%20font%5Cretro%20text%201.js)

## Bitmap text[​](#bitmap-text "Direct link to Bitmap text")

These are game objects that display text using the font. There are two classes, [BitmapText](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.BitmapText) and [DynamicBitmapText](https://newdocs.phaser.io/docs/latest/Phaser.GameObjects.DynamicBitmapText). They are both "dynamic" in the sense that you can change the text contents at any time. The difference is that DynamicBitmapText has [callbacks](https://newdocs.phaser.io/docs/latest/Phaser.Types.GameObjects.BitmapText.DisplayCallbackConfig) for per-character rendering effects and [scrolling](https://labs.phaser.io/view.html?src=src%5Cgame%20objects%5Cbitmaptext%5Cdynamic%5Cvertical%20scroller.js).

### Load bitmap font[​](#load-bitmap-font "Direct link to Load bitmap font")

*   Load bitmap font from texture and xml configuration
    
    ```
    this.load.bitmapFont(key, textureURL, xmlURL);
    ```
    
    *   Reference: [load bitmap font](/phaser/concepts/loader#bitmap-font)
        
    *   Loaded texture also can be used for [Image](#load-bitmap-font), [Sprite](#load-bitmap-font), or [Arcade Image](/phaser/concepts/physics/arcade#image-object), [Arcade Sprite](/phaser/concepts/physics/arcade#sprite-object)
        
        ```
        ```js
        this.add.image(x, y, key, char);
        ```
        ```
        

*   Load retro bitmap font from texture and JSON configuration
    1.  Load texture in _preload_ stage
        
        ```
        this.load.image(key, url);
        ```
        
        Reference: [load image](/phaser/concepts/loader#image)
        
    2.  Add retro bitmap font
        
        ```
        var config = {
            // image
            image: '',
            offset: {
                x: 0,
                y: 0
            },
            // characters
            width: 32,
            height: 32,
            chars: '',
            charsPerRow: 10,
            // spacing
            spacing: {
                x: 0,
                y: 0
            },
            lineSpacing: 0
        }
        this.cache.bitmapFont.add(key, Phaser.GameObjects.RetroFont.Parse(scene, config));
        ```
        
        *   Image :
            *   `image` : The key of the image containing the font.
            *   `offset` : If the font set doesn't start at the top left of the given image, specify the X/Y coordinate offset here.
        *   Characters :
            *   `width` : The width of each character in the font set.
            *   `height` : The height of each character in the font set.
            *   `chars` : The characters used in the font set, in display order.
                *   [Default characters set](#default-characters-set-of-retro-font)
            *   `charsPerRow` : The number of characters per row in the font set. If not given charsPerRow will be the image width / characterWidth.
        *   Spacing :
            *   `spacing` : If the characters in the font set have horizontal/vertical spacing between them set the required amount here.
            *   `lineSpacing` : The amount of vertical space to add to the line height of the font.

### Add bitmap text object[​](#add-bitmap-text-object "Direct link to Add bitmap text object")

```
var txt = this.add.bitmapText(x, y, key, text);
// var txt = this.add.bitmapText(x, y, key, text, size, align);
```

*   `size` : The size of the font
*   `align` : The alignment of the text in a _multi-line_ BitmapText object.
    *   `0` : Left aligned (default)
    *   `1` : Middle aligned
    *   `2` : Right aligned

Add text from JSON

```
var txt = this.make.bitmapText({
    x: 0,
    y: 0,
    text: 'Text\nGame Object\nCreated from config',
    font: '',
    size: false,
    align: 0,
    // origin: {x: 0.5, y: 0.5},
    add: true
});
```

### Custom class[​](#custom-class "Direct link to Custom class")

*   Define class
    
    ```
    class MyText extends Phaser.GameObjects.BitmapText {
        constructor(scene, x, y, key, text, size, align) {
            super(scene, x, y, key, text, size, align);
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
    var txt = new MyText(scene, x, y, key, text);
    ```
    

### Set text[​](#set-text "Direct link to Set text")

```
txt.setText('...');
```

or

```
txt.text = '...';
```

### Set align[​](#set-align "Direct link to Set align")

*   Left aligned
    
    ```
    txt.setLeftAlign();
    ```
    

*   Middle aligned
    
    ```
    txt.setCenterAlign();
    ```
    
*   Right aligned
    
    ```
    txt.setRightAlign();
    ```
    

or

```
txt.align = align;
```

*   `align` :
    *   `0` : Left aligned (default)
    *   `1` : Middle aligned
    *   `2` : Right aligned

### Set letter spacing[​](#set-letter-spacing "Direct link to Set letter spacing")

```
txt.setLetterSpacing(spacing);
```

or

```
txt.letterSpacing = spacing;
```

Can be a positive value to increase the space, or negative to reduce it.

### Set line spacing[​](#set-line-spacing "Direct link to Set line spacing")

```
txt.setLineSpacing(spacing);
```

or

```
txt.lineSpacing = spacing;
```

Can be a positive value to increase the space, or negative to reduce it.

### Set font size[​](#set-font-size "Direct link to Set font size")

```
txt.setFontSize(size);
```

or

```
txt.fontSize = size;
```

### Set font[​](#set-font "Direct link to Set font")

```
txt.setFont(key);
// txt.setFont(key, size, align);
```

### Tint[​](#tint "Direct link to Tint")

See [Tint](/phaser/concepts/gameobjects#tint).

### Color of characters[​](#color-of-characters "Direct link to Color of characters")

*   By character
    
    ```
    txt.setCharacterTint(start, length, tintFill, color);
    // txt.setCharacterTint(start, length, tintFill, topLeft, topRight, bottomLeft, bottomRight);
    ```
    
    *   `start` : Index starting character.
        *   `< 0` : Counts back from the end of the text.
    *   `length` : Number of characters to tint.
        *   `-1` : All characters from `start`
    *   `tintFill` :
        *   `true` : Fill-based tint
        *   `false` : Additive tint
    *   `color`, or `topLeft, topRight, bottomLeft, bottomRight` : Color integer.
*   By word
    
    ```
    txt.setWordTint(word, count, tintFill, color);
    // txt.setWordTint(word, count, tintFill, topLeft, topRight, bottomLeft, bottomRight);
    ```
    
    *   `word` : The word to search for.
        *   A string
        *   An index of the word in the words array.
    *   `count` : Number of matching words to tint.
        *   `-1` : All matching words
    *   `tintFill` :
        *   `true` : Fill-based tint
        *   `false` : Additive tint
    *   `color`, or `topLeft, topRight, bottomLeft, bottomRight` : Color integer.

### Drop shadow effect[​](#drop-shadow-effect "Direct link to Drop shadow effect")

```
txt.setDropShadow(x, y, color, alpha);
```

or

```
txt.dropShadowX = x;
txt.dropShadowY = y;
txt.dropShadowColor = color;
txt.dropShadowAlpha = alpha;
```

*   `x`, `y` : The horizontal/vertical offset of the drop shadow.
*   `color` : The color of the drop shadow.
*   `alpha` : The alpha of the drop shadow.

!!! note WebGL only

### Wrap[​](#wrap "Direct link to Wrap")

*   Wrap
    
    ```
    txt.setMaxWidth(width);
    // txt.setMaxWidth(width, wordWrapCharCode);
    ```
    
    *   `width` : Line width in pixels.
    *   `wordWrapCharCode` : The character code to check for when word wrapping. Defaults to 32 (the _space_ character)
*   Disable wrapping
    
    ```
    txt.setMaxWidth(0);
    ```
    

### Get bounds[​](#get-bounds "Direct link to Get bounds")

```
var width = txt.width;
var height = txt.height;
```

or

```
var bounds = txt.getTextBounds(round);
// bounds = {
//     local: {
//         x: 0,
//         y: 0,
//         width: 0,
//         height: 0
//     },
//     global: {
//         x: 0,
//         y: 0,
//         width: 0,
//         height: 0
//     },
//     lines: {
//         shortest: 0,
//         longest: 0,
//         lengths: null,
//         height: 0
//     },
//     wrappedText: '',
//     words: [],
//     characters: [],
//     scaleX: 0,
//     scaleY: 0
// };
```

*   `round` : Set `true` to round the results to the nearest integer.
    
*   `local` : The BitmapText based on fontSize and 0x0 coords.
    
*   `global` : The BitmapText, taking into account scale and world position.
    
*   `lines` : The BitmapText line data.
    
*   `wrappedText` : Wrapped content joined with `'\n'`.
    
*   `characters` : Information of each character.
    
    ```
    {
        char, code, i, idx, x, y, w, h, t, b, r, line
    }
    ```
    
    *   `char` : Character (string).
    *   `code`: Character code (number)
    *   `i` : Index of character
    *   `x` , `y` : World position of this character
    *   `w`, `h` : Width/height of this character
    *   `t`, `b` : The top/bottom of the line this character is on.
    *   `r` : The right-most point of this character, including xAdvance.
    *   `line` : The line number the character appears on.
*   `words` : Information of each word.
    
    ```
    {
        word, i, x, y, w, h, cr
    
    }
    ```
    
    *   `word` : Word string.
    *   `i` : Index of start character
    *   `x`, `y` : World position of start character
    *   `w` , `h` : Width/height of word
    *   `cr` : Is last word of current line
*   `scaleX`, `scaleY` : Scale of width and height.
    

#### Get information of character[​](#get-information-of-character "Direct link to Get information of character")

```
var data = txt.getCharacterAt(x, y);
// var data = txt.getCharacterAt(x, y, camera);
```

*   `x`, `y` : World position.
    
*   `camera` : The Camera which is being tested against.
    
*   `data` : Information of character at world position.
    
    ```
    {
        char, code, i, x, y, w, h, t, b, r, line
    }
    ```
    
    *   `char` : Character (string).
    *   `code`: Character code (number)
    *   `i` : Index of character
    *   `x` , `y` : World position of this character
    *   `w`, `h` : Width/height of this character
    *   `t`, `b` : The top/bottom of the line this character is on.
    *   `r` : The right-most point of this character, including xAdvance.
    *   `line` : The line number the character appears on.

### Other properties[​](#other-properties "Direct link to Other properties")

See [game object](/phaser/concepts/gameobjects)

### Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = txt.createBitmapMask();
```

### Shader effects[​](#shader-effects "Direct link to Shader effects")

Only supports postFX effects.

## Appendix[​](#appendix "Direct link to Appendix")

### Default characters set of retro font[​](#default-characters-set-of-retro-font "Direct link to Default characters set of retro font")

*   `Phaser.GameObjects.RetroFont.TEXT_SET1` :
    
    ```
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
    ```
    

*   `Phaser.GameObjects.RetroFont.TEXT_SET2` :
    
    ```
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET3` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET4` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET5` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ.,/() \'!?-*:0123456789'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET6` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?:;0123456789"(),-.\' '
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET7` :
    
    ```
    'AGMSY+:4BHNTZ!;5CIOU.?06DJPV,(17EKQW")28FLRX-\'39'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET8` :
    
    ```
    '0123456789 .ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET9` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ()-0123456789.:,\'"?!'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET10` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    ```
    
*   `Phaser.GameObjects.RetroFont.TEXT_SET11` :
    
    ```
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ.,"-+!?()\':;0123456789'
    ```
    

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
