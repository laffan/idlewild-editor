# Graphics

A Graphics object is a way to draw primitive shapes to your game. Primitives include forms of geometry, such as Rectangles, Circles, and Polygons. They also include lines, arcs and curves. When you initially create a Graphics object it will be empty. To draw to it you must first specify a line style or fill style (or both), draw shapes using paths, and finally fill or stroke them.

```
graphics.lineStyle(5, 0xff00ff, 1.0);
graphics.beginPath();
graphics.moveTo(100, 100);
graphics.lineTo(200, 200);
graphics.closePath();
graphics.strokePath();
```

There are also many helpful methods that draw and fill/stroke common shapes for you.

```
graphics.lineStyle(5, 0xff00ff, 1.0);
graphics.fillStyle(0xffffff, 1.0);
graphics.fillRect(50, 50, 400, 200);
graphics.strokeRect(50, 50, 400, 200);
```

When a Graphics object is rendered it will render differently based on if the game is running under Canvas or WebGL. Under Canvas it will use the HTML Canvas context drawing operations to draw the path. Under WebGL the graphics data is decomposed into polygons. Both of these are expensive processes, especially with complex shapes.

If your Graphics object doesn't change much (or at all) once you've drawn your shape to it, then you will help performance by calling Phaser.GameObjects.Graphics#generateTexture. This will 'bake' the Graphics object into a Texture, and return it. You can then use this Texture for Sprites or other display objects. If your Graphics object updates frequently then you should avoid doing this, as it will constantly generate new textures, which will consume memory.

As you can tell, Graphics objects are a bit of a trade-off. While they are extremely useful, you need to be careful in their complexity and quantity of them in your game.

## Basic usage[​](#basic-usage "Direct link to Basic usage")

### Add graphics object[​](#add-graphics-object "Direct link to Add graphics object")

```
var graphics = this.add.graphics();
```

or

```
var graphics = this.add.graphics({
  x: 0,
  y: 0,

  // lineStyle: {
  //     width: 1,
  //     color: 0xffffff,
  //     alpha: 1
  // },
  // fillStyle: {
  //     color: 0xffffff,
  //     alpha: 1
  // },

  add: true,
});
```

### Custom class[​](#custom-class "Direct link to Custom class")

*   Define class
    
    ```
    class MyGraphics extends Phaser.GameObjects.Graphics {
      constructor(scene, options) {
        super(scene, options);
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
    var graphics = new MyGraphics(this, options);
    ```
    

## Drawing commands[​](#drawing-commands "Direct link to Drawing commands")

### Set line and fill style[​](#set-line-and-fill-style "Direct link to Set line and fill style")

*   Set default line style and fill style
    
    ```
    graphics.setDefaultStyles({
      lineStyle: {
        width: 1,
        color: 0xffffff,
        alpha: 1,
      },
      fillStyle: {
        color: 0xffffff,
        alpha: 1,
      },
    });
    ```
    
*   Set line style
    
    ```
    graphics.lineStyle(lineWidth, color, alpha); // color: 0xRRGGBB
    ```
    
*   Set fill style
    
    *   Fill color
        
        ```
        graphics.fillStyle(color, alpha); // color: 0xRRGGBB
        ```
        
    *   Fill gradient color (WebGL only)
        
        ```
        graphics.fillGradientStyle(
          topLeft,
          topRight,
          bottomLeft,
          bottomRight,
          alpha
        ); // alpha= 1
        // graphics.fillGradientStyle(topLeft, topRight, bottomLeft, bottomRight, alphaTopLeft, alphaTopRight, alphaBottomLeft, alphaBottomRight);
        ```
        
        *   `topLeft` : The tint being applied to the top-left of the Game Object.
        *   `topRight` : The tint being applied to the top-right of the Game Object.
        *   `bottomLeft` : The tint being applied to the bottom-left of the Game Object.
        *   `bottomRight` : The tint being applied to the bottom-right of the Game Object.
        *   `alphaTopLeft` : The top left alpha value.
        *   `alphaTopRight` : The top right alpha value.
        *   `alphaBottomLeft` : The bottom left alpha value.
        *   `alphaBottomRight` : The bottom right alpha value.

### Clear/Erase all drawings[​](#clearerase-all-drawings "Direct link to Clear/Erase all drawings")

```
graphics.clear();
```

### Drawing paths[​](#drawing-paths "Direct link to Drawing paths")

```
graphics.beginPath();
graphics.closePath();
graphics.fillPath(); // = graphics.fill()
graphics.strokePath(); // = graphics.stroke()
```

### Drawing rectangles[​](#drawing-rectangles "Direct link to Drawing rectangles")

```
graphics.fillRectShape(rect); // rect: {x, y, width, height}
graphics.fillRect(x, y, width, height);
graphics.strokeRectShape(rect); // rect: {x, y, width, height}
graphics.strokeRect(x, y, width, height);
```

### Drawing rounded rectangles[​](#drawing-rounded-rectangles "Direct link to Drawing rounded rectangles")

```
graphics.fillRoundedRect(x, y, width, height, radius);
graphics.strokeRoundedRect(x, y, width, height, radius);
```

*   `radius` : number or an object `{tl, tr, bl, br}`,
    *   Positive value : Convex corner.
    *   Negative value : Concave corner.

### Drawing triangles[​](#drawing-triangles "Direct link to Drawing triangles")

```
graphics.fillTriangleShape(triangle); // triangle: {x1, y1, x2, y2, x3, y3}
graphics.fillTriangle(x1, y1, x2, y2, x3, y3);
graphics.strokeTriangleShape(triangle); // triangle: {x1, y1, x2, y2, x3, y3}
graphics.strokeTriangle(x1, y1, x2, y2, x3, y3);
```

### Drawing points[​](#drawing-points "Direct link to Drawing points")

```
graphics.fillPointShape(point, size); // point: {x, y}
graphics.fillPoint(x, y, size);
```

### Drawing lines[​](#drawing-lines "Direct link to Drawing lines")

```
graphics.strokeLineShape(line); // line: {x1, y1, x2, y2}
graphics.lineBetween(x1, y1, x2, y2);
graphics.lineTo(x, y);
graphics.moveTo(x, y);
```

### Drawing a series of lines[​](#drawing-a-series-of-lines "Direct link to Drawing a series of lines")

```
graphics.strokePoints(points, closeShape, closePath, endIndex); // points: [{x, y}, ...]
graphics.fillPoints(points, closeShape, closePath, endIndex); // points: [{x, y}, ...]
```

*   `points` : Array of `{x, y}`
*   `closeShape` : When `true`, the shape is closed by joining the last point to the first point.
*   `closePath` : When `true`, the path is closed before being stroked.
*   `endIndex` : The index of `points` to stop drawing at. Defaults to `points.length`.

### Drawing circles[​](#drawing-circles "Direct link to Drawing circles")

```
graphics.fillCircleShape(circle); // circle: {x, y, radius}
graphics.fillCircle(x, y, radius);
graphics.strokeCircleShape(circle); // circle: {x, y, radius}
graphics.strokeCircle(x, y, radius);
```

Draw or fill circle shape by points.

### Drawing ellipses[​](#drawing-ellipses "Direct link to Drawing ellipses")

```
graphics.strokeEllipseShape(ellipse, smoothness); // ellipse: Phaser.Geom.Ellipse
graphics.strokeEllipse(x, y, width, height, smoothness);
graphics.fillEllipseShape(ellipse, smoothness); // ellipse: Phaser.Geom.Ellipse
graphics.fillEllipse(x, y, width, height, smoothness);
```

Draw or fill ellipse shape by points.

### Drawing arcs[​](#drawing-arcs "Direct link to Drawing arcs")

```
graphics.arc(x, y, radius, startAngle, endAngle, anticlockwise);
graphics.arc(x, y, radius, startAngle, endAngle, anticlockwise, overshoot);
```

Draw arc curve by points.

### Drawing pie-chart slices[​](#drawing-pie-chart-slices "Direct link to Drawing pie-chart slices")

```
graphics.slice(x, y, radius, startAngle, endAngle, anticlockwise);
graphics.slice(x, y, radius, startAngle, endAngle, anticlockwise, overshoot);
```

Draw pie-chart slice shape by points.

Fill this shape

```
graphics.fillPath();
```

### Clear pattern[​](#clear-pattern "Direct link to Clear pattern")

```
graphics.setTexture();
```

### Transfer[​](#transfer "Direct link to Transfer")

```
graphics.save();
graphics.restore();
graphics.translateCanvas(x, y);
graphics.scaleCanvas(x, y);
graphics.rotateCanvas(radians);
```

### Generate texture[​](#generate-texture "Direct link to Generate texture")

```
graphics.generateTexture(key, width, height); // key: texture key
```

### Create mask[​](#create-mask "Direct link to Create mask")

```
var mask = graphics.createGeometryMask();
```

## Shapes[​](#shapes "Direct link to Shapes")

### Arc[​](#arc "Direct link to Arc")

Draws an arc shape. You can control the start and end angles of the arc, as well as if the angles are winding clockwise or anti-clockwise. The default settings renders a complete circle.

#### Create shape[​](#create-shape "Direct link to Create shape")

```
var arc = this.add.arc(
  x,
  y,
  radius,
  startAngle,
  endAngle,
  anticlockwise,
  fillColor
);
// var arc = this.add.arc(x, y, radius, startAngle, endAngle, anticlockwise, fillColor, fillAlpha);
```

#### Custom class[​](#custom-class-1 "Direct link to Custom class")

*   Define class
    
    ```
    class MyArc extends Phaser.GameObjects.Arc {
      constructor(
        scene,
        x,
        y,
        radius,
        startAngle,
        endAngle,
        anticlockwise,
        fillColor
      ) {
        super(
          scene,
          x,
          y,
          radius,
          startAngle,
          endAngle,
          anticlockwise,
          fillColor
        );
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
    var arc = new MyArc(
      scene,
      x,
      y,
      radius,
      startAngle,
      endAngle,
      anticlockwise,
      fillColor
    );
    ```
    

#### Color[​](#color "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = arc.fillColor;
        var alpha = arc.fillAlpha;
        ```
        
    *   Set
        
        ```
        arc.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        arc.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = arc.strokeColor;
        ```
        
    *   Set
        
        ```
        arc.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        arc.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `arc.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha "Direct link to Alpha")

*   Get
    
    ```
    var alpha = arc.alpha;
    ```
    
*   Set
    
    ```
    arc.setAlpha(alpha);
    // arc.alpha = alpha;
    ```
    

#### Angle[​](#angle "Direct link to Angle")

*   Start angle, in degrees.
    
    *   Get
        
        ```
        var startAngle = arc.startAngle;
        ```
        
    *   Set
        
        ```
        arc.setStartAngle(startAngle);
        // arc.setStartAngle(startAngle, anticlockwise);
        ```
        
        or
        
        ```
        arc.startAngle = startAngle;
        ```
        
*   End angle, in degrees.
    
    *   Get
        
        ```
        var endAngle = arc.endAngle;
        ```
        
    *   Set
        
        ```
        arc.seEndAngle(endAngle);
        ```
        
        or
        
        ```
        arc.endAngle = endAngle;
        ```
        
*   Anticlockwise (`true`, or `false`)
    
    *   Get
        
        ```
        var anticlockwise = arc.anticlockwise;
        ```
        
    *   Set
        
        ```
        arc.anticlockwise = anticlockwise;
        ```
        

#### Radius[​](#radius "Direct link to Radius")

*   Get
    
    ```
    var radius = arc.radius;
    ```
    
*   Set
    
    ```
    arc.setRadius(radius);
    ```
    

or

```
arc.radius = radius;
```

#### Smoother arcs[​](#smoother-arcs "Direct link to Smoother arcs")

Increase this value for smoother arcs, at the cost of more polygons being rendered. Default is `0.01`

*   Get
    
    ```
    var iterations = arc.iterations;
    ```
    
*   Set
    
    ```
    arc.iterations = iterations;
    ```
    

#### Display size[​](#display-size "Direct link to Display size")

*   Get
    
    ```
    var width = arc.displayWidth;
    var height = arc.displayHeight;
    ```
    
*   Set
    
    ```
    arc.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    arc.displayWidth = width;
    arc.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-1 "Direct link to Create mask")

```
var mask = arc.createGeometryMask();
```

### Circle[​](#circle "Direct link to Circle")

Draws a circle shape.

#### Create shape object[​](#create-shape-object "Direct link to Create shape object")

```
var circle = this.add.circle(x, y, radius, fillColor);
// var circle = this.add.circle(x, y, radius, fillColor, fillAlpha);
```

#### Custom class[​](#custom-class-2 "Direct link to Custom class")

*   Define class
    
    ```
    class MyCircle extends Phaser.GameObjects.Arc {
      constructor(scene, x, y, radius, fillColor, fillAlpha) {
        super(scene, x, y, radius, 0, 360, false, fillColor, fillAlpha);
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
    var circle = new MyCircle(scene, x, y, radius, fillColor, fillAlpha);
    ```
    

#### Color[​](#color-1 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = circle.fillColor;
        var alpha = circle.fillAlpha;
        ```
        
    *   Set
        
        ```
        circle.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        circle.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = circle.strokeColor;
        ```
        
    *   Set
        
        ```
        circle.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        circle.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `circle.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-1 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = circle.alpha;
    ```
    
*   Set
    
    ```
    circle.setAlpha(alpha);
    // circle.alpha = alpha;
    ```
    

#### Radius[​](#radius-1 "Direct link to Radius")

*   Radius
    
    *   Get
        
        ```
        var radius = circle.radius;
        ```
        
    *   Set
        
        ```
        circle.setRadius(radius);
        ```
        
        or
        
        ```
        circle.radius = radius;
        ```
        

#### Smoother arcs[​](#smoother-arcs-1 "Direct link to Smoother arcs")

Increase this value for smoother arcs, at the cost of more polygons being rendered. Default is `0.01`

*   Get
    
    ```
    var iterations = circle.iterations;
    ```
    
*   Set
    
    ```
    circle.iterations = iterations;
    ```
    

#### Display size[​](#display-size-1 "Direct link to Display size")

*   Get
    
    ```
    var width = circle.displayWidth;
    var height = circle.displayHeight;
    ```
    
*   Set
    
    ```
    circle.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    circle.displayWidth = width;
    circle.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-2 "Direct link to Create mask")

```
var mask = circle.createGeometryMask();
```

### Curve[​](#curve "Direct link to Curve")

Draw a curve shape.

#### Create shape object[​](#create-shape-object-1 "Direct link to Create shape object")

```
var curve = this.add.curve(x, y, path, fillColor);
// var curve = this.add.curve(x, y, path, fillColor, fillAlpha);
```

*   `path` : [Path object](/phaser/concepts/math#path).

#### Custom class[​](#custom-class-3 "Direct link to Custom class")

*   Define class
    
    ```
    class MyCurve extends Phaser.GameObjects.Curve {
      constructor(scene, x, y, path, fillColor, fillAlpha) {
        super(scene, x, y, path, fillColor, fillAlpha);
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
    var curve = new MyCurve(scene, x, y, path, fillColor, fillAlpha);
    ```
    

#### Color[​](#color-2 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = curve.fillColor;
        var alpha = curve.fillAlpha;
        ```
        
    *   Set
        
        ```
        curve.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        curve.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = curve.strokeColor;
        ```
        
    *   Set
        
        ```
        curve.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        curve.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `curve.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-2 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = curve.alpha;
    ```
    
*   Set
    
    ```
    curve.setAlpha(alpha);
    // curve.alpha = alpha;
    ```
    

#### Smoothness[​](#smoothness "Direct link to Smoothness")

The number of points used when rendering it. Increase this value for smoother curves, at the cost of more polygons being rendered.

```
curve.setSmoothness(smoothness);
```

or

```
curve.smoothness = smoothness;
```

#### Display size[​](#display-size-2 "Direct link to Display size")

*   Get
    
    ```
    var width = curve.displayWidth;
    var height = curve.displayHeight;
    ```
    
*   Set
    
    ```
    curve.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    curve.displayWidth = width;
    curve.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-3 "Direct link to Create mask")

```
var mask = curve.createGeometryMask();
```

### Ellipse[​](#ellipse "Direct link to Ellipse")

Draw an ellipse shape.

#### Create shape object[​](#create-shape-object-2 "Direct link to Create shape object")

```
var ellipse = this.add.ellipse(x, y, width, height, fillColor);
// var ellipse = this.add.ellipse(x, y, width, height, fillColor, fillAlpha);
```

#### Custom class[​](#custom-class-4 "Direct link to Custom class")

*   Define class
    
    ```
    class MyEllipse extends Phaser.GameObjects.Ellipse {
      constructor(scene, x, y, width, height, fillColor, fillAlpha) {
        super(scene, x, y, width, height, fillColor, fillAlpha);
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
    var ellipse = new MyEllipse(scene, x, y, width, height, fillColor, fillAlpha);
    ```
    

#### Color[​](#color-3 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = ellipse.fillColor;
        var alpha = ellipse.fillAlpha;
        ```
        
    *   Set
        
        ```
        ellipse.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        ellipse.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = ellipse.strokeColor;
        ```
        
    *   Set
        
        ```
        ellipse.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        ellipse.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `ellipse.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-3 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = ellipse.alpha;
    ```
    
*   Set
    
    ```
    ellipse.setAlpha(alpha);
    // ellipse.alpha = alpha;
    ```
    

#### Size[​](#size "Direct link to Size")

*   Get
    
    ```
    var width = ellipse.width;
    var height = ellipse.height;
    ```
    
*   Set
    
    ```
    ellipse.setSize(width, height);
    ```
    

#### Display size[​](#display-size-3 "Direct link to Display size")

*   Get
    
    ```
    var width = ellipse.displayWidth;
    var height = ellipse.displayHeight;
    ```
    
*   Set
    
    ```
    ellipse.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    ellipse.displayWidth = width;
    ellipse.displayHeight = height;
    ```
    

#### Smoothness[​](#smoothness-1 "Direct link to Smoothness")

The number of points used when rendering it. Increase this value for smoother curves, at the cost of more polygons being rendered.

```
ellipse.setSmoothness(smoothness);
```

or

```
ellipse.smoothness = smoothness;
```

#### Create mask[​](#create-mask-4 "Direct link to Create mask")

```
var mask = ellipse.createGeometryMask();
```

### Grid[​](#grid "Direct link to Grid")

Draw a grid shape.

#### Create shape object[​](#create-shape-object-3 "Direct link to Create shape object")

```
var grid = this.add.grid(
  x,
  y,
  width,
  height,
  cellWidth,
  cellHeight,
  fillColor,
  fillAlpha,
  outlineFillColor,
  outlineFillAlpha
);
```

#### Custom class[​](#custom-class-5 "Direct link to Custom class")

*   Define class
    
    ```
    class MyGrid extends Phaser.GameObjects.Grid {
      constructor(
        scene,
        x,
        y,
        width,
        height,
        cellWidth,
        cellHeight,
        fillColor,
        fillAlpha,
        outlineFillColor,
        outlineFillAlpha
      ) {
        super(
          scene,
          x,
          y,
          width,
          height,
          cellWidth,
          cellHeight,
          fillColor,
          fillAlpha,
          outlineFillColor,
          outlineFillAlpha
        );
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
    var grid = new MyGrid(
      scene,
      x,
      y,
      width,
      height,
      cellWidth,
      cellHeight,
      fillColor,
      fillAlpha,
      outlineFillColor,
      outlineFillAlpha
    );
    ```
    

#### Color[​](#color-4 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = grid.fillColor;
        var alpha = grid.fillAlpha;
        ```
        
    *   Set
        
        ```
        grid.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        grid.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = grid.strokeColor;
        ```
        
    *   Set
        
        ```
        grid.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        grid.setStrokeStyle();
        ```
        
*   Alternating color
    
    *   Get
        
        ```
        var color = grid.altFillColor;
        ```
        
    *   Set
        
        ```
        grid.setAltFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        grid.setAltFillStyle();
        ```
        
*   Outline color
    
    *   Get
        
        ```
        var color = grid.outlineFillColor;
        ```
        
    *   Set
        
        ```
        grid.setOutlineStyle(color, alpha;
        ```
        
    *   Clear
        
        ```
        grid.setOutlineStyle();
        ```
        

!!! warning "No tint methods" Uses `grid.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-4 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = grid.alpha;
    ```
    
*   Set
    
    ```
    grid.setAlpha(alpha);
    // grid.alpha = alpha;
    ```
    

#### Display size[​](#display-size-4 "Direct link to Display size")

*   Get
    
    ```
    var width = grid.displayWidth;
    var height = grid.displayHeight;
    ```
    
*   Set
    
    ```
    grid.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    grid.displayWidth = width;
    grid.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-5 "Direct link to Create mask")

```
var mask = grid.createGeometryMask();
```

### IsoBox[​](#isobox "Direct link to IsoBox")

An IsoBox is an 'isometric' rectangle. Each face of it has a different fill color. You can set the color of the top, left and right faces of the rectangle respectively. You can also choose which of the faces are rendered via the `showTop`, `showLeft` and `showRight` properties.

You cannot view an IsoBox from under-neath, however you can change the 'angle' by setting the `projection` property.

#### Create shape object[​](#create-shape-object-4 "Direct link to Create shape object")

```
var isoBox = this.add.isobox(
  x,
  y,
  width,
  height,
  fillTop,
  fillLeft,
  fillRight
);
```

#### Custom class[​](#custom-class-6 "Direct link to Custom class")

*   Define class
    
    ```
    class MyIsoBox extends Phaser.GameObjects.IsoBox {
      constructor(scene, x, y, width, height, fillTop, fillLeft, fillRight) {
        super(scene, x, y, width, height, fillTop, fillLeft, fillRight);
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
    var isoBox = new MyIsoBox(
      scene,
      x,
      y,
      width,
      height,
      fillTop,
      fillLeft,
      fillRight
    );
    ```
    

#### Set color[​](#set-color "Direct link to Set color")

*   Fill color
    
    ```
    isoBox.setFillStyle(fillTop, fillLeft, fillRight);
    ```
    
*   Show face
    
    ```
    isoBox.setFaces(showTop, showLeft, showRight);
    ```
    
    *   `showTop`, `showLeft`, `showRight`: Set `true` to show that face

!!! warning "No tint methods" Uses `isoBox.setFillStyle(fillTop, fillLeft, fillRight)` to change color.

#### Alpha[​](#alpha-5 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = isoBox.alpha;
    ```
    
*   Set
    
    ```
    isoBox.setAlpha(alpha);
    // isoBox.alpha = alpha;
    ```
    

#### Projection[​](#projection "Direct link to Projection")

The `projection` level of the iso box. Change this to change the 'angle' at which you are looking at the box.

*   Get
    
    ```
    var projection = isoBox.projection;
    ```
    
*   Set
    
    ```
    isoBox.setProjection(value);
    ```
    
    or
    
    ```
    isoBox.projection = value;
    ```
    

#### Display size[​](#display-size-5 "Direct link to Display size")

*   Get
    
    ```
    var width = isoBox.displayWidth;
    var height = isoBox.displayHeight;
    ```
    
*   Set
    
    ```
    isoBox.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    isoBox.displayWidth = width;
    isoBox.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-6 "Direct link to Create mask")

```
var mask = isoBox.createGeometryMask();
```

### IsoTriangle[​](#isotriangle "Direct link to IsoTriangle")

An IsoTriangle is an 'isometric' triangle. Think of it like a pyramid. Each face has a different fill color. You can set the color of the top, left and right faces of the triangle respectively You can also choose which of the faces are rendered via the `showTop`, `showLeft` and `showRight` properties.

You cannot view an IsoTriangle from under-neath, however you can change the 'angle' by setting the `projection` property. The `reversed` property controls if the IsoTriangle is rendered upside down or not.

#### Create shape object[​](#create-shape-object-5 "Direct link to Create shape object")

```
var isoTriangle = this.add.isotriangle(
  x,
  y,
  width,
  height,
  reversed,
  fillTop,
  fillLeft,
  fillRight
);
```

#### Custom class[​](#custom-class-7 "Direct link to Custom class")

*   Define class
    
    ```
    class MyIsoTriangle extends Phaser.GameObjects.IsoTriangle {
      constructor(
        scene,
        x,
        y,
        width,
        height,
        reversed,
        fillTop,
        fillLeft,
        fillRight
      ) {
        super(scene, x, y, width, height, reversed, fillTop, fillLeft, fillRight);
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
    var isoTriangle = new MyIsoTriangle(
      scene,
      x,
      y,
      width,
      height,
      reversed,
      fillTop,
      fillLeft,
      fillRight
    );
    ```
    

#### Set color[​](#set-color-1 "Direct link to Set color")

*   Fill color
    
    ```
    isoTriangle.setFillStyle(fillTop, fillLeft, fillRight);
    ```
    
*   Show face
    
    ```
    isoTriangle.setFaces(showTop, showLeft, showRight);
    ```
    
    *   `showTop`, `showLeft`, `showRight`: Set `true` to show that face

!!! warning "No tint methods" Uses `isoTriangle.setFillStyle(fillTop, fillLeft, fillRight)` to change color.

#### Alpha[​](#alpha-6 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = isoTriangle.alpha;
    ```
    
*   Set
    
    ```
    isoTriangle.setAlpha(alpha);
    // isoTriangle.alpha = alpha;
    ```
    

#### Projection[​](#projection-1 "Direct link to Projection")

The `projection` level of the iso box. Change this to change the 'angle' at which you are looking at the box.

*   Get
    
    ```
    var projection = isoTriangle.projection;
    ```
    
*   Set
    
    ```
    isoTriangle.setProjection(value);
    ```
    
    or
    
    ```
    isoTriangle.projection = value;
    ```
    

#### Reverse[​](#reverse "Direct link to Reverse")

*   Get
    
    ```
    var isReversed = isoTriangle.isReversed;
    ```
    
*   Set
    
    ```
    isoTriangle.setReversed(reversed);
    ```
    
    or
    
    ```
    isoTriangle.reversed = reversed;
    ```
    
    *   Set `true` to render upside down.

#### Display size[​](#display-size-6 "Direct link to Display size")

*   Get
    
    ```
    var width = isoTriangle.displayWidth;
    var height = isoTriangle.displayHeight;
    ```
    
*   Set
    
    ```
    isoTriangle.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    isoTriangle.displayWidth = width;
    isoTriangle.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-7 "Direct link to Create mask")

```
var mask = isoTriangle.createGeometryMask();
```

### Line[​](#line "Direct link to Line")

A Line Shape allows you to draw a line between two points in your game. You can control the stroke color and thickness of the line. In WebGL only you can also specify a different thickness for the start and end of the line, allowing you to render lines that taper-off.

If you need to draw multiple lines in a sequence you may wish to use the [Polygon Shape](#polygon) instead.

#### Create shape object[​](#create-shape-object-6 "Direct link to Create shape object")

```
var line = this.add.line(x, y, x1, y1, x2, y2, strokeColor);
// var line = this.add.line(x, y, x1, y1, x2, y2, strokeColor, strokeAlpha);
```

#### Custom class[​](#custom-class-8 "Direct link to Custom class")

*   Define class
    
    ```
    class MyCurve extends Phaser.GameObjects.Line {
      constructor(scene, x, y, x1, y1, x2, y2, strokeColor) {
        super(scene, x, y, x1, y1, x2, y2, strokeColor);
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
    var line = new MyLine(scene, x, y, x1, y1, x2, y2, strokeColor);
    ```
    

#### Set color[​](#set-color-2 "Direct link to Set color")

*   Fill color
    
    *   Get
        
        ```
        var color = line.fillColor;
        var alpha = line.fillAlpha;
        ```
        
    *   Set
        
        ```
        line.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        line.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = line.strokeColor;
        ```
        
    *   Set
        
        ```
        line.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        line.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `line.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-7 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = line.alpha;
    ```
    
*   Set
    
    ```
    line.setAlpha(alpha);
    // line.alpha = alpha;
    ```
    

#### Set end points[​](#set-end-points "Direct link to Set end points")

```
line.setTo(x1, y1, x2, y2);
```

#### Line width[​](#line-width "Direct link to Line width")

```
line.setLineWidth(startWidth, endWidth);
```

*   `endWidth` : The end width of the line. Only used in WebGL.

#### Display size[​](#display-size-7 "Direct link to Display size")

*   Get
    
    ```
    var width = line.displayWidth;
    var height = line.displayHeight;
    ```
    
*   Set
    
    ```
    line.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    line.displayWidth = width;
    line.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-8 "Direct link to Create mask")

```
var mask = line.createGeometryMask();
```

### Polygon[​](#polygon "Direct link to Polygon")

The Polygon Shape is created by providing a list of points, which are then used to create an internal Polygon geometry object. The points can be set from a variety of formats:

*   A string containing paired values separated by a single space: `'40 0 40 20 100 20 100 80 40 80 40 100 0 50'`
*   An array of Point or Vector2 objects: `[new Phaser.Math.Vector2(x1, y1), ...]`
*   An array of objects with public x/y properties: `[obj1, obj2, ...]`
*   An array of paired numbers that represent point coordinates: `[x1,y1, x2,y2, ...]`
*   An array of arrays with two elements representing x/y coordinates: `[[x1, y1], [x2, y2], ...]`

By default the `x` and `y` coordinates of this Shape refer to the center of it. However, depending on the coordinates of the points provided, the final shape may be rendered offset from its origin.

Note: The method `getBounds` will return incorrect bounds if any of the points in the Polygon are negative. If this is the case, please use the function `Phaser.Geom.Polygon.GetAABB(polygon.geom)` instead and then adjust the returned Rectangle position accordingly.

#### Create shape object[​](#create-shape-object-7 "Direct link to Create shape object")

```
var polygon = this.add.polygon(x, y, points, fillColor);
// var polygon = this.add.polygon(x, y, points, fillColor, fillAlpha);
```

*   `points` :
    *   An array of number : `[x0, y0, x1, y1, ...]`
    *   An array of points : `[{x:x0, y:y0}, {x:x1, y:y1}, ...]`
    *   A string : `'x0 y0 x1 y1 ...'`

!!! note Shift given points to align position **(0, 0)**

#### Custom class[​](#custom-class-9 "Direct link to Custom class")

*   Define class
    
    ```
    class MyPolygon extends Phaser.GameObjects.Polygon {
      constructor(scene, x, y, points, fillColor) {
        super(scene, x, y, points, fillColor);
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
    var polygon = new MyPolygon(scene, x, y, points, fillColor);
    ```
    

#### Color[​](#color-5 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = polygon.fillColor;
        var alpha = polygon.fillAlpha;
        ```
        
    *   Set
        
        ```
        polygon.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        polygon.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = polygon.strokeColor;
        ```
        
    *   Set
        
        ```
        polygon.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        polygon.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `polygon.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-8 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = polygon.alpha;
    ```
    
*   Set
    
    ```
    polygon.setAlpha(alpha);
    // polygon.alpha = alpha;
    ```
    

#### Smooth[​](#smooth "Direct link to Smooth")

Smooths the polygon over the number of iterations specified.

```
polygon.smooth(iterations);
```

#### Set points[​](#set-points "Direct link to Set points")

```
polygon.setTo(points);
```

*   `point` :
    *   A string containing paired values separated by a single space : `'40 0 40 20 100 20 100 80 40 80 40 100 0 50'`
    *   An array of Point objects : `[new Phaser.Point(x1, y1), ...]`
    *   An array of objects with public x/y properties : `[obj1, obj2, ...]`
    *   An array of paired numbers that represent point coordinates : `[x1,y1, x2,y2, ...]`
    *   An array of arrays with two elements representing x/y coordinates : `[[x1, y1], [x2, y2], ...]`

#### Display size[​](#display-size-8 "Direct link to Display size")

*   Get
    
    ```
    var width = polygon.displayWidth;
    var height = polygon.displayHeight;
    ```
    
*   Set
    
    ```
    polygon.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    polygon.displayWidth = width;
    polygon.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-9 "Direct link to Create mask")

```
var mask = polygon.createGeometryMask();
```

### Rectangle[​](#rectangle "Direct link to Rectangle")

Draw a rectangle shape.

#### Create shape object[​](#create-shape-object-8 "Direct link to Create shape object")

```
var rect = this.add.rectangle(x, y, width, height, fillColor);
// var rect = this.add.rectangle(x, y, width, height, fillColor, fillAlpha);
```

#### Custom class[​](#custom-class-10 "Direct link to Custom class")

*   Define class
    
    ```
    class MyRectangle extends Phaser.GameObjects.Rectangle {
      constructor(scene, x, y, width, height, fillColor) {
        super(scene, x, y, width, height, fillColor);
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
    var rect = new MyRectangle(scene, x, y, width, height, fillColor);
    ```
    

#### Color[​](#color-6 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = rect.fillColor;
        var alpha = rect.fillAlpha;
        ```
        
    *   Set
        
        ```
        rect.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        rect.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = rect.strokeColor;
        ```
        
    *   Set
        
        ```
        rect.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        rect.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `rect.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-9 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = rect.alpha;
    ```
    
*   Set
    
    ```
    rect.setAlpha(alpha);
    // rect.alpha = alpha;
    ```
    

#### Size[​](#size-1 "Direct link to Size")

*   Get
    
    ```
    var width = rect.width;
    var height = rect.height;
    ```
    
*   Set
    
    ```
    rect.setSize(width, height);
    ```
    
    or
    
    ```
    rect.width = width;
    rect.height = height;
    ```
    

#### Display size[​](#display-size-9 "Direct link to Display size")

*   Get
    
    ```
    var width = rect.displayWidth;
    var height = rect.displayHeight;
    ```
    
*   Set
    
    ```
    rect.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    rect.displayWidth = width;
    rect.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-10 "Direct link to Create mask")

```
var mask = rect.createGeometryMask();
```

### Star[​](#star "Direct link to Star")

Draw a star shape. You can control several aspects of it including the number of points that constitute the star. The default is 5. If you change it to 4 it will render as a diamond. If you increase them, you'll get a more spiky star shape.

You can also control the inner and outer radius, which is how 'long' each point of the star is. Modify these values to create more interesting shapes.

#### Create shape object[​](#create-shape-object-9 "Direct link to Create shape object")

```
var star = this.add.star(x, y, points, innerRadius, outerRadius, fillColor);
// var star = this.add.star(x, y, points, innerRadius, outerRadius, fillColor, fillAlpha);
```

*   `points` : The number of points on the star. Default is 5.
*   `innerRadius` : The inner radius of the star. Default is 32.
*   `outerRadius` : The outer radius of the star. Default is 64.

#### Custom class[​](#custom-class-11 "Direct link to Custom class")

*   Define class
    
    ```
    class MyStar extends Phaser.GameObjects.Star {
      constructor(scene, x, y, points, innerRadius, outerRadius, fillColor) {
        super(scene, x, y, points, innerRadius, outerRadius, fillColor);
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
    var star = new MyStar(
      scene,
      x,
      y,
      points,
      innerRadius,
      outerRadius,
      fillColor
    );
    ```
    

#### Color[​](#color-7 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = star.fillColor;
        var alpha = star.fillAlpha;
        ```
        
    *   Set
        
        ```
        star.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        star.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = star.strokeColor;
        ```
        
    *   Set
        
        ```
        star.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        star.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `star.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-10 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = star.alpha;
    ```
    
*   Set
    
    ```
    star.setAlpha(alpha);
    // star.alpha = alpha;
    ```
    

#### Radius[​](#radius-2 "Direct link to Radius")

*   Inner radius
    
    *   Get
        
        ```
        var innerRadius = star.innerRadius;
        ```
        
    *   Set
        
        ```
        star.setInnerRadius(innerRadius);
        ```
        
        or
        
        ```
        star.innerRadius = innerRadius;
        ```
        
*   Outer radius
    
    *   Get
        
        ```
        var outerRadius = star.outerRadius;
        ```
        
    *   Set
        
        ```
        star.setOuterRadius(outerRadius);
        ```
        
        or
        
        ```
        star.outerRadius = outerRadius;
        ```
        
*   Points
    
    *   Get
        
        ```
        var points = star.points;
        ```
        
    *   Set
        
        ```
        star.setPoints(points);
        ```
        
        or
        
        ```
        star.points = points;
        ```
        

#### Display size[​](#display-size-10 "Direct link to Display size")

*   Get
    
    ```
    var width = star.displayWidth;
    var height = star.displayHeight;
    ```
    
*   Set
    
    ```
    star.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    star.displayWidth = width;
    star.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-11 "Direct link to Create mask")

```
var mask = star.createGeometryMask();
```

### Triangle[​](#triangle "Direct link to Triangle")

Draw a triangle shape. The Triangle consists of 3 lines, joining up to form a triangular shape. You can control the position of each point of these lines. The triangle is always closed and cannot have an open face. If you require that, use a Polygon.

#### Create shape object[​](#create-shape-object-10 "Direct link to Create shape object")

```
var triangle = this.add.triangle(x, y, x1, y1, x2, y2, x3, y3, fillColor);
// var triangle = this.add.triangle(x, y, x1, y1, x2, y2, x3, y3, fillColor, fillAlpha);
```

#### Custom class[​](#custom-class-12 "Direct link to Custom class")

*   Define class
    
    ```
    class MyTriangle extends Phaser.GameObjects.Triangle {
      constructor(scene, x, y, x1, y1, x2, y2, x3, y3, fillColor) {
        super(scene, x, y, x1, y1, x2, y2, x3, y3, fillColor);
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
    var triangle = new MyTriangle(scene, x, y, x1, y1, x2, y2, x3, y3, fillColor);
    ```
    

#### Color[​](#color-8 "Direct link to Color")

*   Fill color
    
    *   Get
        
        ```
        var color = triangle.fillColor;
        var alpha = triangle.fillAlpha;
        ```
        
    *   Set
        
        ```
        triangle.setFillStyle(color, alpha);
        ```
        
    *   Clear
        
        ```
        triangle.setFillStyle();
        ```
        
*   Stroke color
    
    *   Get
        
        ```
        var color = triangle.strokeColor;
        ```
        
    *   Set
        
        ```
        triangle.setStrokeStyle(lineWidth, color, alpha);
        ```
        
    *   Clear
        
        ```
        triangle.setStrokeStyle();
        ```
        

!!! warning "No tint methods" Uses `triangle.setFillStyle(color, alpha)` to change color.

#### Alpha[​](#alpha-11 "Direct link to Alpha")

*   Get
    
    ```
    var alpha = triangle.alpha;
    ```
    
*   Set
    
    ```
    triangle.setAlpha(alpha);
    // triangle.alpha = alpha;
    ```
    

#### Set vertices[​](#set-vertices "Direct link to Set vertices")

```
triangle.setTo(x1, y1, x2, y2, x3, y3);
```

#### Triangle width[​](#triangle-width "Direct link to Triangle width")

```
triangle.setLineWidth(startWidth, endWidth);
```

*   `endWidth` : The end width of the triangle. Only used in WebGL.

#### Display size[​](#display-size-11 "Direct link to Display size")

*   Get
    
    ```
    var width = triangle.displayWidth;
    var height = triangle.displayHeight;
    ```
    
*   Set
    
    ```
    triangle.setDisplaySize(width, height);
    ```
    
    or
    
    ```
    triangle.displayWidth = width;
    triangle.displayHeight = height;
    ```
    

#### Create mask[​](#create-mask-12 "Direct link to Create mask")

```
var mask = triangle.createGeometryMask();
```

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
