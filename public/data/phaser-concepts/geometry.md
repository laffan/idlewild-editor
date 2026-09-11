# Geometry

Phaser has an extensive set of Geometry classes. These are used internally by the physics and input systems, but are also available for you to use in your own games. The geometry classes on offer include: Circle, Ellipse, Line, Point, Polygon, Rectangle, Triangle and the Mesh class.

Each of these classes has a set of methods and support functions that allow you to perform geometric operations on them. For example, you can check if a point is contained within a circle, get the bounds of an ellipse, or the nearest point from a line, as well as many other features.

There are also a wide range of intersection functions. You can test for conditions such as a Circle intersecting with a Rectangle, or getting the rays from a point to a polygon.

The Geometry classes are not Game Objects. You cannot add them on to the Display List. Instead, think of them as data structures that you can use to perform geometric operations on, of which most games tend to have quite a few.

## Circle[​](#circle "Direct link to Circle")

### Create circle[​](#create-circle "Direct link to Create circle")

```
var circle = new Phaser.Geom.Circle(x, y, radius);
```

### Clone circle[​](#clone-circle "Direct link to Clone circle")

```
var circle1 = Phaser.Geom.Circle.Clone(circle0);
```

### Draw on Graphics object[​](#draw-on-graphics-object "Direct link to Draw on Graphics object")

*   Fill shape
    
    ```
    // graphics.fillStyle(color, alpha);   // color: 0xRRGGBB
    graphics.fillCircleShape(circle);
    ```
    
*   Stroke shape
    
    ```
    // graphics.lineStyle(lineWidth, color, alpha);   // color: 0xRRGGBB
    graphics.strokeCircleShape(circle);
    ```
    

!!! note Negative radius will be treated as positive radius. i.e. `Math.abs(radius)`

### Set circle properties[​](#set-circle-properties "Direct link to Set circle properties")

*   All properties
    
    ```
    circle.setTo(x, y, radius);
    ```
    
    or
    
    ```
    Phaser.Geom.Circle.CopyFrom(source, dest);
    ```
    
    !!! note `CopyFrom` requires source and dest circles that already exist
    
*   Position
    
    ```
    circle.setPosition(x, y);
    ```
    
    or
    
    ```
    circle.x = 0;
    circle.y = 0;
    ```
    
    or
    
    ```
    circle.left = 0; // circle.x
    circle.top = 0; // circle.y
    // circle.right = 0;   // circle.x
    // circle.bottom = 0;  // circle.y
    ```
    
    or
    
    ```
    Phaser.Geom.Circle.Offset(circle, dx, dy); // circle.x += dx, circle.y += dy
    ```
    
    or
    
    ```
    Phaser.Geom.Circle.OffsetPoint(circle, point); // circle.x += point.x, circle.y += point.y
    ```
    
*   Radius
    
    ```
    circle.radius = radius;
    ```
    
    or
    
    ```
    circle.diameter = diameter; // diameter = 2 * radius
    ```
    

### Get properties[​](#get-properties "Direct link to Get properties")

*   Position
    
    ```
    var x = circle.x;
    var y = circle.y;
    var top = circle.top;
    var left = circle.left;
    var right = circle.right;
    var bottom = circle.bottom;
    ```
    
*   Radius
    
    ```
    var radius = circle.radius;
    // var diameter = circle.diameter;
    ```
    
*   Bounds
    
    ```
    var bound = Phaser.Geom.Circle.GetBounds(circle);
    // var bound = Phaser.Geom.Circle.GetBounds(circle, bound);  // push bound
    ```
    
    *   `bound` : `GetBounds` returns a Rectangle shape
*   Area
    
    ```
    var area = Phaser.Geom.Circle.Area(circle);
    ```
    
*   Circumference
    
    ```
    var circumference = Phaser.Geom.Circle.Circumference(circle);
    ```
    
*   Type:
    
    ```
    var type = circle.type; // GEOM_CONST.CIRCLE or 0
    ```
    

### Point(s) & shape[​](#points--shape "Direct link to Point(s) & shape")

*   Get point at circle's edge
    
    ```
    var point = circle.getPoint(t);
    // var point = circle.getPoint(t, point);
    ```
    
    *   Arguments:
        *   `t` : A value between 0 and 1, where 0 equals 0 degrees, 0.5 equals 180 degrees and 1 equals 360 around the circle.
        *   `point` : an existing point or returns a new point if point is not provided
    
    or
    
    ```
    var point = Phaser.Geom.Circle.CircumferencePoint(circle, angle); // angle in radians
    // var point = Phaser.Geom.Circle.CircumferencePoint(circle, angle, point);  // modify existing point or returns a new point if point is not provided
    ```
    
*   Get a random point inside circle
    
    ```
    var point = circle.getRandomPoint();
    // var point = circle.getRandomPoint(point);  // modify existing point or returns a new point if point is not provided
    ```
    
*   Get points around circle's edge.
    
    *   Based on quantity:
    
    ```
    var points = circle.getPoints(quantity);
    // var points = circle.getPoints(quantity, null, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   Based on stepRate:
    
    ```
    var points = circle.getPoints(false, stepRate);
    // var points = circle.getPoints(false, stepRate, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   `pointsArray` : an existing array
    *   `stepRate` : sets the quantity by getting the circumference of the circle divided by the stepRate
*   Point is inside circle
    
    ```
    var isInside = circle.contains(x, y);
    ```
    
    or
    
    ```
    var isInside = Phaser.Geom.Circle.ContainsPoint(circle, point);
    ```
    
*   Rectangle is inside shape
    
    ```
    var isInside = Phaser.Geom.Circle.ContainsRect(circle, rect); // rect : 4 points
    ```
    

### Empty[​](#empty "Direct link to Empty")

*   Set empty
    
    ```
    circle.setEmpty(); // circle.radius = 0
    ```
    
*   Is empty
    
    ```
    var isEmpty = circle.isEmpty(); // circle.radius <= 0
    ```
    

### Equal[​](#equal "Direct link to Equal")

```
var isEqual = Phaser.Geom.Circle.Equals(circle0, circle1);
```

Position and radius are equal.

### Intersection[​](#intersection "Direct link to Intersection")

#### Circle to [circle](#circle)[​](#circle-to-circle "Direct link to circle-to-circle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.CircleToCircle(circleA, circleB);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetCircleToCircle(circleA, circleB);
    // var out = Phaser.Geom.Intersects.GetCircleToCircle(circleA, circleB, out);
    ```
    

#### Circle to [rectangle](#rectangle)[​](#circle-to-rectangle "Direct link to circle-to-rectangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.CircleToRectangle(circle, rect);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetCircleToRectangle(circle, rect);
    // var out = Phaser.Geom.Intersects.GetCircleToRectangle(circle, rect, out);
    ```
    

#### Circle to [triangle](#triangle)[​](#circle-to-triangle "Direct link to circle-to-triangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.TriangleToCircle(triangle, circle);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetTriangleToCircle(triangle, circle);
    // var out = Phaser.Geom.Intersects.GetTriangleToCircle(triangle, circle, out);
    ```
    

#### Circle to [line](#line)[​](#circle-to-line "Direct link to circle-to-line")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.LineToCircle(line, circle);
    // var result = Phaser.Geom.Intersects.LineToCircle(line, circle, nearest);
    ```
    
    *   `nearest` : Nearest point on line.
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetLineToCircle(line, circle);
    // var out = Phaser.Geom.Intersects.GetLineToCircle(line, circle, out);
    ```
    

## Ellipse[​](#ellipse "Direct link to Ellipse")

### Create ellipse[​](#create-ellipse "Direct link to Create ellipse")

```
var ellipse = new Phaser.Geom.Ellipse(x, y, width, height);
```

### Clone ellipse[​](#clone-ellipse "Direct link to Clone ellipse")

```
var ellipse1 = Phaser.Geom.Ellipse.Clone(ellipse0);
```

### Draw on Graphics object[​](#draw-on-graphics-object-1 "Direct link to Draw on Graphics object")

*   Fill shape
    
    ```
    // graphics.fillStyle(color, alpha);   // color: 0xRRGGBB
    graphics.fillEllipseShape(ellipse);
    ```
    
*   Stroke shape
    
    ```
    // graphics.lineStyle(lineWidth, color, alpha);   // color: 0xRRGGBB
    graphics.strokeEllipseShape(ellipse);
    ```
    

!!! note Negative width, height will be treated as positive width, height. i.e. `Math.abs(width)`, `Math.abs(height)`

### Set properties[​](#set-properties "Direct link to Set properties")

*   All properties
    
    ```
    ellipse.setTo(x, y, width, height);
    ```
    
    or
    
    ```
    Phaser.Geom.Ellipse.CopyFrom(source, dest);
    ```
    
    !!! note `CopyFrom` requires source and dest circles that already exist
    
*   Position
    
    ```
    ellipse.setPosition(x, y);
    ```
    
    or
    
    ```
    ellipse.x = 0;
    ellipse.y = 0;
    ```
    
    or
    
    ```
    ellipse.left = 0; // ellipse.x
    ellipse.top = 0; // ellipse.y
    // ellipse.right = 0;   // ellipse.x
    // ellipse.bottom = 0;  // ellipse.y
    ```
    
    or
    
    ```
    Phaser.Geom.Ellipse.Offset(ellipse, dx, dy); // ellipse.x += dx, ellipse.y += dy
    ```
    
    or
    
    ```
    Phaser.Geom.Ellipse.OffsetPoint(ellipse, point); // ellipse.x += point.x, ellipse.y += point.y
    ```
    
*   Width, height
    
    ```
    ellipse.width = width;
    ellipse.height = height;
    ```
    

### Get properties[​](#get-properties-1 "Direct link to Get properties")

*   Position
    
    ```
    var x = ellipse.x;
    var y = ellipse.y;
    var top = ellipse.top;
    var left = ellipse.left;
    var right = ellipse.right;
    var bottom = ellipse.bottom;
    ```
    
*   Width, height
    
    ```
    var width = ellipse.width;
    var height = ellipse.height;
    ```
    
*   Bounds
    
    ```
    var bound = Phaser.Geom.Ellipse.GetBounds(ellipse);
    // var bound = Phaser.Geom.Ellipse.GetBounds(ellipse, bound);  // push bound
    ```
    
    *   `bound` : `GetBounds` returns a Rectangle shape
*   Area
    
    ```
    var area = Phaser.Geom.Ellipse.Area(ellipse);
    ```
    
*   Circumference
    
    ```
    var circumference = Phaser.Geom.Ellipse.Circumference(ellipse);
    ```
    
*   Type:
    
    ```
    var type = ellipse.type; // GEOM_CONST.ELLIPSE or 1
    ```
    

### Point(s) & shape[​](#points--shape-1 "Direct link to Point(s) & shape")

*   Get point at shape's edge
    
    ```
    var point = ellipse.getPoint(t);
    // var point = ellipse.getPoint(t, point);
    ```
    
    *   Arguments:
        *   `t` : A value between 0 and 1, where 0 equals 0 degrees, 0.5 equals 180 degrees and 1 equals 360 around the circle.
        *   `point` : an existing point or returns a new point if point is not provided
    
    or
    
    ```
    var point = Phaser.Geom.Ellipse.CircumferencePoint(ellipse, angle); // angle in degrees
    // var point = Phaser.Geom.Ellipse.CircumferencePoint(ellipse, angle, point);  // modify point
    ```
    
*   Get a random point inside shape
    
    ```
    var point = ellipse.getRandomPoint();
    // var point = ellipse.getRandomPoint(point);  // modify point
    ```
    
*   Get points around shape's edge
    
    *   Based on quantity:
    
    ```
    var points = ellipse.getPoints(quantity);
    // var points = ellipse.getPoints(quantity, null, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   Based on stepRate:
    
    ```
    var points = ellipse.getPoints(false, stepRate);
    // var points = ellipse.getPoints(false, stepRate, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   `pointsArray` : an existing array
    *   `stepRate` : sets the quantity by getting the circumference of the ellipse divided by the stepRate
*   Point is inside shape
    
    ```
    var isInside = ellipse.contains(x, y);
    ```
    
    or
    
    ```
    var isInside = Phaser.Geom.Ellipse.ContainsPoint(ellipse, point);
    ```
    
*   Rectangle is inside shape
    
    ```
    var isInside = Phaser.Geom.Ellipse.ContainsRect(ellipse, rect); // rect : 4 points
    ```
    

### Empty[​](#empty-1 "Direct link to Empty")

*   Set empty
    
    ```
    ellipse.setEmpty(); // ellipse.width = 0, ellipse.height = 0
    ```
    
*   Is empty
    
    ```
    var isEmpty = ellipse.isEmpty(); // ellipse.width <= 0 || ellipse.height <= 0
    ```
    

### Equal[​](#equal-1 "Direct link to Equal")

```
var isEqual = Phaser.Geom.Ellipse.Equals(ellipse0, ellipse1);
```

Position and width, height are equal.

## Line[​](#line "Direct link to Line")

### Create line[​](#create-line "Direct link to Create line")

```
var line = new Phaser.Geom.Line(x1, y1, x2, y2);
```

### Clone line[​](#clone-line "Direct link to Clone line")

```
var line1 = Phaser.Geom.Line.Clone(line0);
```

### Draw on Graphics object[​](#draw-on-graphics-object-2 "Direct link to Draw on Graphics object")

```
// graphics.lineStyle(lineWidth, color, alpha);   // color: 0xRRGGBB
graphics.strokeLineShape(line);
```

### Set properties[​](#set-properties-1 "Direct link to Set properties")

*   All properties
    
    ```
    line.setTo(x1, y1, x2, y2);
    ```
    
    or
    
    ```
    Phaser.Geom.Line.CopyFrom(source, dest);
    ```
    
*   Position
    
    ```
    line.x1 = 0;
    line.y1 = 0;
    line.x2 = 0;
    line.y2 = 0;
    ```
    
    or
    
    ```
    line.left = 0; // min(x1, x2)
    line.top = 0; // min(y1, y2)
    line.right = 0; // max(x1, x2)
    line.bottom = 0; // max(y1, y2)
    ```
    
    *   Offset start, end
        
        ```
        var line = Phaser.Geom.Line.Offset(line, dx, dy);
        // line.x1 += dx, line.y1 += dy, line.x2 += dx, line.y2 += dy
        ```
        
    *   Set center position
        
        ```
        var line = Phaser.Geom.Line.CenterOn(line, x, y);
        ```
        
*   Start point, angle, length
    
    ```
    var line = Phaser.Geom.Line.SetToAngle(line, x, y, angle, length);
    ```
    
    *   `line` : The line to set
        
    *   `x` , `y` : start point
        
    *   `angle` : The angle of the line in **radians**
        
        ```
        var rad = Phaser.Math.DegToRad(deg);
        ```
        
    *   `length` :　 The length of the line
        
*   Rotate
    
    *   Rotate around **midpoint**
        
        ```
        var line = Phaser.Geom.Line.Rotate(line, angle);
        ```
        
        *   `line` : The line to set
            
        *   `angle` : The angle of the line in **radians**
            
            ```
            var rad = Phaser.Math.DegToRad(deg);
            ```
            
    *   Rotate around point
        
        ```
        var line = Phaser.Geom.Line.RotateAroundPoint(line, point, angle);
        ```
        
        or
        
        ```
        var line = Phaser.Geom.Line.RotateAroundXY(line, x, y, angle);
        ```
        
        *   `line` : The line to set
            
        *   `angle` : The angle of the line in **radians**
            
            ```
            var rad = Phaser.Math.DegToRad(deg);
            ```
            
*   Extend
    
    ```
    var line = Phaser.Geom.Line.Extend(line, left, right);
    ```
    

### Get properties[​](#get-properties-2 "Direct link to Get properties")

*   Position
    
    ```
    var x1 = line.x1;
    var y1 = line.y1;
    var x2 = line.x2;
    var y2 = line.y2;
    var top = line.top; // min(x1, x2)
    var left = line.left; // min(y1, y2)
    var right = line.right; // max(x1, x2)
    var bottom = line.bottom; // max(y1, y2)
    ```
    
    *   Start point
        
        ```
        var start = line.getPointA(); // start: {x, y}
        var start = line.getPointA(start); // push start
        ```
        
    *   End point
        
        ```
        var end = line.getPointB(); // end: {x, y}
        var end = line.getPointB(end); // push end
        ```
        
    *   Middle point
        
        ```
        var middle = Phaser.Geom.Line.GetMidPoint(line); // middle: {x, y}
        // var middle = Phaser.Geom.Line.GetMidPoint(line, middle);
        ```
        
*   Length
    
    ```
    var length = Phaser.Geom.Line.Length(line);
    ```
    
    *   Width : Abs(x1 - x2)
        
        ```
        var width = Phaser.Geom.Line.Width(line);
        ```
        
    *   Height : Abs(y1 - y2)
        
        ```
        var width = Phaser.Geom.Line.Height(line);
        ```
        
*   Slope
    
    *   Slope : (y2 - y1) / (x2 - x1)
        
        ```
        var slope = Phaser.Geom.Line.Slope(line);
        ```
        
    *   Perpendicular slope : -((x2 - x1) / (y2 - y1))
        
        ```
        var perpSlope = Phaser.Geom.Line.PerpSlope(line);
        ```
        
*   Angle
    
    *   Angle
        
        ```
        var angle = Phaser.Geom.Line.Angle(line);
        ```
        
        *   `angle` : The angle of the line in **radians**
            
            ```
            var deg = Phaser.Math.RadToDeg(rad); // deg : -180 ~ 180
            ```
            
    *   Normal angle (angle - 90 degrees)
        
        *   Normal angle
            
            ```
            var normalAngle = Phaser.Geom.Line.NormalAngle(line);
            ```
            
        *   Normal vector
            
            ```
            var normal = Phaser.Geom.Line.GetNormal(line); // normal: {x, y}
            // var normal = Phaser.Geom.Line.GetNormal(line, normal);  // push normal
            ```
            
            or
            
            ```
            var normalX = Phaser.Geom.Line.NormalX(line);
            var normalY = Phaser.Geom.Line.NormalY(line);
            ```
            
    *   Reflect angle
        
        ```
        var reflectAngle = Phaser.Geom.Line.ReflectAngle(aimLine, reflectingLine);
        ```
        
*   Type:
    
    ```
    var type = line.type; // GEOM_CONST.LINE or 2
    ```
    

### Point(s) & shape[​](#points--shape-2 "Direct link to Point(s) & shape")

*   Get point at shape's edge
    
    ```
    var point = line.getPoint(t);
    // var point = line.getPoint(t, point);
    ```
    
    *   Arguments:
        *   `t` : A value between 0 and 1, where 0 is the start, 0.5 is the middle and 1 is the end point of the line.
        *   `point` : an existing point or returns a new point if point is not provided
*   Get a random point inside shape
    
    ```
    var point = line.getRandomPoint();
    // var point = line.getRandomPoint(point);  // modify point
    ```
    
*   Get points around shape's edge
    
    *   Based on quantity:
    
    ```
    var points = line.getPoints(quantity);
    // var points = line.getPoints(quantity, null, pointsArray);  // push points
    ```
    
    *   Based on stepRate:
    
    ```
    var points = line.getPoints(false, stepRate);
    // var points = line.getPoints(false, stepRate, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   `pointsArray` : an existing array
    *   `stepRate` : distance between each point on the line
*   Get points using _Bresenham_'s line algorithm
    
    ```
    var points = Phaser.Geom.Line.BresenhamPoints(line, step);
    // var points = Phaser.Geom.Line.BresenhamPoints(line, step, points);  // push points
    ```
    
*   Get points using easing function
    
    ```
    var points = Phaser.Geom.Line.GetEasedPoints(line, ease, quantity);
    // var points = Phaser.Geom.Line.GetEasedPoints(line, ease, quantity, collinearThreshold, easeParams);
    ```
    
    *   `ease` : String of [ease function](/phaser/concepts/tweens#easing-equations), or a custom function (`function (t) { return value}`).
    *   `quantity` : The number of points to return.
    *   `collinearThreshold` : Each point is spaced out at least this distance apart. This helps reduce clustering in noisey eases.
    *   `easeParams` : Array of ease parameters to go with the ease.
*   Get the nearest point on a line perpendicular to the given point.
    
    ```
    var point = Phaser.Geom.Line.GetNearestPoint(line, pointIn);
    // var point = Phaser.Geom.Line.GetNearestPoint(line, pointIn, point);
    ```
    
*   Get the shortest distance from a Line to the given Point.
    
    ```
    var distance = Phaser.Geom.Line.GetShortestDistance(line, point);
    ```
    

### Equal[​](#equal-2 "Direct link to Equal")

```
var isEqual = Phaser.Geom.Line.Equals(line0, line1);
```

x1, y2, x2, y2 are equal.

### Intersection[​](#intersection-1 "Direct link to Intersection")

#### Line to [circle](#circle)[​](#line-to-circle "Direct link to line-to-circle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.LineToCircle(line, circle);
    // var result = Phaser.Geom.Intersects.LineToCircle(line, circle, nearest);
    ```
    
    *   `nearest` : Nearest point on line.
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetLineToCircle(line, circle);
    // var out = Phaser.Geom.Intersects.GetLineToCircle(line, circle, out);
    ```
    

#### Line to [rectangle](#rectangle)[​](#line-to-rectangle "Direct link to line-to-rectangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.LineToRectangle(line, rect);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetLineToRectangle(line, rect);
    // var out = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, out);
    ```
    

#### Line to [triangle](#triangle)[​](#line-to-triangle "Direct link to line-to-triangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.TriangleToLine(triangle, line);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetTriangleToLine(triangle, line);
    // var out = Phaser.Geom.Intersects.GetTriangleToLine(triangle, line, out);
    ```
    

#### Line to [line](#line)[​](#line-to-line "Direct link to line-to-line")

*   Is intersection
    
    ```
    var isIntersection = Phaser.Geom.Intersects.LineToLine(line1, line2);
    ```
    
    *   `isIntersection` : Return `true` if line1 and line2 are intersectioned
*   Get intersection point
    
    ```
    var isIntersection = Phaser.Geom.Intersects.LineToLine(line1, line2, out);
    ```
    
    *   `isIntersection` : Return `true` if line1 and line2 are intersectioned
    *   `out` : intersected point

## Point[​](#point "Direct link to Point")

### Create point[​](#create-point "Direct link to Create point")

```
var point = new Phaser.Geom.Point(x, y);
```

### Clone point[​](#clone-point "Direct link to Clone point")

```
var point1 = Phaser.Geom.Point.Clone(point0);
```

### Draw on Graphics object[​](#draw-on-graphics-object-3 "Direct link to Draw on Graphics object")

```
// graphics.fillStyle(color, alpha);   // color: 0xRRGGBB
graphics.fillPointShape(point, size);
```

### Set properties[​](#set-properties-2 "Direct link to Set properties")

*   All properties
    
    ```
    point.setTo(x, y);
    ```
    
    or
    
    ```
    Phaser.Geom.Point.CopyFrom(source, dest);
    ```
    
*   Position
    
    ```
    point.x = 0;
    point.y = 0;
    ```
    
*   Round
    
    *   Ceil : Apply `Math.ceil()` to each coordinate of the given Point
        
        ```
        var point = Phaser.Geom.Point.Ceil(point);
        ```
        
    *   Floor : Apply `Math.floor()` to each coordinate of the given Point.
        
        ```
        var point = Phaser.Geom.Point.Floor(point);
        ```
        

### Symmetry[​](#symmetry "Direct link to Symmetry")

*   Invert : x = y, y = x
    
    ```
    var point = Phaser.Geom.Point.Invert(point);
    ```
    
*   Negative : x = -x, y = -y
    
    ```
    var out = Phaser.Geom.Point.Negative(point);
    // var out = Phaser.Geom.Point.Negative(point, out);  // modify out
    ```
    

### Get properties[​](#get-properties-3 "Direct link to Get properties")

*   Position
    
    ```
    var x = point.x;
    var y = point.y;
    ```
    
*   Type:
    
    ```
    var type = point.type; // GEOM_CONST.POINT or 3
    ```
    

### Equal[​](#equal-3 "Direct link to Equal")

```
var isEqual = Phaser.Geom.Point.Equals(point0, point1);
```

x, y are equal.

### Points[​](#points "Direct link to Points")

*   Centroid : center-point over some points
    
    ```
    var out = Phaser.Geom.Point.GetCentroid(points);
    // var out = Phaser.Geom.Point.GetCentroid(points, out);  // modify out
    ```
    
*   Calculates the Axis Aligned Bounding Box (or aabb) from an array of points ([rectangle](#rectangle))
    
    ```
    var rect = Phaser.Geom.Point.GetRectangleFromPoints(points);
    // var rect = Phaser.Geom.Point.GetRectangleFromPoints(points, rect);  // modify rect
    ```
    
*   Interpolate
    
    ```
    var out = Phaser.Geom.Point.Interpolate(pointA, pointB, t); // out : point
    // var out = Phaser.Geom.Point.Interpolate(pointA, pointB, t, out);  // modify out
    ```
    

### Intersection[​](#intersection-2 "Direct link to Intersection")

*   Point to [line](#line)
    
    ```
    var result = Phaser.Geom.Intersects.PointToLine(point, line);
    // var result = Phaser.Geom.Intersects.PointToLine(point, line, lineThickness);
    ```
    
    ```
    var result = Phaser.Geom.Intersects.PointToLineSegment(point, line);
    ```
    

### Point as Vector[​](#point-as-vector "Direct link to Point as Vector")

Vector starting at (0,0)

*   Magnitude : sqrt( (x \_ x) + (y \_ y) )
    
    ```
    var magnitude = Phaser.Geom.Point.GetMagnitude(point);
    ```
    
    or
    
    ```
    var magnitudeSq = Phaser.Geom.Point.GetMagnitudeSq(point);
    ```
    
*   Project
    
    ```
    var out = Phaser.Geom.Point.Project(from, to);
    // var out = Phaser.Geom.Point.Project(from, to, out);  // modify out
    ```
    
    or
    
    ```
    var out = Phaser.Geom.Point.ProjectUnit(from, to); // vector `from` and `to` are unit vector (length = 1)
    // var out = Phaser.Geom.Point.ProjectUnit(from, to, out);  // modify out
    ```
    

## Polygon[​](#polygon "Direct link to Polygon")

### Create polygon[​](#create-polygon "Direct link to Create polygon")

```
var polygon = new Phaser.Geom.Polygon(points);
```

*   `points` :
    *   An array of number : `[x0, y0, x1, y1, ...]`
    *   An array of points : `[{x:x0, y:y0}, {x:x1, y:y1}, ...]`
    *   A string : `'x0 y0 x1 y1 ...'`

### Clone polygon[​](#clone-polygon "Direct link to Clone polygon")

```
var polygon1 = Phaser.Geom.Polygon.Clone(polygon0);
```

### Draw on Graphics object[​](#draw-on-graphics-object-4 "Direct link to Draw on Graphics object")

*   Fill shape
    
    ```
    // graphics.fillStyle(color, alpha);   // color: 0xRRGGBB
    graphics.fillPoints(polygon.points, true);
    ```
    
*   Stroke shape
    
    ```
    // graphics.lineStyle(lineWidth, color, alpha);   // color: 0xRRGGBB
    graphics.strokePoints(polygon.points, true);
    ```
    

### Set properties[​](#set-properties-3 "Direct link to Set properties")

```
polygon.setTo(points);
// points = [x0, y0, x1, y1, x2, y2, ...] , or [{x,y}, {x,y}, {x,y}, ...]
```

### Get properties[​](#get-properties-4 "Direct link to Get properties")

*   Points
    
    ```
    var points = polygon.points; // array of points {x,y}
    ```
    
*   Area
    
    ```
    var area = polygon.area;
    ```
    
*   Number array
    
    ```
    var out = Phaser.Geom.Polygon.GetNumberArray(polygon);
    // var out = Phaser.Geom.Polygon.GetNumberArray(polygon, out);  // modify out
    ```
    
    *   `arr` : \[x0, y0, x1, y1, x2, y2, ...\]
*   AABB (A minimum rectangle to cover this polygon)
    
    ```
    var out = Phaser.Geom.Polygon.GetAABB(polygon);
    // var out = Phaser.Geom.Polygon.GetAABB(polygon, out);
    ```
    
    *   `out` : A [rectangle](#rectangle)
*   Type:
    
    ```
    var type = polygon.type; // GEOM_CONST.POLYGON or 4
    ```
    

### Point(s) & shape[​](#points--shape-3 "Direct link to Point(s) & shape")

*   Point is inside shape
    
    ```
    var isInside = polygon.contains(x, y);
    ```
    
    or
    
    ```
    var isInside = Phaser.Geom.Polygon.ContainsPoint(polygon, point);
    ```
    
*   Translate : Shift points.
    
    ```
    Phaser.Geom.Polygon.Translate(polygon, x, y);
    ```
    
*   Reverse the order of points.
    
    ```
    var polygon = Phaser.Geom.Polygon.Reverse(polygon);
    ```
    
*   Smooth : Takes a Polygon object and applies Chaikin's smoothing algorithm on its points.
    
    ```
    Phaser.Geom.Polygon.Smooth(polygon);
    ```
    
*   Simplify : Simplifies the points by running them through a combination of Douglas-Peucker and Radial Distance algorithms. Simplification dramatically reduces the number of points in a polygon while retaining its shape, giving a huge performance boost when processing it and also reducing visual noise.
    
    ```
    var polygon = Phaser.Geom.Polygon.Simplify(polygon);
    // var polygon = Phaser.Geom.Polygon.Simplify(polygon, tolerance, highestQuality);
    ```
    
*   Get points around the polygon's perimeter.
    
    *   Based on quantity:
    
    ```
    var points = polygon.getPoints(quantity);
    // var points = polygon.getPoints(quantity, null, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   Based on stepRate:
    
    ```
    var points = polygon.getPoints(false, stepRate);
    // var points = polygon.getPoints(false, stepRate, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   `pointsArray` : an existing array
    *   `stepRate` : sets the quantity by getting the perimeter of the Polygon divided it by the stepRate

### Vector to polygon[​](#vector-to-polygon "Direct link to Vector to polygon")

*   Get closest point of intersection between a vector and an array of polygons
    
    ```
    var result = Phaser.Geom.Intersects.GetLineToPolygon(line, polygons);
    // var out = Phaser.Geom.Intersects.GetLineToPolygon(line, polygons, isRay, out);
    ```
    
    *   `line` : Vector of [line](#line) object
    *   `polygons` : A single polygon, or array of polygons
    *   `isRay` : Is `line` a ray or a line segment?
    *   `out` :
        *   `out.x`, `out.y` : Intersection point
        *   `out.z` : Closest intersection distance
        *   `out.w` : Index of the polygon
*   Projects rays out from the given point to each line segment of the polygons.
    
    ```
    var out = Phaser.Geom.Intersects.GetRaysFromPointToPolygon(x, y, polygons);
    ```
    
    *   `x`, `y` : The point to project the rays from.
    *   `polygons` : A single polygon, or array of polygons
    *   `out` : An array containing all intersections
        *   `out[i].x`, `out[i].y` : Intersection point
        *   `out[i].z` : Angle of intersection
        *   `out[i].w` : Index of the polygon

## Rectangle[​](#rectangle "Direct link to Rectangle")

### Create rectangle[​](#create-rectangle "Direct link to Create rectangle")

```
var rect = new Phaser.Geom.Rectangle(x, y, width, height);
```

### Create rectangle from points[​](#create-rectangle-from-points "Direct link to Create rectangle from points")

All of the given points are on or within its bounds.

```
var rect = Phaser.Geom.Rectangle.FromPoints(points);
// var rect = Phaser.Geom.Rectangle.FromPoints(points, rect);  // push rect
```

*   `points` : an array with 4 points. `[x, y]`, or `{x:0, y:0}`

or

```
var rect = Phaser.Geom.Rectangle.FromXY(x1, y1, x2, y2);
// var rect = Phaser.Geom.Rectangle.FromXY(x1, y1, x2, y2, rect);  // push rect
```

### Clone rectangle[​](#clone-rectangle "Direct link to Clone rectangle")

```
var rect1 = Phaser.Geom.Rectangle.Clone(rect0);
```

### Draw on Graphics object[​](#draw-on-graphics-object-5 "Direct link to Draw on Graphics object")

*   Fill shape
    
    ```
    // graphics.fillStyle(color, alpha);   // color: 0xRRGGBB
    graphics.fillRectShape(rect);
    ```
    
*   Stroke shape
    
    ```
    // graphics.lineStyle(lineWidth, color, alpha);   // color: 0xRRGGBB
    graphics.strokeRectShape(rect);
    ```
    

!!! note `x` with positive/negative width is left/right bound  
`y` with positive/negative height is top/bottom bound

### Set properties[​](#set-properties-4 "Direct link to Set properties")

*   All properties
    
    ```
    rect.setTo(x, y, width, height);
    ```
    
    or
    
    ```
    Phaser.Geom.Rectangle.CopyFrom(source, dest);
    ```
    
*   Position
    
    ```
    rect.setPosition(x, y);
    ```
    
    or
    
    ```
    rect.x = 0;
    rect.y = 0;
    ```
    
    or
    
    ```
    rect.left = 0; // rect.x, rect.width
    rect.top = 0; // rect.y, rect.height
    // rect.right = 0;   // rect.x, rect.width
    // rect.bottom = 0;  // rect.y, rect.height
    rect.centerX = 0; // rect.x
    rect.centerY = 0; // rect.y
    ```
    
    or
    
    ```
    Phaser.Geom.Rectangle.Offset(rect, dx, dy); // rect.x += dx, rect.y += dy
    ```
    
    or
    
    ```
    Phaser.Geom.Rectangle.OffsetPoint(rect, point); // rect.x += point.x, rect.y += point.y
    ```
    
    or
    
    ```
    Phaser.Geom.Rectangle.CenterOn(rect, x, y); // rect.x = x - (rect.width / 2), rect.y = y - (rect.height / 2)
    ```
    
*   Size
    
    ```
    rect.setSize(width, height);
    // rect.setSize(width);   // height = width
    ```
    
    or
    
    ```
    rect.width = 0;
    rect.height = 0;
    ```
    
    *   Scale
        
        ```
        Phaser.Geom.Rectangle.Scale(rect, x, y); // rect.width *= x, rect.height *= y;
        // Phaser.Geom.Rectangle.Scale(rect, x);   // y = x
        ```
        
    *   Extend size to include points
        
        ```
        Phaser.Geom.Rectangle.MergePoints(rect, points);
        ```
        
        *   `points` : an array of points. `[x, y]`, or `{x:0, y:0}`
    *   Extend size to include another rectangle
        
        ```
        Phaser.Geom.Rectangle.MergeRect(target, source);
        ```
        
*   Inflate
    
    ```
    Phaser.Geom.Rectangle.Inflate(rect, x, y);
    ```
    
    1.  change size to `width += x*2, height += y*2`
    2.  center on previous position
*   Fits the target rectangle into the source rectangle
    
    ```
    Phaser.Geom.Rectangle.FitInside(target, source);
    ```
    
    Preserves aspect ratio, scales and centers the target rectangle to the source rectangle
    
*   Fits the target rectangle around the source rectangle
    
    ```
    Phaser.Geom.Rectangle.FitOutside(target, source);
    ```
    
    Preserves aspect ratio, scales and centers the target rectangle to the source rectangle
    
*   Ceil
    
    ```
    Phaser.Geom.Rectangle.Ceil(rect); // ceil x, y
    ```
    
    ```
    Phaser.Geom.Rectangle.CeilAll(rect); // ceil x, y, width, height
    ```
    
*   Floor
    
    ```
    Phaser.Geom.Rectangle.Floor(rect); // floor x, y
    ```
    
    ```
    Phaser.Geom.Rectangle.FloorAll(rect); // floor x, y, width, height
    ```
    

### Get properties[​](#get-properties-5 "Direct link to Get properties")

*   Position
    
    ```
    var x = rect.x;
    var y = rect.y;
    ```
    
    *   Bound
        
        ```
        var top = rect.top;
        var left = rect.left;
        var right = rect.right;
        var bottom = rect.bottom;
        ```
        
        or
        
        ```
        var points = Phaser.Geom.Rectangle.Decompose(rect);
        // var points = Phaser.Geom.Rectangle.Decompose(rect, points); // push result points
        ```
        
        *   `points` : top-left, top-right, bottom-right, bottom-left
    *   Center
        
        ```
        var centerX = rect.centerX;
        var centerY = rect.centerY;
        ```
        
        or
        
        ```
        var point = Phaser.Geom.Rectangle.GetCenter(rect);
        // var point = Phaser.Geom.Rectangle.GetCenter(rect, point);
        ```
        
*   Size
    
    ```
    var width = rect.width;
    var height = rect.height;
    ```
    
    or
    
    ```
    var point = Phaser.Geom.Rectangle.GetSize(rect); // {x: rect.width, y: rect.height}
    ```
    
*   Area
    
    ```
    var area = Phaser.Geom.Rectangle.Area(rect);
    ```
    
*   Perimeter
    
    ```
    var perimeter = Phaser.Geom.Rectangle.Perimeter(rect); // 2 * (rect.width + rect.height)
    ```
    
*   Aspect ratio
    
    ```
    var aspectRatio = Phaser.Geom.Rectangle.GetAspectRatio(rect); // rect.width / rect.height
    ```
    
*   Lines around rectangle
    
    ```
    var topLine = rect.getLineA(); // top line of this rectangle
    var rightLine = rect.getLineB(); // right line of this rectangle
    var bottomLine = rect.getLineC(); // bottom line of this rectangle
    var leftLine = rect.getLineD(); // left line of this rectangle
    // var out = rect.getLineA(out);  // top line of this rectangle
    ```
    
*   Type:
    
    ```
    var type = rect.type; // GEOM_CONST.RECTANGLE or 5
    ```
    

### Point(s) & shape[​](#points--shape-4 "Direct link to Point(s) & shape")

*   Get point at shape's edge
    
    ```
    var point = rect.getPoint(t); // t : 0 ~ 1 (0= top-left, 0.5= bottom-right, 1= top-left)
    // var point = rect.getPoint(t, point);
    ```
    
    *   Arguments:
        *   `t` : A value of 0 or 1 is at the top left corner, 0.5 is at the bottom right corner. Values 0 to 0.5 are on the top or the right side, values 0.5 to 1 are on the bottom or the left side.
        *   `point` : an existing point or returns a new point if point is not provided
    
    or
    
    ```
    var point = Phaser.Geom.Rectangle.PerimeterPoint(rect, angle); // angle in degrees
    // var point = Phaser.Geom.Rectangle.PerimeterPoint(rect, angle, point);  // push point
    ```
    
*   Get points around shape's edge
    
    *   Based on quantity:
    
    ```
    var points = rect.getPoints(quantity);
    // var points = rect.getPoints(quantity, null, pointsArray);  // push points
    ```
    
    *   Based on stepRate:
    
    ```
    var points = rect.getPoints(false, stepRate);
    // var points = rect.getPoints(false, stepRate, pointsArray);  // If pointsArray not provided a new array will be created.
    ```
    
    *   `pointsArray` : an existing array
    *   `stepRate` : if quantity is 0, determines the normalized distance between each returned point
*   Point is inside shape
    
    ```
    var isInside = rect.contains(x, y);
    ```
    
    or
    
    ```
    var isInside = Phaser.Geom.Rectangle.ContainsPoint(rect, point);
    ```
    
*   Get a random point inside shape
    
    ```
    var point = rect.getRandomPoint();
    // var point = rect.getRandomPoint(point);  // modify point
    ```
    
*   Get a random point outside shape
    
    ```
    var point = Phaser.Geom.Rectangle.RandomOutside(outer, inner);
    // var point = Phaser.Geom.Rectangle.RandomOutside(outer, inner, point); // modify point
    ```
    
*   Rectangle is inside shape
    
    ```
    var isInside = Phaser.Geom.Rectangle.ContainsRect(rectA, rectB); // rectB is inside rectA
    ```
    

### Multiple rectangles[​](#multiple-rectangles "Direct link to Multiple rectangles")

*   Is overlapping
    
    ```
    var isOverlapping = Phaser.Geom.Rectangle.Overlaps(rectA, rectB);
    ```
    
*   Get intersection rectangle
    
    ```
    var rect = Phaser.Geom.Rectangle.Intersection(rectA, rectB);
    var rect = Phaser.Geom.Rectangle.Intersection(rectA, rectB, rect); // push rect
    ```
    
*   Get union rectangle
    
    ```
    var rect = Phaser.Geom.Rectangle.Union(rectA, rectB);
    var rect = Phaser.Geom.Rectangle.Union(rectA, rectB, rect); // push rect
    ```
    

### Empty[​](#empty-2 "Direct link to Empty")

*   Set empty
    
    ```
    rect.setEmpty(); // rect.x = 0, rect.y = 0, rect.width = 0, rect.height = 0
    ```
    
*   Is empty
    
    ```
    var isEmpty = rect.isEmpty(); // rect.radius <= 0;
    ```
    

### Equal[​](#equal-4 "Direct link to Equal")

*   Position, width, and height are the same
    
    ```
    var isEqual = Phaser.Geom.Rectangle.Equals(rect0, rect1);
    ```
    
*   Width and height are the same
    
    ```
    var isEqual = Phaser.Geom.Rectangle.SameDimensions(rect0, rect1);
    ```
    

### Intersection[​](#intersection-3 "Direct link to Intersection")

#### Rectangle to [circle](#circle)[​](#rectangle-to-circle "Direct link to rectangle-to-circle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.CircleToRectangle(circle, rect);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetCircleToRectangle(circle, rect);
    // var out = Phaser.Geom.Intersects.GetCircleToRectangle(circle, rect, out);
    ```
    

#### Rectangle to [rectangle](#rectangle)[​](#rectangle-to-rectangle "Direct link to rectangle-to-rectangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.RectangleToRectangle(rectA, rectB);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetRectangleToRectangle(rectA, rectB);
    // var out = Phaser.Geom.Intersects.GetRectangleToRectangle(rectA, rectB, out);
    ```
    

#### Rectangle to [triangle](#triangle)[​](#rectangle-to-triangle "Direct link to rectangle-to-triangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.RectangleToTriangle(rect, triangle);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetRectangleToTriangle(rect, triangle);
    // var out = Phaser.Geom.Intersects.GetRectangleToTriangle(rect, triangle, out);
    ```
    

#### Rectangle to [line](#line)[​](#rectangle-to-line "Direct link to rectangle-to-line")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.LineToRectangle(line, rect);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetLineToRectangle(line, rect);
    // var out = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, out);
    ```
    

## Triangle[​](#triangle "Direct link to Triangle")

### Create triangle[​](#create-triangle "Direct link to Create triangle")

```
var triangle = new Phaser.Geom.Triangle(x1, y1, x2, y2, x3, y3);
```

### Clone triangle[​](#clone-triangle "Direct link to Clone triangle")

```
var triangle1 = Phaser.Geom.Triangle.Clone(triangle0);
```

### Equilateral triangle[​](#equilateral-triangle "Direct link to Equilateral triangle")

```
var triangle = Phaser.Geom.Triangle.BuildEquilateral(x1, y1, length);
```

### Right triangle[​](#right-triangle "Direct link to Right triangle")

```
var triangle = Phaser.Geom.Triangle.BuildRight(x1, y1, width, height);
```

### [Polygon](#polygon) to triangles[​](#polygon-to-triangles "Direct link to polygon-to-triangles")

```
var out = Phaser.Geom.Triangle.BuildFromPolygon(data);
// var out = Phaser.Geom.Triangle.BuildFromPolygon(data, holes, scaleX, scaleY);
// out = Phaser.Geom.Triangle.BuildFromPolygon(data, holes, scaleX, scaleY, out);
```

*   `data` : A flat array of vertice coordinates like `[x0,y0, x1,y1, x2,y2, ...]`
*   `out` : Array of triangles

### Draw on Graphics object[​](#draw-on-graphics-object-6 "Direct link to Draw on Graphics object")

*   Fill shape
    
    ```
    // graphics.fillStyle(color, alpha);   // color: 0xRRGGBB
    graphics.fillTriangleShape(triangle);
    ```
    
*   Stroke shape
    
    ```
    // graphics.lineStyle(lineWidth, color, alpha);   // color: 0xRRGGBB
    graphics.strokeTriangleShape(triangle);
    ```
    

### Set properties[​](#set-properties-5 "Direct link to Set properties")

*   All properties
    
    ```
    triangle.setTo(x1, y1, x2, y2, x3, y3);
    ```
    
    or
    
    ```
    Phaser.Geom.Triangle.CopyFrom(source, dest);
    ```
    
*   Position
    
    ```
    triangle.x1 = 0;
    triangle.y1 = 0;
    triangle.x2 = 0;
    triangle.y2 = 0;
    triangle.x3 = 0;
    triangle.y3 = 0;
    ```
    
    or
    
    ```
    triangle.left = 0; // triangle.x1, triangle.x2, triangle.x3
    triangle.top = 0; // triangle.y1, triangle.y2, triangle.y3
    // triangle.right = 0;   // triangle.x1, triangle.x2, triangle.x3
    // triangle.bottom = 0;  // triangle.y1, triangle.y2, triangle.y3
    ```
    
    or
    
    ```
    Phaser.Geom.Triangle.Offset(triangle, dx, dy); // triangle.x += dx, triangle.y += dy
    ```
    
    or
    
    ```
    Phaser.Geom.Triangle.CenterOn(triangle, x, y);
    ```
    
*   Rotate
    
    *   Rotate around center (incenter)
        
        ```
        var triangle = Phaser.Geom.Triangle.Rotate(triangle, angle);
        ```
        
        *   `angle` : Radian
    *   Rotate around point
        
        ```
        var triangle = Phaser.Geom.Triangle.RotateAroundPoint(
          triangle,
          point,
          angle
        );
        ```
        
        *   `point` : `{x, y}`
        *   `angle` : Radian
    *   Rotate around (x,y)
        
        ```
        var triangle = Phaser.Geom.Triangle.RotateAroundXY(triangle, x, y, angle);
        ```
        
        *   `angle` : Radian

### Get properties[​](#get-properties-6 "Direct link to Get properties")

*   Position
    
    ```
    var x1 = triangle.x1;
    var y1 = triangle.y1;
    var x2 = triangle.x2;
    var y2 = triangle.y2;
    var x3 = triangle.x3;
    var y3 = triangle.y3;
    var top = triangle.top;
    var left = triangle.left;
    var right = triangle.right;
    var bottom = triangle.bottom;
    ```
    
    or
    
    ```
    var out = Phaser.Geom.Triangle.Decompose(triangle); // out: [{x1,y1}, {x2,y2}, {x3,y3}]
    // var out = Phaser.Geom.Triangle.Decompose(triangle, out);
    ```
    
*   Perimeter
    
    ```
    var perimeter = Phaser.Geom.Triangle.Perimeter(triangle);
    ```
    
*   Area
    
    ```
    var area = Phaser.Geom.Triangle.Area(triangle);
    ```
    
*   Lines around triangle
    
    ```
    var line12 = rect.getLineA(); // line from (x1, y1) to (x2, y2)
    var line23 = rect.getLineB(); // line from (x2, y2) to (x3, y3)
    var line31 = rect.getLineC(); // line from (x3, y3) to (x1, y1)
    ```
    
*   Centroid
    
    ```
    var out = Phaser.Geom.Triangle.Centroid(triangle); // out: {x,y}
    ```
    
*   Incenter
    
    ```
    var out = Phaser.Geom.Triangle.InCenter(triangle); // out: {x,y}
    // var out = Phaser.Geom.Triangle.InCenter(triangle, out);
    ```
    
*   Circumcenter
    
    ```
    var out = Phaser.Geom.Triangle.CircumCenter(triangle); // out: {x,y}
    // var out = Phaser.Geom.Triangle.CircumCenter(triangle, out);
    ```
    
*   Circumcircle
    
    ```
    var out = Phaser.Geom.Triangle.CircumCircle(triangle); // out: a circle object
    // var out = Phaser.Geom.Triangle.CircumCircle(triangle, out);
    ```
    
*   Type:
    
    ```
    var type = triangle.type; // GEOM_CONST.TRIANGLE or 6
    ```
    

### Point(s) & shape[​](#points--shape-5 "Direct link to Point(s) & shape")

*   Get point at shape's edge
    
    ```
    var point = triangle.getPoint(t);
    // var point = triangle.getPoint(t, point);
    ```
    
    *   Arguments:
        *   `t` : A value of 0 or 1 is the first point. Values 0 to 1 returns a point along the perimeter of the triangle.
        *   `point` : an existing point or returns a new point if point is not provided
*   Get a random point inside shape
    
    ```
    var point = triangle.getRandomPoint();
    // var point = triangle.getRandomPoint(point);  // modify point
    ```
    
*   Get points around triangle's edge
    
    *   Based on quantity:
    
    ```
    var points = triangle.getPoints(quantity);
    // var points = triangle.getPoints(quantity, null, points);  // push points
    ```
    
    *   Based on stepRate:
    
    ```
    var points = triangle.getPoints(false, stepRate);
    // var points = triangle.getPoints(false, stepRate, points);  // If pointsArray not provided a new array will be created.
    ```
    
    *   `pointsArray` : an existing array
    *   `stepRate` : used only when quantity is falsey and is the distance between two points
*   Point is inside shape
    
    ```
    var isInside = triangle.contains(x, y);
    ```
    
    or
    
    ```
    var isInside = Phaser.Geom.Triangle.ContainsPoint(triangle, point);
    ```
    
    *   Points inside shape
        
        ```
        var out = Phaser.Geom.Triangle.ContainsArray(triangle, points, returnFirst);
        // var out = Phaser.Geom.Triangle.ContainsArray(triangle, points, returnFirst, out);
        ```
        
        *   `out` : Points inside triangle
        *   `returnFirst` : True to get fist matched point

### Equal[​](#equal-5 "Direct link to Equal")

```
var isEqual = Phaser.Geom.Triangle.Equals(triangle0, triangle1);
```

Position and radius are equal.

### Intersection[​](#intersection-4 "Direct link to Intersection")

#### Triangle to [circle](#circle)[​](#triangle-to-circle "Direct link to triangle-to-circle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.TriangleToCircle(triangle, circle);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetTriangleToCircle(triangle, circle);
    // var out = Phaser.Geom.Intersects.GetTriangleToCircle(triangle, circle, out);
    ```
    

#### Triangle to [rectangle](#rectangle)[​](#triangle-to-rectangle "Direct link to triangle-to-rectangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.RectangleToTriangle(rect, triangle);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetRectangleToTriangle(rect, triangle);
    // var out = Phaser.Geom.Intersects.GetRectangleToTriangle(rect, triangle, out);
    ```
    

#### Triangle to [triangle](#triangle)[​](#triangle-to-triangle "Direct link to triangle-to-triangle")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.TriangleToTriangle(triangleA, triangleB);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetTriangleToTriangle(
      triangleA,
      triangleB
    );
    // var out = Phaser.Geom.Intersects.GetTriangleToTriangle(triangleA, triangleB, out);
    ```
    

#### Triangle to [line](#line)[​](#triangle-to-line "Direct link to triangle-to-line")

*   Is intersection
    
    ```
    var result = Phaser.Geom.Intersects.TriangleToLine(triangle, line);
    ```
    
*   Get intersection points
    
    ```
    var result = Phaser.Geom.Intersects.GetTriangleToLine(triangle, line);
    // var out = Phaser.Geom.Intersects.GetTriangleToLine(triangle, line, out);
    ```
    

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
