# Time

Every Scene has an instance of the Clock class. It's responsible for keeping track of the elapsed time, delta time, and other time related values. It also allows you to create Timer Events, which are events that fire after a given amount of time has passed. For example, you can create a Timer Event that fires after 5 seconds, or 10 seconds, or 1 minute. You can also create Timer Events that repeat, such as every 5 seconds, or every 10 seconds.

The Clock that belongs to a Scene is used by all Scene systems, such as tweens and sound. It's also used by Game Objects, such as the Sprite animation system. This means that all of these systems are synchronized to the same clock. You have the ability to 'scale' the time of an individual clock, thus slowing down, or speeding-up the systems running within a single Scene.

## Timer[​](#timer "Direct link to Timer")

Execute callback when time-out, built-in object of phaser.

### Start timer[​](#start-timer "Direct link to Start timer")

*   Looped timer
    
    ```
    var timer = this.time.addEvent({
      delay: 500, // ms
      callback: callback,
      //args: [],
      callbackScope: thisArg,
      loop: true,
    });
    ```
    
*   Repeat timer
    
    ```
    var timer = this.time.addEvent({
      delay: 500, // ms
      callback: callback,
      //args: [],
      callbackScope: thisArg,
      repeat: 4,
    });
    ```
    
*   Delayed timer
    
    ```
    var timer = this.time.delayedCall(delay, callback, args, scope); // delay in ms
    ```
    
*   All properties of timer
    
    ```
    var timer = this.time.addEvent({
      delay: 500, // ms
      callback: callback,
      args: [],
      callbackScope: thisArg,
      loop: false,
      repeat: 0,
      startAt: 0,
      timeScale: 1,
      paused: false,
    });
    ```
    
*   Reset and reuse timer
    
    ```
    timer.reset({
      delay: 500, // ms
      callback: callback,
      args: [],
      callbackScope: thisArg,
      loop: false,
      repeat: 0,
      startAt: 0,
      timeScale: 1,
      paused: false,
    });
    this.time.addEvent(timer);
    ```
    

!!! note Throw error message if `delay : 0` with (`repeat > 0` or `loop: true`)

### Pause/resume[​](#pauseresume "Direct link to Pause/resume")

*   Pause timer
    
    ```
    timer.paused = true;
    ```
    
*   Resume timer
    
    ```
    timer.paused = false;
    ```
    
*   Is paused
    
    ```
    var isPaused = timer.paused;
    ```
    

### Stop timer[​](#stop-timer "Direct link to Stop timer")

*   Stop a running timer
    
    ```
    timer.remove();
    ```
    
*   Remove from timeline's all internal lists, for timer re-using
    
    ```
    this.time.removeEvent(timer);
    ```
    

### Time scale[​](#time-scale "Direct link to Time scale")

Scale the timer using a multiplier.

*   Set
    
    ```
    timer.timeScale = 0.5; // half speed
    //timer.timeScale = 2; // double speed
    ```
    
*   Get
    
    ```
    var timeScale = timer.timeScale;
    ```
    

### Other properties[​](#other-properties "Direct link to Other properties")

*   Get elapsed time
    
    ```
    var elapsed = timer.getElapsed(); // ms
    var elapsed = timer.getElapsedSeconds(); // sec
    // var elapsed = timer.elapsed;  // ms
    ```
    
*   Get remaining time
    
    ```
    var remaining = timer.getRemaining(); // ms
    var remaining = timer.getRemainingSeconds(); // sec
    // var remaining = timer.getOverallRemaining();   // ms
    // var remaining = timer.getOverallRemainingSeconds(); // sec
    ```
    
*   Get repeat count
    
    ```
    var repeat = timer.getRepeatCount();
    ```
    
*   Gets the progress of the current iteration
    
    ```
    var progress = timer.getProgress(); // elapsed / delay
    ```
    
*   Gets the progress of the timer overall, factoring in repeats.
    
    ```
    var progress = timer.getOverallProgress(); // totalElapsed / totalDuration
    ```
    
*   Get delay time
    
    ```
    var delay = timer.delay; // ms
    ```
    

## Timeline[​](#timeline "Direct link to Timeline")

A Timeline is a way to schedule the running of callbacks, events and other actions at specific times in the future. It is a Scene level system meaning each Timeline belongs to its own Scene. You can use multiple Timelines running at the same time in the same scene.

If the Scene is paused, the Timeline will also pause. If the Scene is destroyed, the Timeline will be automatically destroyed. However, you can control the Timeline directly, pausing, resuming and stopping it at any time.

### Create timeline[​](#create-timeline "Direct link to Create timeline")

```
var timeline = this.add.timeline([
    {
        // Time condition
        at: 0,
        in:
        from:

        // Enable condition
        if(event) {
            // this: target parameter
            return true;  // false
        },

        set: {
            key: value,
        },

        tween: {
            targets: gameObject,
            alpha: 1,
            ease: 'Linear',       // 'Cubic', 'Elastic', 'Bounce', 'Back'
            duration: 1000,
            repeat: 0,            // -1: infinity
            yoyo: false
        },

        run(){
            // this: target parameter
        },

        loop() {

        },

        sound: '',

        event: '',

        // target: this,

        // once: false,
        // stop: false,
    },

    // ...
])
```

*   Time :
    
    *   `at` : Absolute delay time after starting in ms.
    *   `in` : Absolute delay time after current time in ms.
    *   `from` : Relative delay time after previous event in ms
*   Enable :
    
    *   `if` : A function. Invoking every tick, run actions when it returns `true`.
*   Actions :
    
    *   `set` : A key-value object of properties to set on the `target`.
        
    *   `tween` : [tween config](/phaser/concepts/tweens#creating-a-tween)
        
    *   `run` : A function which will be called when the Event fires.
        
        ```
        function() {
            // this: target parameter
        }
        ```
        
    *   `loop` : A function which will be called when the Event sequence repeat again.
        
        ```
        function() {
            // this: target parameter
        }
        ```
        
    *   `sound` :
        
        *   A string : A key from the Sound Manager to play
            
        *   A config object for a sound to play when the Event fires.
            
            ```
            {
              key, config;
            }
            ```
            
            *   `key` : The key of the sound to play
            *   `config` : [config of playing sound](/phaser/concepts/audio#configuration)
    *   `event` : String-based event name to emit when the Event fires. The event is emitted from the Timeline instance.
        
        ```
        timeline.on(eventName);
        ```
        
    *   `target` : The scope (`this` object) with which to invoke the `run`.
        
*   Control
    
    *   `once` : If set, the Event will be removed from the Timeline when it fires.
    *   `stop` : If set, the Timeline will stop and enter a complete state when this Event fires, even if there are other events after it.

The Timeline always starts paused.

### Steps of commands[​](#steps-of-commands "Direct link to Steps of commands")

For each tick, for each command :

1.  Test time (`at`, `in`, `from`)
2.  Test enable (`if`)
3.  Run actions (`set`, `tween`, `run`, `sound`, `event`)
4.  Control (`once`, `stop`)

### Start[​](#start "Direct link to Start")

```
timeline.play();
```

#### Restart[​](#restart "Direct link to Restart")

```
timeline.play(true);
```

#### Start with repeat[​](#start-with-repeat "Direct link to Start with repeat")

*   Repeat infinite
    
    ```
    timeline.repeat().play();
    // timeline.repeat(true).play();
    // timeline.repeat(-1).play();
    ```
    
*   Amount of times to repeat
    
    ```
    timeline.repeat(amount).play();
    ```
    
    *   `amount` : A positive number
*   No repeat
    
    ```
    timeline.repeat(false);
    ```
    
*   Current loop counter
    
    ```
    var loopCounter = timeline.iteration;
    ```
    

### Stop[​](#stop "Direct link to Stop")

```
timeline.stop();
```

### Pause / Resume[​](#pause--resume "Direct link to Pause / Resume")

```
timeline.pause();
// timeline.paused = true;
```

```
timeline.resume();
// timeline.paused = false;
```

### Reset[​](#reset "Direct link to Reset")

Resets this Timeline back to the start, include loop counter.

If the Timeline had any events that were set to `once` that have already been removed, they will **not** be present again after calling this method.

```
timeline.reset();
```

If the Timeline isn't currently running (i.e. it's paused or complete) then calling this method resets those states, the same as calling `Timeline.play(true)` (restart).

### Add command[​](#add-command "Direct link to Add command")

```
timeline.add(config);
```

or

```
timeline.add([config0, config1, ...]);
```

### Clear all commands[​](#clear-all-commands "Direct link to Clear all commands")

```
timeline.clear();
```

### Events[​](#events "Direct link to Events")

*   On all commands are completed
    
    ```
    timeline.on("complete", function () {});
    ```
    

### Other properties[​](#other-properties-1 "Direct link to Other properties")

*   Timeline is currently playing, not paused or not complete.
    
    ```
    var isPlaying = timeline.isPlaying();
    ```
    
*   Is paused
    
    ```
    var isPaused = timeline.paused;
    ```
    
*   All commands are complete
    
    ```
    var isCompleted = timeline.complete;
    ```
    

### Destroy[​](#destroy "Direct link to Destroy")

Also remove updating.

```
timeline.destroy();
```

## Author Credits[​](#author-credits "Direct link to Author Credits")

Content on this page includes work by:

*   [RexRainbow](https://github.com/rexrainbow)
