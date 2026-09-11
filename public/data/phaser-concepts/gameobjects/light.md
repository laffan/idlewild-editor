# Light

A 2D Light created by the `Phaser.GameObjects.LightsManager`, available from within a scene via `this.lights`.

Any Game Objects using the Light2D pipeline will then be affected by these Lights as long as they have a normal map.

They can also simply be used to represent a point light for your own purposes.

!!! warning "WebGL only" Lights cannot be added to Containers. They are designed to exist in the root of a Scene.

!!! warning "WebGL only" It only works in WebGL render mode.

## Lights Manager[​](#lights-manager "Direct link to Lights Manager")

### Enable Lights Manager[​](#enable-lights-manager "Direct link to Enable Lights Manager")

*   Enable
    
    ```
    this.lights.enable();
    ```
    
*   Disable
    
    ```
    this.lights.disable();
    ```
    
    or
    
    ```
    this.lights.active = false;
    ```
    

### Ambient color[​](#ambient-color "Direct link to Ambient color")

```
this.lights.setAmbientColor(color);
```

*   `color` : Integer color value.

### Get all lights managed by this Lights Manager[​](#get-all-lights-managed-by-this-lights-manager "Direct link to Get all lights managed by this Lights Manager")

```
    var lightsCount = this.lights.getLightCount();
```

### Get all lights seen by the given Camera[​](#get-all-lights-seen-by-the-given-camera "Direct link to Get all lights seen by the given Camera")

```
    var visibleLights = this.lights.getLights(camera);
```

*   `camera` : The Camera to cull Lights for.

### Get maximum number of Lights allowed to appear[​](#get-maximum-number-of-lights-allowed-to-appear "Direct link to Get maximum number of Lights allowed to appear")

```
    var maxVisibleLights = this.lights.getMaxVisibleLights();
```

### Shut down the Lights Manager[​](#shut-down-the-lights-manager "Direct link to Shut down the Lights Manager")

Recycles all active Lights into the Light pool, resets ambient light color and clears the lists of Lights and culled Lights.

```
    this.lights.shutdown();
```

## Light Game Object[​](#light-game-object "Direct link to Light Game Object")

*   Add
    
    ```
    var light = this.lights.addLight(x, y, radius);
    // var light = this.lights.addLight(x, y, radius, color, intensity);
    ```
    
    *   `x`, `y` : The horizontal/vertical position of the Light. Default is 0.
    *   `radius` : The radius of the Light. Default is 128. Default is 0.
    *   `color` : The integer RGB color of the light. Default is `0xffffff`.
    *   `intensity` : The intensity of the Light. Default is 1.
*   Add Point Light
    
    *   The Point Light Game Object provides a way to add a point light effect into your game, without the expensive shader processing requirements of the traditional Light Game Object. It renders using a custom shader, designed to give the impression of a point light source, of variable radius, intensity and color, in your game. However, unlike the Light Game Object, it does not impact any other Game Objects, or use their normal maps for calcuations. This makes them extremely fast to render compared to Lights and perfect for special effects, such as flickering torches or muzzle flashes.
        
        ```
        var light = this.lights.addPointLight(x, y, color, radius, intensity, attenuation);
        ```
        
    *   `x`, `y` : The horizontal/vertical position of the Light.
        
    *   `color` : The integer RGB color of the light. Default is `0xffffff`.
        
    *   `radius` : The radius of the Light. Default is 128.
        
    *   `intensity` : The intensity of the Light. Default is 1.
        
    *   `attenuation` : The attenuation of the Point Light. This is the reduction of light from the center point. Default is 0.1.
        
*   Remove
    
    ```
    this.lights.removeLight(light);
    ```
    
*   Destroy
    
    ```
    this.lights.destroy();
    ```
    

### Position[​](#position "Direct link to Position")

*   Set
    
    ```
    light.setPosition(x, y);
    ```
    
    or
    
    ```
    light.x = x;
    light.y = y;
    ```
    
*   Get
    
    ```
    var x = light.x;
    var y = light.y;
    ```
    

### Color[​](#color "Direct link to Color")

*   Set
    
    *   Red, green, blue
        
        ```
        light.color.set(red, green, blue);
        ```
        
        or
        
        ```
        light.color.r = red;
        light.color.g = green;
        light.color.b = blue;
        ```
        
    *   Integer value
        
        ```
        light.setColor(colorInteger);
        ```
        
*   Get
    
    *   Red, green, blue
        
        ```
        var red = light.color.r;
        var green = light.color.g;
        var blue = light.color.b;
        ```
        

### Size[​](#size "Direct link to Size")

*   Set
    
    ```
    light.setRadius(radius);
    // light.radius = radius;
    ```
    
    or
    
    ```
    light.diameter = diameter;
    // light.width = diameter;
    // light.height = diameter;
    // light.displayWidth = diameter;
    // light.displayHeight = diameter;
    ```
    
*   Get
    
    ```
    var radius = light.radius;
    ```
    
    or
    
    ```
    var diameter = light.diameter;
    // var diameter = light.displayWidth;
    // var diameter = light.displayHeight;
    // var diameter = light.width;
    // var diameter = light.height;
    ```
    

### Intensity[​](#intensity "Direct link to Intensity")

*   Set
    
    ```
    light.setIntensity(intensity);
    ```
    
    or
    
    ```
    light.intensity = intensity;
    ```
    
*   Get
    
    ```
    var intensity = light.intensity;
    ```
    

## Game object[​](#game-object "Direct link to Game object")

### Load texture with normal map[​](#load-texture-with-normal-map "Direct link to Load texture with normal map")

```
this.load.image(key, [url, normalMapUrl]);
```

*   `url` : Url of texture.
*   `url` : Url of texture.
*   `normalMapUrl` : Url of normal map.

### Apply light pipeline[​](#apply-light-pipeline "Direct link to Apply light pipeline")

```
gameObject.setPipeline('Light2D');
```

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
