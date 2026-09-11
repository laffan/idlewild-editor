# Animations

The primary means of animation in Phaser is by using 'frame' based animations. As mentioned previously, Phaser maintains a Texture class, which contains as many Frames as may exist on that Texture. The Animation systen allows you to play a sequence of these Frames, one after the other, at a given frame rate. This is how you create the illusion of animation on Sprites in your game. To achieve this, you often see texture image files divided into a 'grid' of frames, where each frame is a different animation frame. This is known as a Sprite Sheet or Texture Atlas.

Animations are created via the Animation Manager. Each Scene has its own instance of the Animation Manager. You can create as many animations as you like, and each animation can have as many frames as you like. You can also create multiple animations that all use the same frames, if you wish. For example, you could have a 'walk' animation that uses frames 1 to 4, and a 'run' animation that uses frames 1 to 8. Both animations would use overlapping frames, but play them at different speeds.

Not all Game Objects can be animated. The main one you'll use is the Sprite Game Object. This carries its own Animation State component with it, allowing you to create and play animations directly on a Sprite instance.

Animations can be either global or local. A global animation is one that is created via the Animation Manager and is available to all Game Objects in your game. A local animation is one that is created directly on a Game Object, such as a Sprite. Local animations are only available to that Game Object and cannot be used by any other Game Object.

It's worth mentioning that animation can also be achieved by tweening objects, if you just need a blend of motion + subtle changes (like scale or alpha), and that Phaser 3 also has a plugin available for Spine animations, which is a bone-based animation software package published by Esoteric Software.

## Animation manager[​](#animation-manager "Direct link to Animation manager")

### Add animation[​](#add-animation "Direct link to Add animation")

```
var animationConfig = {
  key: "",

  frames: [],

  sortFrames: true,
  defaultTextureKey: null,
  skipMissedFrames: true,
  randomFrame: false,

  // time
  delay: 0,
  duration: null,
  frameRate: null,
  timeScale: 1,

  // repeat
  repeat: 0, // set to (-1) to repeat forever
  repeatDelay: 0,
  yoyo: false,

  // visible
  showBeforeDelay: false,
  showOnStart: false,
  hideOnComplete: false,
};

this.anims.create(animationConfig);
```

*   `key` : Unique key of this animation data
    
*   `frames` : An array of `{key, frame}`
    
    *   Properties
        
        ```
        {
            key: '',
            frame: '', // string, or number
            duration: 0
        }
        ```
        
        *   `duration` : The duration, in ms, of this frame of the animation.
    *   A string : Texture key.
        
    *   Every frame in the atlas
        
        ```
        this.anims.generateFrameNames(key);
        ```
        
    *   Frame sequence indexing from start to end
        
        ```
        var config = ;
        this.anims.generateFrameNames(key,
        {
            prefix: '',
            start: 0,
            end: 0,
            suffix: '',
            zeroPad: 0,
            // outputArray: [], // Append frames into this array
        });
        ```
        
        *   `prefix + Pad(i, zeroPad, '0', 1) + suffix`, i: start ~ end
    *   Custom frame sequence
        
        ```
        var config = ;
        this.anims.generateFrameNames(key,
        {
            prefix: '',
            suffix: '',
            zeroPad: 0,
            frames: [ ... ]
            // outputArray: [], // Append frames into this array
        });
        ```
        
        *   `prefix + Pad(frames[i], zeroPad, '0', 1) + suffix`
*   `sortFrames` : Frame names numerically sorted. Default value is `true`.
    
*   `defaultTextureKey` : The key of the texture all frames of the animation will use. Can be overridden on a per frame basis.
    
*   `skipMissedFrames` : Skip frames if the time lags, or always advanced anyway? Default value is `true`.
    
*   `randomFrame` : Start playback of this animation from a randomly selected frame? Default value is `false`.
    
*   `delay` : Delay before starting playback. Value given in milliseconds.
    
*   `duration` : How long the animation should play for in milliseconds. If not given its derived from `frameRate`.
    
*   `frameRate` : The frame rate of playback in frames per second. Default value is `24`.
    
*   `timeScale` : The time scale to be applied to playback of this animation. Default value is `1`.
    
*   `repeat` : Number of times to repeat the animation. Default value is `0`.
    
    *   `-1` : Infinity
*   `repeatDelay` : Delay before the animation repeats. Value given in milliseconds.
    
*   `yoyo` : Should the animation yoyo? (reverse back down to the start) before repeating? Default value is `false`.
    
*   `showBeforeDelay` : If this animation has a delay, should it show the first frame immediately (`true`), or only after the delay (`false`)
    
*   `showOnStart` : Should `sprite.visible = true` when the animation starts to play? This happens _after_ any delay, if set. Default value is `false`.
    
*   `hideOnComplete` : Should sprite.visible = false when the animation finishes? Default value is `false`.
    

#### Use every frame in a texture[​](#use-every-frame-in-a-texture "Direct link to Use every frame in a texture")

```
// Create animation 'mummyWalk' from every frame in texture 'mummy':
this.anims.create({
  key: "mummyWalk",
  frames: "mummy",
});
```

#### Choosing texture frames[​](#choosing-texture-frames "Direct link to Choosing texture frames")

You will usually need to know the texture frame names. To get the frame names:

```
console.assert(this.texture.exists("mummy"));
console.log(this.textures.get("mummy").getFrameNames());
```

```
// Create animation 'mummyWalk' from frames 0, 1, 2 of texture 'mummy':
this.anims.create({
  key: "mummyWalk",
  frames: [
    { key: "mummy", frame: 0 },
    { key: "mummy", frame: 1 },
    { key: "mummy", frame: 2 },
  ],
});
```

You can of course create animations using any technique.

```
// We have 3 textures with identical frame patterns.
const textureKeys = ["giant", "elf", "goblin"];

// We will create 9 animations from 3 sequences.
const anims = {
  idle: [0],
  walk: [1, 2],
  attack: [3, 4],
};

for (const textureKey of textureKeys) {
  for (const animName of anims) {
    this.anims.create({
      // 'giant:idle', 'giant:walk', etc.
      key: `${textureKey}:${animName}`,
      frames: anims[animName],
    });
  }
}
```

#### Frame timing[​](#frame-timing "Direct link to Frame timing")

You can give either `frameRate` (default 24 fps) or a `duration` for the whole animation. The frame duration is calculated as `1000 / frameRate` or `duration / frames.length`.

If you set per-frame durations, these are **added** to the calculated frame durations. So if you want to set only frame durations, use an animation duration of 1ms.

```
this.anims.create({
  key: "spikes",
  repeat: -1,
  defaultTextureKey: "spikes",
  duration: 1, // 1 ms, close enough to 0
  frames: [
    { frame: 0, duration: 3000 },
    { frame: 1, duration: 250 },
    { frame: 2, duration: 250 },
    { frame: 3, duration: 3000 },
    { frame: 2, duration: 250 },
    { frame: 1, duration: 250 },
  ],
});
```

#### generateFrameNumbers() and generateFrameNames()[​](#generateframenumbers-and-generateframenames "Direct link to generateFrameNumbers() and generateFrameNames()")

The helper methods [generateFrameNumbers()](https://newdocs.phaser.io/docs/latest/Phaser.Animations.AnimationManager-generateFrameNumbers) and [generateFrameNames()](https://newdocs.phaser.io/docs/latest/Phaser.Animations.AnimationManager-generateFrameNames) both **select** frame names from a texture according to a pattern and then **generate** an array of [AnimationFrame](https://newdocs.phaser.io/docs/latest/Phaser.Types.Animations.AnimationFrame) objects that can be passed as the `frames` property. `generateFrameNumbers()` selects spritesheet-style frame names (indexes) and `generateFrameNames()` selects atlas-style frame names. They never select frame names that don't exist in the texture.

For example,

```
this.anims.generateFrameNumbers("mummy", { frames: [0, 1, 2] });
```

or

```
this.anims.generateFrameNumbers("mummy", { start: 0, end: 2 });
```

would produce an array of the 3 frame configs that we wrote above.

The `generateFrameNames()` config has all the options of `generateFrameNumbers()`, plus `prefix`, `suffix`, and `zeroPad`.

Log the output of these methods if you run into trouble.

#### Add from Aseprite[​](#add-from-aseprite "Direct link to Add from Aseprite")

[Aseprite](https://www.aseprite.org/) is a powerful animation sprite editor and pixel art tool. Create one, or more animations from a loaded Aseprite JSON file.

```
this.anims.createFromAseprite(key);
// this.anims.createFromAseprite(key, tags, target);
```

*   `key` : The key of the loaded Aseprite atlas.
*   `tags` :
    *   `undefined` : Load all tags.
    *   Array of string tag : Load these tags.
*   `target` : Create the animations on this target Sprite.
    *   `undefined` : Created globally in this Animation Manager. Default behavior.

### Remove animation[​](#remove-animation "Direct link to Remove animation")

```
this.anims.remove(key);
```

### Mixing and delaying between two animations[​](#mixing-and-delaying-between-two-animations "Direct link to Mixing and delaying between two animations")

*   Add
    
    ```
    this.anims.addMix(animA, animB, delay);
    ```
    
    *   `animA`, `animB` : String key of an animation, or an instance of animation.
*   Remove
    
    ```
    this.anims.removeMix(animA, animB);
    // this.anims.removeMix(animA);
    ```
    
*   Get
    
    ```
    var delay = this.anims.getMix(animA, animB);
    ```
    
*   Example of an animation mix for transitioning from one animation to another.
    
    ```
    this.anims.create({ key: "animA" /* etc. */ });
    this.anims.create({ key: "animB" /* etc. */ });
    
    this.anims.addMix("animA", "animB", 200);
    ```
    
    The delay is applied automatically if you play the second animation while the first is playing.
    
    ```
    sprite.play("animA");
    // Later:
    sprite.play("animB");
    ```
    
    It's very similar to
    
    ```
    if (sprite.anims.isPlaying && sprite.anims.getName() === "animA") {
      sprite.anims.playAfterDelay("animB", 200);
    }
    ```
    

### Play animation[​](#play-animation "Direct link to Play animation")

*   Play
    
    ```
    this.anims.play(key, children);
    ```
    
*   Stagger play (delay play)
    
    ```
    this.anims.staggerPlay(key, children, stagger, staggerFirst);
    ```
    
    *   `children` : An array of Game Objects to play the animation on
    *   `stagger` : The amount of time, in milliseconds, to offset each play time by
    *   `staggerFirst` : Set `true` to apply delay on 1st child
*   Playing an animation when an event is triggered
    
    ```
    sprite.on(event, function () {
      sprite.play(key);
    }
    ```
    
    Example:
    
    ```
    sprite.on('pointerdown', function () {
      sprite.play('smile');
    }
    ```
    
*   Ignore playing an animation if it is already playing
    
    ```
    sprite.play(key, ignoreIfPlaying);
    ```
    
    *   `ignoreIfPlaying` : Set to `true` to ignore restarting an animation.
    
    Example:
    
    ```
    sprite.play("run", true); // only plays the "run" animation if it is not already playing
    ```
    
*   Chaining animation
    

`chain()` schedules an animation to play once the current one **completes** or **stops**. Repeated chaining adds to the **end** of the queue. If an animation is repeating, only `stop()` will advance the queue. If you want a final stop, do

```
sprite.chain().stop();
```

Be careful of chaining too many animations by mistake.

```
function update() {
  // Choose a reasonable maximum.
  if (sprite.anims.nextAnimsQueue.length > 10) {
    throw new Error("Too many chained animations");
  }
}
```

Internally, the next chained animation is in `nextAnim` and any additional ones are in `nextAnimsQueue`.

*   Play animation after delay or repeat count
    
    *   `playAfterDelay()`
        
        ```
        sprite.playAfterDelay(key, delay);
        ```
        
        *   `key` : The string-based key of the animation to play.
        *   `delay` : The delay, in milliseconds, to wait before playing the animation.
    *   `playAfterRepeat()`
        
        ```
        sprite.playAfterRepeat(key, repeatCount);
        ```
        
        *   `key` : The string-based key of the animation to play.
        *   `repeatCount` : Optional argument that defaults to 1. Number of current animation repeats before next animation plays.

### Pause all animations[​](#pause-all-animations "Direct link to Pause all animations")

```
this.anims.pauseAll();
```

### Resume all animations[​](#resume-all-animations "Direct link to Resume all animations")

```
this.anims.resumeAll();
```

### Global time scale[​](#global-time-scale "Direct link to Global time scale")

The global time scale of the Animation Manager. This scales the time delta between two frames, thus influencing the speed of time for the Animation Manager.

*   Get
    
    ```
    var timeScale = this.anims.globalTimeScale;
    ```
    
*   Set
    
    ```
    this.anims.globalTimeScale = timeScale;
    ```
    

### Has animation[​](#has-animation "Direct link to Has animation")

```
var hasAnim = this.anims.exists(key);
```

### Export/load[​](#exportload "Direct link to Export/load")

*   Export JSON
    
    ```
    var json = this.anims.toJSON();
    ```
    
*   Load from JSON
    
    ```
    this.anims.fromJSON(json);
    // this.anims.fromJSON(json, clearCurrentAnimations);
    ```
    
    *   Load JSON in preload stage
        
        ```
        scene.load.json(key, url);
        ```
        
    *   Load animation in preload stage
        
        ```
        scene.load.animation(key, url);
        ```
        

### Events[​](#events "Direct link to Events")

*   On add animation
    
    ```
    this.anims.on("add", function (key, anim) {});
    ```
    
*   On remove animation
    
    ```
    this.anims.on("remove", function (key, anim) {});
    ```
    
*   On pause all animations
    
    ```
    this.anims.on("pauseall", function () {});
    ```
    
*   On resume all animations
    
    ```
    this.anims.on("resumeall", function () {});
    ```
    

## Animation object[​](#animation-object "Direct link to Animation object")

```
var anim = this.anims.get(key);
```

Example:

```
const mummyWalkAnim = this.anims.get("mummyWalk");
```

### Add frame[​](#add-frame "Direct link to Add frame")

*   Append frames
    
    ```
    anim.addFrame(frame);
    ```
    
    *   `frame` : `this.anims.generateFrameNames(key, config)`
*   Insert frames at index
    
    ```
    anim.addFrameAt(index, frame);
    ```
    
    *   `frame` : `this.anims.generateFrameNames(key, config)`

### Remove frame[​](#remove-frame "Direct link to Remove frame")

*   Remove frame at
    
    ```
    anim.removeFrameAt(index);
    ```
    
*   Remove frame
    
    ```
    anim.removeFrame(frame);
    ```
    

### Get frame[​](#get-frame "Direct link to Get frame")

*   Has frame index
    
    ```
    var HasFrameAt = anim.checkFrame(index);
    ```
    
*   Get frame at index
    
    ```
    var frame = anim.getFrameAt(index);
    ```
    
    Example:
    
    ```
    const mummyWalkFrame1 = this.anims.get("mummyWalk").getFrameAt(1);
    ```
    
*   Get last frame
    
    ```
    var frame = anim.getLastFrame();
    ```
    

### Export[​](#export "Direct link to Export")

*   Export JSON
    
    ```
    var json = anim.toJSON();
    ```
    
    or
    
    ```
    var jsonString = JSON.stringify(anim);
    ```
    

## Common errors[​](#common-errors "Direct link to Common errors")

> TypeError: undefined is not an object (evaluating 'animationFrame.frame.texture')

in [setCurrentFrame()](https://newdocs.phaser.io/docs/latest/Phaser.Animations.AnimationState-setCurrentFrame). Usually you created an animation with a bad texture key.

> TypeError: undefined is not an object (evaluating 'state.currentFrame.duration')

in [getFirstTick()](https://newdocs.phaser.io/docs/latest/Phaser.Animations.Animation-getFirstTick). You're playing an empty animation (no frames), or you're playing a `startFrame` that's out of range. If the animation has no frames, this is usually because `generateFrameNames()` or `generateFrameNumbers()` couldn't select any; look for preceding warnings in the console.

> TypeError: undefined is not an object (evaluating 'this.anims.play')

You're playing on a destroyed Sprite or a non-Sprite game object (lacking `anims`).

> TypeError: sprite.play is not a function

You're playing on a non-Sprite game object.

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
*   [samme](https://github.com/samme)
